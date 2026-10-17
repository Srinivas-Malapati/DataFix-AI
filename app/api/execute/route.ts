const forbiddenCode = /\b(import\s+(os|subprocess|socket|requests|urllib)|from\s+(os|subprocess|socket|requests|urllib)|eval\s*\(|exec\s*\(|__import__)/;

const REPAIR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    diagnosis: { type: "string" },
    python_code: { type: "string" },
  },
  required: ["diagnosis", "python_code"],
} as const;

function getOutputText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: string }).type === "output_text" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

async function repairFailedCode(input: { fileName: string; pythonCode: string; logs: string; exitCode: number }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Automatic code repair is not configured.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      store: false,
      instructions: "You repair a failed, AI-generated CSV cleanup program. Diagnose the execution error and return a corrected complete Python 3 script. Preserve the existing cleanup intent and safety contract: use only standard-library modules; read /workspace/input.csv; write /workspace/output.csv and /workspace/report.json; preserve column order; never invent missing values; do not use network, shell, subprocess, eval, exec, dynamic imports, or any path outside /workspace. report.json must contain input_rows, output_rows, duplicate_rows_removed, changed_cells, flagged_rows, validation_passed, and notes. Return code without Markdown fences.",
      input: JSON.stringify({ file_name: input.fileName, failed_code: input.pythonCode, exit_code: input.exitCode, execution_output: input.logs.slice(0, 8000) }),
      text: { format: { type: "json_schema", name: "datafix_code_repair", strict: true, schema: REPAIR_SCHEMA } },
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error((payload.error as { message?: string } | undefined)?.message || "The AI could not repair the failed script.");
  const outputText = getOutputText(payload);
  if (!outputText) throw new Error("The AI returned no repaired script.");
  return JSON.parse(outputText) as { diagnosis: string; python_code: string };
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell); if (row.some((value) => value.length)) rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  row.push(cell); if (row.some((value) => value.length)) rows.push(row);
  return rows;
}

function duplicateCount(rows: string[][]) {
  const keys = rows.map((row) => JSON.stringify(row));
  return keys.length - new Set(keys).size;
}

function edgeWhitespaceCount(rows: string[][]) {
  return rows.reduce((count, row) => count + row.filter((cell) => cell !== cell.trim()).length, 0);
}

function unresolvedCellCount(rows: string[][]) {
  return rows.reduce((count, row) => count + row.filter((cell) => !cell.trim()).length, 0);
}

