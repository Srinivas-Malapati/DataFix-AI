"use client";

import type { ChangeEvent, DragEvent } from "react";
import { LIMITS } from "../../lib/contract.ts";
import { SAMPLE_DATASETS } from "./samples.ts";
import type { Dataset } from "./state.ts";

type Props = {
  dataset: Dataset | null;
  loadError: string;
  goal: string;
  inspecting: boolean;
  inspected: boolean;
  onFile: (file: File) => void;
  onReject: (message: string) => void;
  onSample: (sampleId: string) => void;
  onGoalChange: (goal: string) => void;
  onInspect: () => void;
};

const maxMb = LIMITS.maxCsvBytes / 1024 / 1024;

export function UploadPanel({ dataset, loadError, goal, inspecting, inspected, onFile, onReject, onSample, onGoalChange, onInspect }: Props) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onFile(file);
    event.target.value = ""; // allow re-selecting the same file
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file || (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv")) {
      onReject("Please drop a .csv file.");
      return;
    }
    onFile(file);
  }

  const rows = dataset?.table.rows.length ?? 0;
  const inspectLabel = inspecting ? "Inspecting dataset…" : dataset ? "Inspect dataset" : "Upload a dataset to begin";

  return (
    <section className="workspace" id="workspace" aria-labelledby="workspace-title">
      <div className="workspace-heading">
        <div><p className="section-label">Step 01 · Inspect</p><h2 id="workspace-title">Give your dataset a clean start.</h2></div>
        <span className="run-id">LOCAL PROFILER / READY</span>
      </div>
      <div className="work-grid">
        <div className={`upload-card ${dataset ? "has-file" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
          <div className="file-icon" aria-hidden="true">{dataset ? "✓" : "CSV"}</div>
          <h3>{dataset?.fileName || "Drop a CSV here"}</h3>
          <p>{dataset ? `${rows.toLocaleString()} rows · ${dataset.table.headers.length} columns` : "or choose a file from your computer"}</p>
          <div className="upload-actions">
            <label className="button button-lime" htmlFor="dataset-upload">{dataset ? "Replace dataset" : "Choose dataset"}</label>
          </div>
          <input id="dataset-upload" type="file" accept=".csv,text/csv" onChange={handleChange} />
          <small>Up to {maxMb} MB · parsed only in this browser for step 1</small>
          {loadError && <p className="file-error" role="alert">{loadError}</p>}
          {dataset && (
            <p className="upload-success" role="status">
              <b>✓</b> {dataset.source === "sample" ? "Sample loaded" : "Upload successful"} · {rows.toLocaleString()} data row{rows === 1 ? "" : "s"} ready to inspect
            </p>
          )}
          <div className="sample-library" aria-label="Synthetic test datasets">
            <span>Try a synthetic dataset</span>
            <div>
              {SAMPLE_DATASETS.map((sample) => (
                <button key={sample.id} type="button" onClick={() => onSample(sample.id)} aria-label={`Load ${sample.label} sample: ${sample.detail}`}>
                  <b>{sample.label}</b><small>{sample.detail}</small>
                </button>
              ))}
            </div>
            <a href="/samples/" aria-label="Download the sample CSV files">Download samples ↗</a>
          </div>
        </div>
        <div className="instruction-card">
          <label htmlFor="repair-goal">What should DataFix repair?</label>
          <textarea id="repair-goal" value={goal} maxLength={LIMITS.maxGoalChars} onChange={(event) => onGoalChange(event.target.value)} />
          <div className="guardrails"><span>✓ Preserve original data</span><span>✓ Flag uncertain changes</span></div>
          <button className="button button-dark button-wide" type="button" disabled={!dataset || inspecting} onClick={onInspect}>
            {inspectLabel} <span>{inspecting ? "•••" : "→"}</span>
          </button>
          {(inspecting || inspected) && (
            <div className={`inspection-feedback ${inspecting ? "running" : "complete"}`} role="status" aria-live="polite">
              <span className="feedback-icon" aria-hidden="true">{inspecting ? "" : "✓"}</span>
              <div>
                <b>{inspecting ? "Inspection in progress" : "Inspection complete"}</b>
                <small>{inspecting ? `Profiling ${dataset?.fileName} for quality signals…` : "Your report is ready below."}</small>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
