/**
 * End-to-end check against a running DataFix server, using real OpenAI and
 * CreateOS calls. Usage:
 *
 *   npm run e2e -- <base-url> [sample-file]
 *   npm run e2e -- http://localhost:3002 sales_load_test_10000.csv
 */
import { readFile } from "node:fs/promises";
import type { ApiErrorBody, ExecuteSuccess, PlanResponse } from "../lib/contract.ts";
import { parseCsvTable, profileTable } from "../lib/csv.ts";

const [baseUrl = "http://localhost:3002", sample = "sales_messy.csv"] = process.argv.slice(2);
const csvText = await readFile(new URL(`../public/samples/${sample}`, import.meta.url), "utf8");
const table = parseCsvTable(csvText);
const profile = profileTable(table);

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & ApiErrorBody;
  if (!response.ok) {
    console.error(JSON.stringify({ path, status: response.status, ...payload }, null, 2).slice(0, 4_000));
    process.exit(1);
  }
  return payload;
}

const planStarted = performance.now();
const { plan, scriptToken, model } = await post<PlanResponse>("/api/plan", {
  fileName: sample,
  goal: "Trim spaces, standardize casing and currency formats, remove exact duplicates, and flag missing or ambiguous values instead of guessing.",
  headers: table.headers,
  sampleRows: table.rows.slice(0, 12),
  profile: {
    rows: profile.rowCount,
    duplicateRows: profile.duplicateRows,
    missingCells: profile.missingCells,
    inconsistentColumns: profile.inconsistentColumns,
  },
});
const planMs = performance.now() - planStarted;

const executeStarted = performance.now();
const result = await post<ExecuteSuccess>("/api/execute", { fileName: sample, csvText, pythonCode: plan.python_code, scriptToken });

console.log(JSON.stringify({
  sample,
  model,
  inputRows: profile.rowCount,
  inputBytes: Buffer.byteLength(csvText),
  planMs: Math.round(planMs),
  transformations: plan.transformations.map((item) => item.title),
  executeMs: Math.round(performance.now() - executeStarted),
  sandboxExecMs: result.execMs,
  attempts: result.attempts.map(({ number, status, failure }) => ({ number, status, failure })),
  verification: {
    passed: result.verification.passed,
    outputRows: result.verification.outputRows,
    duplicates: `${result.verification.duplicatesBefore} → ${result.verification.duplicatesAfter}`,
    edgeSpaces: `${result.verification.whitespaceBefore} → ${result.verification.whitespaceAfter}`,
    unresolvedCells: result.verification.unresolvedCells,
    checks: result.verification.checks.map((check) => `${check.passed ? "✓" : check.blocking ? "✗" : "!"} ${check.name}`),
  },
}, null, 2));
