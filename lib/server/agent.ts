import { LIMITS, SANDBOX_PATHS, type Attempt, type FailureKind, type ScriptReport, type Verification } from "../contract.ts";
import { parseCsvTable } from "../csv.ts";
import type { Sandbox, SandboxProvider } from "./createos.ts";
import type { RepairFn } from "./planner.ts";
import { checkScript } from "./script-policy.ts";
import { parseScriptReport, verifyOutput } from "./verify.ts";

/**
 * The DataFix agent loop: run the approved script in one disposable sandbox,
 * independently verify its output, and on any failure (policy, crash, timeout,
 * missing output, failed verification) ask the AI to repair the code and try
 * again, up to `maxAttempts` total runs.
 */

export type AgentInput = {
  sandboxes: SandboxProvider;
  repair: RepairFn;
  fileName: string;
  csvText: string;
  code: string;
  maxAttempts?: number;
};

export type AgentOutcome =
  | {
      status: "succeeded";
      attempts: Attempt[];
      finalCode: string;
      outputCsv: string;
      report: ScriptReport | null;
      verification: Verification;
      logs: string;
      execMs: number | null;
    }
  | { status: "failed"; attempts: Attempt[]; lastFailure: string; verification?: Verification };

type Failure = { kind: FailureKind; summary: string; exitCode: number | null; logs: string; verification?: Verification };

type AttemptResult =
  | { ok: true; outputCsv: string; report: ScriptReport | null; verification: Verification; logs: string; execMs: number | null }
  | ({ ok: false } & Failure);

const MAX_LOG_CHARS = 20_000;

/** Exit statuses for SIGALRM, depending on how the runtime reports signals. */
const TIMEOUT_EXIT_CODES = new Set([142, -14]);

/**
 * Our own launcher (not model-generated): clears stale outputs from earlier
 * attempts, enforces a wall-clock limit, then runs the generated script.
 */
const RUNNER = [
  "import os, runpy, signal",
  `for path in (${JSON.stringify(SANDBOX_PATHS.output)}, ${JSON.stringify(SANDBOX_PATHS.report)}):`,
  "    try:",
  "        os.remove(path)",
  "    except FileNotFoundError:",
  "        pass",
  `signal.alarm(${LIMITS.scriptTimeoutSeconds})`,
  `runpy.run_path(${JSON.stringify(SANDBOX_PATHS.script)}, run_name="__main__")`,
].join("\n");

export async function runCleanupAgent(input: AgentInput): Promise<AgentOutcome> {
  const maxAttempts = input.maxAttempts ?? LIMITS.maxAttempts;
  const inputTable = parseCsvTable(input.csvText);

  return input.sandboxes.withSandbox(async (sandbox) => {
    await sandbox.upload(SANDBOX_PATHS.input, input.csvText);

    const attempts: Attempt[] = [];
    let code = input.code;
    let diagnosis: string | undefined;

    for (let number = 1; number <= maxAttempts; number += 1) {
      const result = await runAttempt(sandbox, code, inputTable);
      const attempt: Attempt = {
        number,
        status: result.ok ? "succeeded" : result.kind === "policy" ? "rejected" : "failed",
        exitCode: result.ok ? 0 : result.exitCode,
        logs: result.logs,
        ...(result.ok ? {} : { failure: result.summary }),
        ...(diagnosis ? { diagnosis } : {}),
      };
      attempts.push(attempt);

      if (result.ok) {
        return {
          status: "succeeded",
          attempts,
          finalCode: code,
          outputCsv: result.outputCsv,
          report: result.report,
          verification: result.verification,
          logs: result.logs,
          execMs: result.execMs,
        };
      }
      if (number === maxAttempts) {
        return { status: "failed", attempts, lastFailure: result.summary, verification: result.verification };
      }

      try {
        const repaired = await input.repair({ fileName: input.fileName, headers: inputTable.headers, code, failure: result });
        code = repaired.python_code;
        diagnosis = repaired.diagnosis;
      } catch (error) {
        console.error("[datafix] automatic repair failed", error);
        return {
          status: "failed",
          attempts,
          lastFailure: `${result.summary} Automatic repair was unavailable.`,
          verification: result.verification,
        };
      }
    }
    // Unreachable: the loop always returns on its final iteration.
    throw new Error("Agent loop exited without an outcome.");
  });
}

async function runAttempt(sandbox: Sandbox, code: string, inputTable: ReturnType<typeof parseCsvTable>): Promise<AttemptResult> {
  const policy = checkScript(code);
  if (!policy.allowed) {
    return { ok: false, kind: "policy", summary: `Blocked before execution: ${policy.violations.join(" ")}`, exitCode: null, logs: "" };
  }

  await sandbox.upload(SANDBOX_PATHS.script, code);
  const run = await sandbox.exec("/usr/bin/python3", ["-c", RUNNER]);
  const logs = `${run.stdout}${run.stderr ? `\n${run.stderr}` : ""}`.trim().slice(-MAX_LOG_CHARS);

  if (TIMEOUT_EXIT_CODES.has(run.exitCode)) {
    return { ok: false, kind: "timeout", summary: `The script exceeded the ${LIMITS.scriptTimeoutSeconds}s time limit.`, exitCode: run.exitCode, logs };
  }
  if (run.exitCode !== 0) {
    return { ok: false, kind: "runtime", summary: `The script exited with code ${run.exitCode}.`, exitCode: run.exitCode, logs };
  }

  const [outputCsv, reportText] = await Promise.all([
    sandbox.download(SANDBOX_PATHS.output),
    sandbox.download(SANDBOX_PATHS.report),
  ]);
  if (outputCsv === null) {
    return { ok: false, kind: "missing_output", summary: `The script did not write ${SANDBOX_PATHS.output}.`, exitCode: 0, logs };
  }

  const verification = verifyOutput(inputTable, outputCsv);
  if (!verification.passed) {
    const failed = verification.checks.filter((check) => check.blocking && !check.passed);
    return {
      ok: false,
      kind: "validation",
      summary: `Independent validation failed: ${failed.map((check) => check.detail ?? check.name).join(" ")}`,
      exitCode: 0,
      logs,
      verification,
    };
  }
  return { ok: true, outputCsv, report: parseScriptReport(reportText), verification, logs, execMs: run.execMs };
}
