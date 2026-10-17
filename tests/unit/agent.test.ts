import assert from "node:assert/strict";
import test from "node:test";
import { SANDBOX_PATHS } from "../../lib/contract.ts";
import { runCleanupAgent } from "../../lib/server/agent.ts";
import type { ExecResult, Sandbox, SandboxProvider } from "../../lib/server/createos.ts";
import type { RepairFn, RepairRequest } from "../../lib/server/planner.ts";

const INPUT = "id,name\n1, Ada \n2,Grace\n2,Grace\n";
const CLEAN = "id,name\n1,Ada\n2,Grace\n";

type Behavior = (files: Map<string, string>) => Partial<ExecResult>;

/**
 * An in-memory sandbox. Each script's behavior is looked up by its exact
 * source, which lets a test script a sequence of failures and repairs.
 */
function fakeSandboxes(behaviors: Record<string, Behavior>) {
  const files = new Map<string, string>();
  const stats = { created: 0, destroyed: 0, execs: 0 };
  const sandbox: Sandbox = {
    async upload(path, contents) { files.set(path, contents); },
    async download(path) { return files.get(path) ?? null; },
    async exec() {
      stats.execs += 1;
      // Mirror the real runner: outputs from previous attempts are cleared first.
      files.delete(SANDBOX_PATHS.output);
      files.delete(SANDBOX_PATHS.report);
      const behavior = behaviors[files.get(SANDBOX_PATHS.script) ?? ""];
      assert.ok(behavior, "unexpected script executed");
      return { exitCode: 0, stdout: "", stderr: "", execMs: 5, ...behavior(files) };
    },
  };
  const provider: SandboxProvider = {
    async withSandbox(task) {
      stats.created += 1;
      try {
        return await task(sandbox);
      } finally {
        stats.destroyed += 1;
      }
    },
  };
  return { provider, stats };
}

const writes = (csv: string): Behavior => (files) => {
  files.set(SANDBOX_PATHS.output, csv);
  files.set(SANDBOX_PATHS.report, JSON.stringify({ notes: ["done"] }));
  return { stdout: "wrote output" };
};
const crashes: Behavior = () => ({ exitCode: 1, stderr: "Traceback: KeyError 'nme'" });

function repairsTo(...codes: string[]) {
  const calls: RepairRequest[] = [];
  const repair: RepairFn = async (request) => {
    calls.push(request);
    const next = codes[calls.length - 1];
    assert.ok(next !== undefined, "unexpected repair request");
    return { diagnosis: `fix #${calls.length}`, python_code: next };
  };
  return { repair, calls };
}

test("succeeds on the first attempt without asking for a repair", async () => {
  const { provider, stats } = fakeSandboxes({ good: writes(CLEAN) });
  const { repair, calls } = repairsTo();
  const outcome = await runCleanupAgent({ sandboxes: provider, repair, fileName: "t.csv", csvText: INPUT, code: "good" });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.status === "succeeded" && outcome.outputCsv, CLEAN);
  assert.deepEqual(outcome.status === "succeeded" && outcome.report?.notes, ["done"]);
  assert.equal(outcome.attempts.length, 1);
  assert.equal(calls.length, 0);
  assert.deepEqual(stats, { created: 1, destroyed: 1, execs: 1 });
});

test("repairs a crashing script using its error output, then succeeds", async () => {
  const { provider } = fakeSandboxes({ broken: crashes, fixed: writes(CLEAN) });
  const { repair, calls } = repairsTo("fixed");
  const outcome = await runCleanupAgent({ sandboxes: provider, repair, fileName: "t.csv", csvText: INPUT, code: "broken" });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(outcome.attempts.map((attempt) => attempt.status), ["failed", "succeeded"]);
  assert.equal(outcome.attempts[1].diagnosis, "fix #1");
  assert.equal(outcome.status === "succeeded" && outcome.finalCode, "fixed");
  assert.equal(calls[0].failure.kind, "runtime");
  assert.match(calls[0].failure.logs, /KeyError/);
  assert.deepEqual(calls[0].headers, ["id", "name"]);
});

test("rejects a policy-violating script without executing it, then repairs it", async () => {
  const { provider, stats } = fakeSandboxes({ fixed: writes(CLEAN) });
  const { repair, calls } = repairsTo("fixed");
  const outcome = await runCleanupAgent({ sandboxes: provider, repair, fileName: "t.csv", csvText: INPUT, code: "import os\n" });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.attempts[0].status, "rejected");
  assert.equal(calls[0].failure.kind, "policy");
  assert.equal(stats.execs, 1);
});

