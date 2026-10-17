import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("contracts", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const runtime = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

async function post(path, body) {
  const worker = await loadWorker();
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    runtime,
    context,
  );
}

test("AI planning fails safely when server configuration is unavailable", async () => {
  const response = await post("/api/plan", {
    fileName: "sales.csv",
    headers: ["order_id", "amount"],
    sampleRows: [["1001", "$49.00"]],
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "AI planning is not configured." });
});

test("CreateOS execution fails safely when server configuration is unavailable", async () => {
  const response = await post("/api/execute", {
    fileName: "sales.csv",
    csvText: "order_id,amount\n1001,$49.00\n",
    pythonCode: "print('safe')",
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "CreateOS execution is not configured." });
});

async function withEnv(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const CONFIGURED = {
  OPENAI_API_KEY: "test-openai-key",
  CREATEOS_PROJECT_API_KEY: "test-createos-key",
  CREATEOS_SANDBOX_BASE_URL: "http://127.0.0.1:9",
};

test("refuses to execute a script the server did not sign", async () => {
  await withEnv(CONFIGURED, async () => {
    const response = await post("/api/execute", {
      fileName: "sales.csv",
      csvText: "order_id,amount\n1001,$49.00\n",
      pythonCode: "print('arbitrary code')",
      scriptToken: `${Date.now() + 60_000}.forged`,
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /not issued by DataFix/);
  });
});

test("rejects malformed execution requests before any sandbox work", async () => {
  await withEnv(CONFIGURED, async () => {
    const missingToken = await post("/api/execute", { csvText: "a,b\n1,2\n", pythonCode: "print(1)" });
    assert.equal(missingToken.status, 400);

    const brokenCsv = await post("/api/execute", { csvText: 'a,b\n1,"open', pythonCode: "print(1)", scriptToken: "1.x" });
    assert.equal(brokenCsv.status, 400);
    assert.match((await brokenCsv.json()).error, /unterminated/);
  });
});

test("rejects malformed planning requests before calling the AI", async () => {
  await withEnv(CONFIGURED, async () => {
    const response = await post("/api/plan", { fileName: "x.csv", headers: [], sampleRows: [] });
    assert.equal(response.status, 400);

    const tooLongGoal = await post("/api/plan", { fileName: "x.csv", goal: "x".repeat(5_000), headers: ["a"], sampleRows: [["1"]] });
    assert.equal(tooLongGoal.status, 400);
  });
});
