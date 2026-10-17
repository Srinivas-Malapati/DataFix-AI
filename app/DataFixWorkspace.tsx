"use client";

import { ChangeEvent, DragEvent, useMemo, useState } from "react";

type CsvProfile = {
  headers: string[];
  rows: string[][];
  duplicateRows: number;
  missingCells: number;
  whitespaceCells: number;
  inconsistentColumns: string[];
};

type AiPlan = {
  summary: string;
  transformations: Array<{ title: string; rationale: string; risk: "safe" | "review"; affected_columns: string[] }>;
  validation_checks: string[];
  python_code: string;
};

type ExecutionResult = {
  outputCsv: string;
  report: { input_rows?: number; output_rows?: number; duplicate_rows_removed?: number; changed_cells?: number; flagged_rows?: number; validation_passed?: boolean; notes?: string[] };
  logs: string;
  execMs: number | null;
  runtime: string;
  verification: { passed: boolean; inputRows: number; outputRows: number; duplicatesBefore: number; duplicatesAfter: number; whitespaceBefore: number; whitespaceAfter: number; unresolvedCells: number; checks: Array<{ name: string; passed: boolean }> };
};

type Notification = { kind: "working" | "success" | "error"; title: string; message: string };

const SAMPLE_DATASETS = [
  {
    id: "sales",
    name: "sales_messy.csv",
    label: "Sales",
    detail: "Duplicates · currency · casing",
    goal: "Standardize product names, normalize currency values, remove exact duplicates, and flag missing payment statuses.",
    csv: `order_id,customer,product,amount,status
1001, Ada Lovelace ,pro plan,"$1,200.00",paid
1002,grace hopper,Starter,"$49.00",PAID
1002,grace hopper,Starter,"$49.00",PAID
1003,Linus Torvalds,PRO PLAN,1200,
1004,Margaret Hamilton, starter ,"$49",Paid`,
  },
  {
    id: "customers",
    name: "customers_messy.csv",
    label: "Customers",
    detail: "Whitespace · emails · missing fields",
    goal: "Trim safe text fields, normalize email casing, preserve customer IDs, and flag missing contact information for review.",
    csv: `customer_id,full_name,email,city,segment
C-001,  Katherine Johnson ,KJ@EXAMPLE.COM,houston,Enterprise
C-002,alan turing,alan@example.com, Manchester ,enterprise
C-003,Grace Hopper,,New York,SMB
C-004, Tim Berners-Lee ,tim@example.com,london,smb
C-005,Barbara Liskov,barbara@example.com,,Enterprise`,
  },
  {
    id: "transactions",
    name: "transactions_messy.csv",
    label: "Transactions",
    detail: "Dates · refunds · ambiguity",
    goal: "Normalize unambiguous dates and payment methods, preserve legitimate negative refunds, and flag ambiguous dates instead of guessing.",
    csv: `transaction_id,date,amount,payment_method,note
T-1001,2026-10-01,249.99,CARD,subscription
T-1002,10/02/2026,-49.00,card,refund
T-1003,03/04/2026,89.50,ACH,ambiguous date
T-1004,2026/10/05,120.00, ach ,renewal
T-1005,,35.25,Cash,date missing`,
  },
] as const;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function profileCsv(text: string): CsvProfile {
  const parsed = parseCsv(text);
  const headers = parsed[0] ?? [];
  const rows = parsed.slice(1).map((row) => headers.map((_, index) => row[index] ?? ""));
  const rowKeys = rows.map((row) => JSON.stringify(row));
  const duplicateRows = rowKeys.length - new Set(rowKeys).size;
  let missingCells = 0;
  let whitespaceCells = 0;

  rows.forEach((row) => row.forEach((value) => {
    if (!value.trim()) missingCells += 1;
    if (value !== value.trim()) whitespaceCells += 1;
  }));

  const inconsistentColumns = headers.filter((_, columnIndex) => {
    const groups = new Map<string, Set<string>>();
    rows.forEach((row) => {
      const value = row[columnIndex]?.trim();
      if (!value || !/[a-z]/i.test(value)) return;
      const key = value.toLocaleLowerCase();
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key)?.add(value);
    });
    return [...groups.values()].some((variants) => variants.size > 1);
  });

  return { headers, rows, duplicateRows, missingCells, whitespaceCells, inconsistentColumns };
}