test("treats output that fails independent validation as a failure to repair", async () => {
  const { provider } = fakeSandboxes({ sloppy: writes("id,name\n1, Ada \n2,Grace\n"), fixed: writes(CLEAN) });
  const { repair, calls } = repairsTo("fixed");
  const outcome = await runCleanupAgent({ sandboxes: provider, repair, fileName: "t.csv", csvText: INPUT, code: "sloppy" });

  assert.equal(outcome.status, "succeeded");
  assert.equal(calls[0].failure.kind, "validation");
  assert.match(calls[0].failure.summary, /leading or trailing spaces/);
});

test("treats a script that writes no output as a failure", async () => {
  const { provider } = fakeSandboxes({ silent: () => ({ stdout: "nothing" }), fixed: writes(CLEAN) });
  const { repair, calls } = repairsTo("fixed");
  const outcome = await runCleanupAgent({ sandboxes: provider, repair, fileName: "t.csv", csvText: INPUT, code: "silent" });

  assert.equal(outcome.status, "succeeded");
  assert.equal(calls[0].failure.kind, "missing_output");
});

test("reports a timeout distinctly", async () => {
  const { provider } = fakeSandboxes({ slow: () => ({ exitCode: 142 }), fixed: writes(CLEAN) });
  const { repair, calls } = repairsTo("fixed");
  await runCleanupAgent({ sandboxes: provider, repair, fileName: "t.csv", csvText: INPUT, code: "slow" });
  assert.equal(calls[0].failure.kind, "timeout");
});

test("gives up after the attempt budget and still destroys the sandbox", async () => {
  const { provider, stats } = fakeSandboxes({ a: crashes, b: crashes, c: crashes });
  const { repair, calls } = repairsTo("b", "c");
  const outcome = await runCleanupAgent({ sandboxes: provider, repair, fileName: "t.csv", csvText: INPUT, code: "a", maxAttempts: 3 });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.attempts.length, 3);
  assert.equal(calls.length, 2);
  assert.match(outcome.status === "failed" ? outcome.lastFailure : "", /exited with code 1/);
  assert.deepEqual(stats, { created: 1, destroyed: 1, execs: 3 });
});

test("stops cleanly when the repair service is unavailable", async () => {
  const { provider } = fakeSandboxes({ broken: crashes });
  const outcome = await runCleanupAgent({
    sandboxes: provider,
    repair: async () => { throw new Error("AI down"); },
    fileName: "t.csv",
    csvText: INPUT,
    code: "broken",
  });
  assert.equal(outcome.status, "failed");
  assert.match(outcome.status === "failed" ? outcome.lastFailure : "", /repair was unavailable/);
});

test("destroys the sandbox when the run throws", async () => {
  const { provider, stats } = fakeSandboxes({});
  const { repair } = repairsTo();
  await assert.rejects(runCleanupAgent({ sandboxes: provider, repair, fileName: "t.csv", csvText: INPUT, code: "unknown" }));
  assert.equal(stats.destroyed, 1);
});

test("sends Stripe-provisioned credentials to the Sandbox API, not the platform API", async () => {
  const { getCreateOsConfig, SANDBOX_API_URL } = await import("../../lib/server/createos.ts");
  const config = getCreateOsConfig({
    CREATEOS_PROJECT_API_KEY: "stripe-key",
    CREATEOS_PROJECT_API_URL: "https://api-createos.nodeops.network",
  });
  assert.deepEqual(config, { apiKey: "stripe-key", baseUrl: SANDBOX_API_URL });
  assert.equal(getCreateOsConfig({}), null);
});

test("maps CreateOS quota exhaustion to a clear, retryable error", async () => {
  const { createOsProvider } = await import("../../lib/server/createos.ts");
  const { HttpError } = await import("../../lib/server/http.ts");
  const fetchImpl = (async () => new Response('{"status":"fail","data":"quota"}', { status: 429 })) as typeof fetch;
  const provider = createOsProvider({ apiKey: "k", baseUrl: "https://sandbox.test" }, fetchImpl);
  await assert.rejects(provider.withSandbox(async () => "unreachable"), (error) =>
    error instanceof HttpError && error.status === 503 && /quota/.test(error.message));
});

test("always deletes the sandbox, even when the task throws", async () => {
  const { createOsProvider } = await import("../../lib/server/createos.ts");
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
    return Response.json({ data: { id: "sbx_1" } });
  }) as typeof fetch;
  const provider = createOsProvider({ apiKey: "k", baseUrl: "https://sandbox.test" }, fetchImpl);
  await assert.rejects(provider.withSandbox(async () => { throw new Error("boom"); }), /boom/);
  assert.deepEqual(calls, ["POST /v1/sandboxes", "DELETE /v1/sandboxes/sbx_1"]);
});
