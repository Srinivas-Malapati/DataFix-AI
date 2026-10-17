import type { CleanupPlan, ExecuteSuccess } from "../../lib/contract.ts";
import type { CsvProfile, CsvTable } from "../../lib/csv.ts";
import { DEFAULT_GOAL } from "./samples.ts";

export type Notification = { kind: "working" | "success" | "error"; title: string; message: string };

export type Dataset = {
  /** Increments on every load so late async results for an old file are ignored. */
  id: number;
  fileName: string;
  csvText: string;
  table: CsvTable;
  source: "upload" | "sample";
};

export type PlanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; plan: CleanupPlan; scriptToken: string }
  | { status: "error"; message: string };

export type ExecutionState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "succeeded"; result: ExecuteSuccess }
  | { status: "error"; message: string };

export type WorkspaceState = {
  dataset: Dataset | null;
  loadError: string;
  goal: string;
  inspection: { status: "idle" | "running" } | { status: "complete"; profile: CsvProfile };
  plan: PlanState;
  execution: ExecutionState;
  notification: Notification | null;
};

export type WorkspaceAction =
  | { type: "dataset/loaded"; dataset: Dataset; goal?: string }
  | { type: "dataset/rejected"; message: string }
  | { type: "goal/changed"; goal: string }
  | { type: "inspection/started" }
  | { type: "inspection/completed"; datasetId: number; profile: CsvProfile }
  | { type: "plan/started" }
  | { type: "plan/succeeded"; datasetId: number; plan: CleanupPlan; scriptToken: string }
  | { type: "plan/failed"; datasetId: number; message: string }
  | { type: "execution/started" }
  | { type: "execution/succeeded"; datasetId: number; result: ExecuteSuccess }
  | { type: "execution/failed"; datasetId: number; message: string }
  | { type: "notify"; notification: Notification | null };

export const initialState: WorkspaceState = {
  dataset: null,
  loadError: "",
  goal: DEFAULT_GOAL,
  inspection: { status: "idle" },
  plan: { status: "idle" },
  execution: { status: "idle" },
  notification: null,
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  // Drop results that belong to a dataset the user has since replaced.
  if ("datasetId" in action && action.datasetId !== state.dataset?.id) return state;

  switch (action.type) {
    case "dataset/loaded": {
      const rows = action.dataset.table.rows.length;
      const isSample = action.dataset.source === "sample";
      return {
        ...initialState,
        dataset: action.dataset,
        goal: action.goal ?? state.goal,
        notification: {
          kind: "success",
          title: isSample ? "Sample dataset loaded" : "Upload complete",
          message: `${action.dataset.fileName} contains ${plural(rows, "data row")} and is ready to inspect.`,
        },
      };
    }
    case "dataset/rejected":
      return { ...state, loadError: action.message };
    case "goal/changed":
      return { ...state, goal: action.goal };
    case "inspection/started":
      return {
        ...state,
        inspection: { status: "running" },
        notification: { kind: "working", title: "Inspecting dataset", message: `Profiling every row in ${state.dataset?.fileName}.` },
      };
    case "inspection/completed":
      return {
        ...state,
        inspection: { status: "complete", profile: action.profile },
        notification: { kind: "success", title: "Inspection complete", message: `${plural(action.profile.rowCount, "row")} inspected. Review the report below.` },
      };
    case "plan/started":
      return {
        ...state,
        plan: { status: "loading" },
        execution: { status: "idle" },
        notification: { kind: "working", title: "Preparing a dataset-specific workflow", message: `Analyzing ${state.dataset?.fileName}, its quality signals, and your instructions.` },
      };
    case "plan/succeeded":
      return {
        ...state,
        plan: { status: "ready", plan: action.plan, scriptToken: action.scriptToken },
        notification: { kind: "success", title: "Cleanup workflow ready", message: `${plural(action.plan.transformations.length, "transformation")} created for ${state.dataset?.fileName}.` },
      };
    case "plan/failed":
      return { ...state, plan: { status: "error", message: action.message }, notification: { kind: "error", title: "Workflow could not be prepared", message: action.message } };
    case "execution/started":
      return {
        ...state,
        execution: { status: "running" },
        notification: { kind: "working", title: "CreateOS execution started", message: "Running the approved script in a temporary sandbox." },
      };
    case "execution/succeeded": {
      const { result } = action;
      // Show the code that actually produced the output, including any automatic repair.
      const plan = state.plan.status === "ready" && result.repaired ? { ...state.plan, plan: { ...state.plan.plan, python_code: result.finalPythonCode } } : state.plan;
      return {
        ...state,
        plan,
        execution: { status: "succeeded", result },
        notification: {
          kind: "success",
          title: result.repaired ? "Code repaired · cleanup complete" : "Cleanup complete",
          message: "Modified CSV ready to download.",
        },
      };
    }
    case "execution/failed":
      return { ...state, execution: { status: "error", message: action.message }, notification: { kind: "error", title: "Execution needs attention", message: action.message } };
    case "notify":
      return { ...state, notification: action.notification };
  }
}
