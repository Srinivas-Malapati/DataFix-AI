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