export function DataFixWorkspace() {
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [goal, setGoal] = useState("Clean this dataset, standardize inconsistent formats, remove exact duplicates, and flag anything ambiguous for review.");
  const [inspected, setInspected] = useState(false);
  const [inspectionState, setInspectionState] = useState<"idle" | "running" | "complete">("idle");
  const [uploadMessage, setUploadMessage] = useState("");
  const [planState, setPlanState] = useState<"idle" | "generating" | "ready" | "error">("idle");
  const [aiPlan, setAiPlan] = useState<AiPlan | null>(null);
  const [planError, setPlanError] = useState("");
  const [executionState, setExecutionState] = useState<"idle" | "running" | "succeeded" | "error">("idle");
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [executionError, setExecutionError] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [notification, setNotification] = useState<Notification | null>(null);
  const profile = useMemo(() => csvText ? profileCsv(csvText) : null, [csvText]);

  function acceptFile(name: string, text: string, source: "upload" | "sample" = "upload") {
    setError("");
    setUploadMessage("");
    setInspected(false);
    setInspectionState("idle");
    setPlanState("idle");
    setAiPlan(null);
    setPlanError("");
    setExecutionState("idle");
    setExecutionResult(null);
    setExecutionError("");
    setCopied(false);
    if (new Blob([text]).size > 10 * 1024 * 1024) {
      setError("That file is larger than the 10 MB demo limit.");
      return;
    }
    const parsed = parseCsv(text);
    if (parsed.length < 2 || parsed[0].length < 2) {
      setError("Choose a CSV with a header row, at least two columns, and at least one data row.");
      return;
    }
    setFileName(name);
    setCsvText(text);
    setUploadMessage(`${source === "sample" ? "Sample loaded" : "Upload successful"} · ${parsed.length - 1} data rows ready to inspect`);
    setNotification({ kind: "success", title: source === "sample" ? "Sample dataset loaded" : "Upload complete", message: `${name} contains ${parsed.length - 1} data rows and is ready to inspect.` });
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) acceptFile(file.name, await file.text());
  }

  async function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file || (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv")) {
      setError("Please drop a .csv file.");
      return;
    }
    acceptFile(file.name, await file.text());
  }

  function loadSample(sampleId: string) {
    const sample = SAMPLE_DATASETS.find((candidate) => candidate.id === sampleId);
    if (!sample) return;
    setGoal(sample.goal);
    acceptFile(sample.name, sample.csv, "sample");
  }

  function inspectDataset() {
    if (!profile || inspectionState === "running") return;
    setInspectionState("running");
    setNotification({ kind: "working", title: "Inspecting dataset", message: `Profiling every row in ${fileName} for quality signals.` });
    window.setTimeout(() => {
      setInspected(true);
      setInspectionState("complete");
      setNotification({ kind: "success", title: "Inspection complete", message: `${profile.rows.length} rows inspected. Review the quality report below.` });
      window.setTimeout(() => {
        document.getElementById("inspection-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 180);
    }, 700);
  }

  async function generatePlan() {
    if (!profile) return;
    setPlanState("generating");
    setPlanError("");
    setExecutionState("idle");
    setExecutionResult(null);
    setNotification({ kind: "working", title: "Preparing a dataset-specific workflow", message: `DataFix AI is analyzing ${fileName}, its quality signals, and your cleanup instructions.` });
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName,
          goal,
          headers: profile.headers,
          sampleRows: profile.rows.slice(0, 12),
          profile: { rows: profile.rows.length, duplicateRows: profile.duplicateRows, missingCells: profile.missingCells, inconsistentColumns: profile.inconsistentColumns },
        }),
      });
      const payload = await response.json() as { plan?: AiPlan; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error || "DataFix could not prepare a workflow.");
      setAiPlan(payload.plan);
      setPlanState("ready");
      setNotification({ kind: "success", title: "Cleanup workflow ready", message: `${payload.plan.transformations.length} transformations were created specifically for ${fileName}.` });
      window.setTimeout(() => document.getElementById("repair-plan")?.scrollIntoView({ behavior: "smooth", block: "start" }), 160);
    } catch (caught) {
      setPlanState("error");
      const message = caught instanceof Error ? caught.message : "DataFix could not prepare a workflow.";
      setPlanError(message);
      setNotification({ kind: "error", title: "Workflow could not be prepared", message });
    }
  }

  async function copyCode() {
    if (!aiPlan) return;
    await navigator.clipboard.writeText(aiPlan.python_code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function executeWorkflow() {
    if (!aiPlan) return;
    setExecutionState("running");
    setExecutionError("");
    setNotification({ kind: "working", title: "CreateOS execution started", message: "Uploading the dataset and running the approved script in a temporary sandbox." });
    try {
      const response = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, csvText, pythonCode: aiPlan.python_code }),
      });
      const payload = await response.json() as ExecutionResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "CreateOS could not execute the workflow.");
      setExecutionResult(payload);
      setExecutionState("succeeded");
      setNotification({ kind: "success", title: "Cleanup complete", message: `A modified CSV is ready. ${payload.verification.unresolvedCells} unresolved cell${payload.verification.unresolvedCells === 1 ? " was" : "s were"} preserved for human review.` });
      window.setTimeout(() => document.getElementById("execution-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 160);
    } catch (caught) {
      setExecutionState("error");
      const message = caught instanceof Error ? caught.message : "CreateOS execution failed.";
      setExecutionError(message);
      setNotification({ kind: "error", title: "Execution needs attention", message });
    }
  }

  function downloadCleanedCsv() {
    if (!executionResult) return;
    const url = URL.createObjectURL(new Blob([executionResult.outputCsv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cleaned_${fileName || "dataset.csv"}`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotification({ kind: "success", title: "Modified CSV downloaded", message: executionResult.verification.unresolvedCells ? `Automatic fixes are included. ${executionResult.verification.unresolvedCells} unresolved cell${executionResult.verification.unresolvedCells === 1 ? " remains" : "s remain"} unchanged for review.` : "All approved changes are included in the downloaded file." });
  }

  return (
    <>
      {notification && (
        <div className={`operation-toast ${notification.kind}`} role="status" aria-live="assertive">
          <span className="toast-mark" aria-hidden="true">{notification.kind === "success" ? "✓" : notification.kind === "error" ? "!" : ""}</span>
          <div><b>{notification.title}</b><small>{notification.message}</small></div>
          <button type="button" onClick={() => setNotification(null)} aria-label="Dismiss notification">×</button>
        </div>
      )}
      <section className="workspace" id="workspace" aria-labelledby="workspace-title">
        <div className="workspace-heading">
          <div><p className="section-label">Step 01 · Inspect</p><h2 id="workspace-title">Give your dataset a clean start.</h2></div>
          <span className="run-id">LOCAL PROFILER / READY</span>
        </div>
        <div className="work-grid">
          <div className={`upload-card ${fileName ? "has-file" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            <div className="file-icon" aria-hidden="true">{fileName ? "✓" : "CSV"}</div>
            <h3>{fileName || "Drop a CSV here"}</h3>
            <p>{fileName && profile ? `${profile.rows.length} rows · ${profile.headers.length} columns` : "or choose a file from your computer"}</p>
            <div className="upload-actions">
              <label className="button button-lime" htmlFor="dataset-upload">{fileName ? "Replace dataset" : "Choose dataset"}</label>
            </div>
            <input id="dataset-upload" type="file" accept=".csv,text/csv" onChange={onFile} />
            <small>Up to 10 MB · parsed only in this browser for step 1</small>
            {error && <p className="file-error" role="alert">{error}</p>}
            {uploadMessage && <p className="upload-success" role="status"><b>✓</b> {uploadMessage}</p>}
            <div className="sample-library" aria-label="Synthetic test datasets">
              <span>Try a synthetic dataset</span>
              <div>
                {SAMPLE_DATASETS.map((sample) => (
                  <button key={sample.id} type="button" onClick={() => loadSample(sample.id)} aria-label={`Load ${sample.label} sample: ${sample.detail}`}>
                    <b>{sample.label}</b><small>{sample.detail}</small>
                  </button>
                ))}
              </div>
              <a href="/samples/" aria-label="Download the sample CSV files">Download samples ↗</a>
            </div>
          </div>
          <div className="instruction-card">
            <label htmlFor="repair-goal">What should DataFix repair?</label>
            <textarea id="repair-goal" value={goal} onChange={(event) => setGoal(event.target.value)} />
            <div className="guardrails"><span>✓ Preserve original data</span><span>✓ Flag uncertain changes</span></div>
            <button className="button button-dark button-wide" type="button" disabled={!profile || inspectionState === "running"} onClick={inspectDataset}>
              {inspectionState === "running" ? "Inspecting dataset…" : profile ? "Inspect dataset" : "Upload a dataset to begin"} <span>{inspectionState === "running" ? "•••" : "→"}</span>
            </button>
            {inspectionState !== "idle" && (
              <div className={`inspection-feedback ${inspectionState}`} role="status" aria-live="assertive">
                <span className="feedback-icon" aria-hidden="true">{inspectionState === "running" ? "" : "✓"}</span>
                <div>
                  <b>{inspectionState === "running" ? "Inspection in progress" : "Inspection complete"}</b>
                  <small>{inspectionState === "running" ? `Profiling ${fileName} for quality signals…` : "Your report is ready below."}</small>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {inspected && profile && (
        <section className="analysis" id="inspection-results" aria-live="polite">
          <div className="analysis-heading">
            <div><p className="section-label">Inspection complete</p><h2>We found what needs attention.</h2></div>
            <span className="verified-badge">Profiled locally</span>
          </div>
          <div className="metrics-grid">
            <article><span>Rows</span><strong>{profile.rows.length}</strong><small>input records</small></article>
            <article><span>Duplicates</span><strong>{profile.duplicateRows}</strong><small>exact row matches</small></article>
            <article><span>Missing</span><strong>{profile.missingCells}</strong><small>empty cells</small></article>
          </div>
          <div className="analysis-grid">
            <div className="preview-table-wrap">
              <div className="panel-title"><span>Dataset preview</span><div className="panel-meta"><small>{fileName}</small><small>{profile.rows.length <= 5 ? `Showing all ${profile.rows.length} rows` : `Showing first 5 of ${profile.rows.length} rows`} · all rows inspected</small></div></div>
              <div className="table-scroll"><table><thead><tr>{profile.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
                <tbody>{profile.rows.slice(0, 5).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => <td key={`${rowIndex}-${columnIndex}`} className={!cell.trim() ? "empty-cell" : ""}>{cell || "—"}</td>)}</tr>)}</tbody>
              </table></div>
            </div>
            <div className="issues-panel">
              <div className="panel-title"><span>Quality signals</span><small>{profile.duplicateRows + profile.missingCells + profile.inconsistentColumns.length} signals</small></div>
              <ul>
                <li><b>{profile.duplicateRows ? "Review" : "Clear"}</b><span>Exact duplicate rows</span><em>{profile.duplicateRows}</em></li>
                <li><b>{profile.missingCells ? "Review" : "Clear"}</b><span>Missing values</span><em>{profile.missingCells}</em></li>
                <li><b>{profile.inconsistentColumns.length ? "Review" : "Clear"}</b><span>Case variants</span><em>{profile.inconsistentColumns.length}</em></li>
              </ul>
              <div className="next-step"><span>Step 02 · AI workflow</span><p>Ask DataFix AI to design transformations and write an execution script for this dataset.</p><button type="button" onClick={generatePlan} disabled={planState === "generating"}>{planState === "generating" ? "Preparing workflow…" : planState === "ready" ? "Rebuild workflow ↻" : "Prepare cleanup workflow →"}</button>{planError && <small className="action-error" role="alert">{planError}</small>}</div>
            </div>
          </div>
        </section>
      )}

      {planState === "ready" && profile && aiPlan && (
        <section className="repair-plan" id="repair-plan" aria-live="polite">
          <div className="plan-heading"><div><p className="section-label">Step 02 · AI workflow</p><h2>Review what DataFix will change.</h2><p className="plan-summary">{aiPlan.summary}</p><p className="dataset-specific-note">Built for <b>{fileName}</b> from its {profile.headers.length} columns, representative rows, detected quality signals, and your instructions.</p></div><span className="review-badge">Human approval required</span></div>
          <div className="plan-grid">
            <div className="plan-actions">
              <div className="panel-title"><span>Recommended transformations</span><small>{fileName} · {aiPlan.transformations.length} actions</small></div>
              <ol>{aiPlan.transformations.map((action, index) => <li key={`${action.title}-${index}`}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{action.title}</strong><small>{action.rationale}</small><em>{action.risk === "safe" ? "Safe change" : "Review advised"}{action.affected_columns.length ? ` · ${action.affected_columns.join(", ")}` : ""}</em></span></li>)}</ol>
              <div className="plan-safety"><b>Validation checks</b><ul>{aiPlan.validation_checks.map((check) => <li key={check}>✓ {check}</li>)}</ul></div>
            </div>
            <div className="code-review">
              <div className="panel-title"><span>Execution script</span><button type="button" onClick={copyCode}>{copied ? "Copied ✓" : "Copy code"}</button></div>
              <pre><code>{aiPlan.python_code}</code></pre>
            </div>
          </div>
          <div className="approval-bar"><div><b>Workflow ready for approval</b><span>DataFix will upload the CSV and execute this exact script in a temporary CreateOS sandbox.</span>{executionError && <small className="action-error" role="alert">{executionError}</small>}</div><button type="button" onClick={executeWorkflow} disabled={executionState === "running"}>{executionState === "running" ? "Running in CreateOS…" : "Review and execute"}<span>{executionState === "running" ? "•••" : "→"}</span></button></div>
        </section>
      )}

      {executionState === "succeeded" && executionResult && (
        <section className="execution-result" id="execution-result" aria-live="polite">
          <div className="result-heading"><div><p className="section-label">Steps 03–04 · Execute & verify</p><h2>Cleanup completed and verified.</h2></div><span className="sandbox-badge">CreateOS Sandbox · success</span></div>
          <div className="result-metrics">
            <article><span>Input rows</span><strong>{executionResult.verification.inputRows}</strong></article>
            <article><span>Output rows</span><strong>{executionResult.verification.outputRows}</strong></article>
            <article><span>Duplicates removed</span><strong>{Math.max(0, executionResult.verification.duplicatesBefore - executionResult.verification.duplicatesAfter)}</strong></article>
            <article><span>Unresolved cells</span><strong>{executionResult.verification.unresolvedCells}</strong></article>
          </div>
          {executionResult.verification.unresolvedCells > 0 && <div className="review-notice"><b>{executionResult.verification.unresolvedCells} value{executionResult.verification.unresolvedCells === 1 ? " was" : "s were"} intentionally left unchanged.</b><span>DataFix removed safe issues such as extra edge spaces and duplicates, but it will not guess missing or ambiguous information. The modified CSV is ready; these cells still need human review.</span></div>}
          <div className="result-grid">
            <div className="run-log"><div className="panel-title"><span>Execution log</span><small>{executionResult.execMs ? `${Math.round(executionResult.execMs)} ms` : executionResult.runtime}</small></div><pre>{executionResult.logs || "Script completed with no console output."}</pre></div>
            <div className="validation-card"><span>Independent validation</span><strong>{executionResult.verification.passed ? "Passed" : "Review required"}</strong><ul>{executionResult.verification.checks.map((check) => <li key={check.name}>{check.passed ? "✓" : "×"} {check.name}</li>)}{(executionResult.report.notes || []).map((note) => <li key={note}>{note}</li>)}</ul><button type="button" onClick={downloadCleanedCsv}>Download modified CSV ↓</button></div>
          </div>
        </section>
      )}
    </>
  );
}
