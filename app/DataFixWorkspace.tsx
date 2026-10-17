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
  const [error, setError] = useState("");
  const profile = useMemo(() => csvText ? profileCsv(csvText) : null, [csvText]);

  function acceptFile(name: string, text: string) {
    setError("");
    setInspected(false);
    setInspectionState("idle");
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
    acceptFile(sample.name, sample.csv);
  }

  function inspectDataset() {
    if (!profile || inspectionState === "running") return;
    setInspectionState("running");
    window.setTimeout(() => {
      setInspected(true);
      setInspectionState("complete");
      window.setTimeout(() => {
        document.getElementById("inspection-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 180);
    }, 700);
  }

  return (
    <>
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
            <article><span>Whitespace</span><strong>{profile.whitespaceCells}</strong><small>cells to trim</small></article>
          </div>
          <div className="analysis-grid">
            <div className="preview-table-wrap">
              <div className="panel-title"><span>Dataset preview</span><small>{fileName}</small></div>
              <div className="table-scroll"><table><thead><tr>{profile.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
                <tbody>{profile.rows.slice(0, 5).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => <td key={`${rowIndex}-${columnIndex}`} className={!cell.trim() ? "empty-cell" : ""}>{cell || "—"}</td>)}</tr>)}</tbody>
              </table></div>
            </div>
            <div className="issues-panel">
              <div className="panel-title"><span>Quality signals</span><small>{profile.duplicateRows + profile.missingCells + profile.whitespaceCells} signals</small></div>
              <ul>
                <li><b>{profile.duplicateRows ? "Review" : "Clear"}</b><span>Exact duplicate rows</span><em>{profile.duplicateRows}</em></li>
                <li><b>{profile.missingCells ? "Review" : "Clear"}</b><span>Missing values</span><em>{profile.missingCells}</em></li>
                <li><b>{profile.whitespaceCells ? "Safe fix" : "Clear"}</b><span>Leading/trailing whitespace</span><em>{profile.whitespaceCells}</em></li>
                <li><b>{profile.inconsistentColumns.length ? "Review" : "Clear"}</b><span>Case variants</span><em>{profile.inconsistentColumns.length}</em></li>
              </ul>
              <div className="next-step"><span>Next build step</span><p>Generate a repair plan and Python script, then execute it in CreateOS—not in the browser.</p><button type="button" disabled>Connect secure executor →</button></div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
