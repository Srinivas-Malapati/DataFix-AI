"use client";

import { useCallback, useReducer, useRef } from "react";
import { LIMITS } from "../../lib/contract.ts";
import { CsvParseError, parseCsvTable, profileTable } from "../../lib/csv.ts";
import { requestExecution, requestPlan } from "./api.ts";
import { ExecutionReport } from "./ExecutionReport.tsx";
import { InspectionReport } from "./InspectionReport.tsx";
import { SAMPLE_DATASETS } from "./samples.ts";
import { initialState, workspaceReducer, type Dataset } from "./state.ts";
import { Toast } from "./Toast.tsx";
import { UploadPanel } from "./UploadPanel.tsx";
import { WorkflowReview } from "./WorkflowReview.tsx";

/** Keeps the progress state visible long enough to register, even for tiny files. */
const MIN_INSPECTION_MS = 450;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function scrollToSection(id: string) {
  window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 160);
}

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

export function DataFixWorkspace() {
  const [state, dispatch] = useReducer(workspaceReducer, initialState);
  const datasetIds = useRef(0);
  const { dataset, inspection, plan, execution } = state;

  function loadDataset(fileName: string, csvText: string, source: Dataset["source"], goal?: string) {
    if (new TextEncoder().encode(csvText).byteLength > LIMITS.maxCsvBytes) {
      dispatch({ type: "dataset/rejected", message: `That file is larger than the ${LIMITS.maxCsvBytes / 1024 / 1024} MB limit.` });
      return;
    }
    let table;
    try {
      table = parseCsvTable(csvText);
    } catch (error) {
      dispatch({ type: "dataset/rejected", message: error instanceof CsvParseError ? error.message : "That file could not be read as CSV." });
      return;
    }
    if (table.headers.length < 2 || table.rows.length < 1) {
      dispatch({ type: "dataset/rejected", message: "Choose a CSV with a header row, at least two columns, and at least one data row." });
      return;
    }
    datasetIds.current += 1;
    dispatch({ type: "dataset/loaded", dataset: { id: datasetIds.current, fileName, csvText, table, source }, goal });
  }

  async function handleFile(file: File) {
    loadDataset(file.name, await file.text(), "upload");
  }

  function handleSample(sampleId: string) {
    const sample = SAMPLE_DATASETS.find((candidate) => candidate.id === sampleId);
    if (sample) loadDataset(sample.name, sample.csv, "sample", sample.goal);
  }

  async function inspect() {
    if (!dataset || inspection.status === "running") return;
    dispatch({ type: "inspection/started" });
    const started = performance.now();
    await nextFrame(); // let the progress state paint before profiling large files
    const profile = profileTable(dataset.table);
    await sleep(Math.max(0, MIN_INSPECTION_MS - (performance.now() - started)));
    dispatch({ type: "inspection/completed", datasetId: dataset.id, profile });
    scrollToSection("inspection-results");
  }

  async function preparePlan() {
    if (!dataset || inspection.status !== "complete") return;
    const { profile } = inspection;
    dispatch({ type: "plan/started" });
    try {
      const response = await requestPlan({
        fileName: dataset.fileName,
        goal: state.goal,
        headers: dataset.table.headers,
        sampleRows: dataset.table.rows.slice(0, LIMITS.sampleRows),
        profile: {
          rows: profile.rowCount,
          duplicateRows: profile.duplicateRows,
          missingCells: profile.missingCells,
          inconsistentColumns: profile.inconsistentColumns,
        },
      });
      dispatch({ type: "plan/succeeded", datasetId: dataset.id, plan: response.plan, scriptToken: response.scriptToken });
      scrollToSection("repair-plan");
    } catch (error) {
      dispatch({ type: "plan/failed", datasetId: dataset.id, message: errorMessage(error, "DataFix could not prepare a workflow.") });
    }
  }

  async function execute() {
    if (!dataset || plan.status !== "ready" || execution.status === "running") return;
    dispatch({ type: "execution/started" });
    try {
      const result = await requestExecution({
        fileName: dataset.fileName,
        csvText: dataset.csvText,
        pythonCode: plan.plan.python_code,
        scriptToken: plan.scriptToken,
      });
      dispatch({ type: "execution/succeeded", datasetId: dataset.id, result });
      scrollToSection("execution-result");
    } catch (error) {
      dispatch({ type: "execution/failed", datasetId: dataset.id, message: errorMessage(error, "CreateOS execution failed.") });
    }
  }

  function downloadResult() {
    if (!dataset || execution.status !== "succeeded") return;
    const url = URL.createObjectURL(new Blob([execution.result.outputCsv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cleaned_${dataset.fileName}`;
    anchor.click();
    URL.revokeObjectURL(url);
    dispatch({ type: "notify", notification: { kind: "success", title: "Modified CSV downloaded", message: `cleaned_${dataset.fileName} saved.` } });
  }

  const dismissNotification = useCallback(() => dispatch({ type: "notify", notification: null }), []);

  return (
    <>
      <Toast notification={state.notification} onDismiss={dismissNotification} />
      <UploadPanel
        dataset={dataset}
        loadError={state.loadError}
        goal={state.goal}
        inspecting={inspection.status === "running"}
        inspected={inspection.status === "complete"}
        onFile={handleFile}
        onReject={(message) => dispatch({ type: "dataset/rejected", message })}
        onSample={handleSample}
        onGoalChange={(goal) => dispatch({ type: "goal/changed", goal })}
        onInspect={inspect}
      />
      {dataset && inspection.status === "complete" && (
        <InspectionReport fileName={dataset.fileName} table={dataset.table} profile={inspection.profile} plan={plan} onPrepare={preparePlan} />
      )}
      {dataset && plan.status === "ready" && (
        <WorkflowReview fileName={dataset.fileName} columnCount={dataset.table.headers.length} plan={plan.plan} execution={execution} onExecute={execute} />
      )}
      {execution.status === "succeeded" && <ExecutionReport result={execution.result} onDownload={downloadResult} />}
    </>
  );
}