async function createOsFetch(baseUrl: string, apiKey: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { "X-Api-Key": apiKey, ...(init.headers || {}) },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`CreateOS request failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  return response;
}

export async function POST(request: Request) {
  let sandboxId = "";
  const apiKey = process.env.CREATEOS_PROJECT_API_KEY || process.env.CREATEOS_SANDBOX_API_KEY;
  const baseUrl =
    process.env.CREATEOS_PROJECT_API_URL ||
    process.env.CREATEOS_SANDBOX_BASE_URL ||
    "https://api.sb.createos.sh";
  if (!apiKey) return Response.json({ error: "CreateOS execution is not configured." }, { status: 503 });

  try {
    const body = await request.json() as { csvText?: string; pythonCode?: string; fileName?: string };
    if (!body.csvText || !body.pythonCode) return Response.json({ error: "CSV data and an approved script are required." }, { status: 400 });
    if (new Blob([body.csvText]).size > 10 * 1024 * 1024) return Response.json({ error: "The dataset exceeds the 10 MB limit." }, { status: 413 });
    if (forbiddenCode.test(body.pythonCode)) return Response.json({ error: "The generated script did not pass the execution safety check. Rebuild the workflow." }, { status: 400 });

    const created = await createOsFetch(baseUrl, apiKey, "/v1/sandboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shape: "s-1vcpu-1gb",
        rootfs: "devbox:1",
        name: `datafix-${Date.now()}`,
        ingress_enabled: false,
        auto_pause_after_seconds: 300,
        egress: ["blocked.invalid:443"],
      }),
    });
    const createdJson = await created.json() as { data?: { id?: string } };
    sandboxId = createdJson.data?.id || "";
    if (!sandboxId) throw new Error("CreateOS did not return a sandbox ID.");

    await createOsFetch(baseUrl, apiKey, `/v1/sandboxes/${sandboxId}/files?path=${encodeURIComponent("/workspace/input.csv")}`, {
      method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: body.csvText,
    });

    type SandboxResult = { stdout?: string; stderr?: string; exit_code?: number };
    type SandboxExecution = { data?: { result?: SandboxResult; exec_ms?: number } };
    const attempts: Array<{ number: number; status: "failed" | "succeeded"; exitCode: number; logs: string; diagnosis?: string }> = [];
    let activeCode = body.pythonCode;
    let repairDiagnosis = "";
    let execution: SandboxExecution | null = null;
    let result: SandboxResult | undefined;

    for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
      await createOsFetch(baseUrl, apiKey, `/v1/sandboxes/${sandboxId}/files?path=${encodeURIComponent("/workspace/repair.py")}`, {
        method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: activeCode,
      });
      const executed = await createOsFetch(baseUrl, apiKey, `/v1/sandboxes/${sandboxId}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "/usr/bin/python3", args: ["/workspace/repair.py"] }),
      });
      execution = await executed.json() as SandboxExecution;
      result = execution.data?.result;
      const logs = `${result?.stdout || ""}${result?.stderr || ""}`.trim();
      const succeeded = Boolean(result && result.exit_code === 0);
      attempts.push({ number: attemptNumber, status: succeeded ? "succeeded" : "failed", exitCode: result?.exit_code ?? -1, logs, ...(repairDiagnosis ? { diagnosis: repairDiagnosis } : {}) });
      if (succeeded) break;
      if (attemptNumber === 2) {
        return Response.json({ error: "The generated script still failed after one automatic repair attempt.", attempts }, { status: 422 });
      }
      const repaired = await repairFailedCode({ fileName: body.fileName || "input.csv", pythonCode: activeCode, logs, exitCode: result?.exit_code ?? -1 });
      if (forbiddenCode.test(repaired.python_code)) return Response.json({ error: "The repaired script did not pass the execution safety check.", attempts }, { status: 422 });
      repairDiagnosis = repaired.diagnosis;
      activeCode = repaired.python_code;
    }

    if (!execution || !result || result.exit_code !== 0) return Response.json({ error: "CreateOS execution did not complete.", attempts }, { status: 422 });

    const [outputResponse, reportResponse] = await Promise.all([
      createOsFetch(baseUrl, apiKey, `/v1/sandboxes/${sandboxId}/files?path=${encodeURIComponent("/workspace/output.csv")}`),
      createOsFetch(baseUrl, apiKey, `/v1/sandboxes/${sandboxId}/files?path=${encodeURIComponent("/workspace/report.json")}`),
    ]);
    const outputCsv = await outputResponse.text();
    const reportText = await reportResponse.text();
    const inputRows = parseCsv(body.csvText);
    const outputRows = parseCsv(outputCsv);
    const sameSchema = JSON.stringify(inputRows[0] || []) === JSON.stringify(outputRows[0] || []);
    const rowCountSafe = outputRows.length > 1 && outputRows.length <= inputRows.length;
    const whitespaceBefore = edgeWhitespaceCount(inputRows.slice(1));
    const whitespaceAfter = edgeWhitespaceCount(outputRows.slice(1));
    const whitespaceResolved = whitespaceBefore === 0 || whitespaceAfter === 0;
    const verification = {
      passed: sameSchema && rowCountSafe && whitespaceResolved,
      inputRows: Math.max(0, inputRows.length - 1),
      outputRows: Math.max(0, outputRows.length - 1),
      duplicatesBefore: duplicateCount(inputRows.slice(1)),
      duplicatesAfter: duplicateCount(outputRows.slice(1)),
      whitespaceBefore,
      whitespaceAfter,
      unresolvedCells: unresolvedCellCount(outputRows.slice(1)),
      checks: [
        { name: "Column order preserved", passed: sameSchema },
        { name: "Output contains data", passed: outputRows.length > 1 },
        { name: "No unexpected row growth", passed: rowCountSafe },
        { name: whitespaceBefore ? "Extra edge spaces removed" : "No extra edge spaces detected", passed: whitespaceResolved },
      ],
    };
    if (!verification.passed) return Response.json({ error: "Independent validation rejected the sandbox output.", logs: `${result.stdout || ""}${result.stderr || ""}`.trim(), verification }, { status: 422 });
    return Response.json({
      status: "succeeded",
      outputCsv,
      report: JSON.parse(reportText),
      verification,
      logs: `${result.stdout || ""}${result.stderr || ""}`.trim(),
      execMs: execution.data?.exec_ms ?? null,
      runtime: "CreateOS Sandbox",
      sourceFile: body.fileName || "input.csv",
      repaired: attempts.length > 1,
      attempts,
      finalPythonCode: activeCode,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Sandbox execution failed." }, { status: 500 });
  } finally {
    if (sandboxId) {
      try { await createOsFetch(baseUrl, apiKey, `/v1/sandboxes/${sandboxId}`, { method: "DELETE" }); } catch { /* best-effort cleanup */ }
    }
  }
}
