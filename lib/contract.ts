/**
 * The contract between the browser, the API routes, the AI, and the sandbox.
 * Limits, sandbox paths, and the generated-script rules are defined once here
 * so the prompt, the static policy check, and the UI can never drift apart.
 */

export const LIMITS = {
  maxCsvBytes: 10 * 1024 * 1024,
  maxGoalChars: 2_000,
  maxFileNameChars: 255,
  maxColumns: 500,
  maxHeaderChars: 200,
  sampleRows: 12,
  maxSampleCellChars: 200,
  maxScriptChars: 60_000,
  maxAttempts: 3,
  scriptTimeoutSeconds: 120,
} as const;

export const SANDBOX_PATHS = {
  input: "/workspace/input.csv",
  script: "/workspace/repair.py",
  output: "/workspace/output.csv",
  report: "/workspace/report.json",
} as const;

/** Standard-library modules a generated script may import. Everything else is rejected. */
export const ALLOWED_MODULES = [
  "calendar", "collections", "copy", "csv", "dataclasses", "datetime", "decimal",
  "enum", "fractions", "functools", "hashlib", "io", "itertools", "json", "math",
  "operator", "re", "statistics", "string", "textwrap", "time", "typing", "unicodedata",
] as const;

export const SCRIPT_CONTRACT = [
  "Write one complete Python 3 program.",
  `Import only these standard-library modules: ${ALLOWED_MODULES.join(", ")}.`,
  `Read ${SANDBOX_PATHS.input}; write the cleaned CSV to ${SANDBOX_PATHS.output} and an audit report to ${SANDBOX_PATHS.report}.`,
  "Keep the header row byte-for-byte identical and in the same order; every output row must have exactly one value per column.",
  "Trim leading and trailing spaces from every cell.",
  "Never invent, infer, or fill in missing values. Leave blanks blank and flag them in the report notes.",
  "Never add rows. Only remove rows that are duplicates.",
  "report.json must be a JSON object with input_rows, output_rows, duplicate_rows_removed, changed_cells, flagged_rows (integers), validation_passed (boolean), and notes (array of short strings).",
  "Do not use the network, subprocesses, eval, exec, compile, dynamic imports, dunder attribute access, or any path outside /workspace.",
  "Print short progress lines to stdout for the execution log.",
  "Return plain code without Markdown fences.",
].map((rule) => `- ${rule}`).join("\n");

export type TransformationRisk = "safe" | "review";

export type Transformation = {
  title: string;
  rationale: string;
  risk: TransformationRisk;
  affected_columns: string[];
};

export type CleanupPlan = {
  summary: string;
  transformations: Transformation[];
  validation_checks: string[];
  python_code: string;
};

export type PlanRequest = {
  fileName: string;
  goal: string;
  headers: string[];
  sampleRows: string[][];
  profile: {
    rows: number;
    duplicateRows: number;
    missingCells: number;
    inconsistentColumns: string[];
  };
};

export type PlanResponse = {
  plan: CleanupPlan;
  model: string;
  /** Server signature binding this exact script; required to execute it. */
  scriptToken: string;
};

export type ExecuteRequest = {
  fileName: string;
  csvText: string;
  pythonCode: string;
  scriptToken: string;
};

export type AttemptStatus = "succeeded" | "failed" | "rejected";

export type FailureKind = "policy" | "runtime" | "timeout" | "missing_output" | "validation";

export type Attempt = {
  number: number;
  status: AttemptStatus;
  exitCode: number | null;
  logs: string;
  /** Why this attempt failed, in plain language. */
  failure?: string;
  /** The AI's diagnosis that produced this attempt's (repaired) code. */
  diagnosis?: string;
};

export type VerificationCheck = {
  id: string;
  name: string;
  passed: boolean;
  /** Blocking checks must pass for the output to be released. */
  blocking: boolean;
  detail?: string;
};

export type ScriptReport = {
  input_rows?: number;
  output_rows?: number;
  duplicate_rows_removed?: number;
  changed_cells?: number;
  flagged_rows?: number;
  validation_passed?: boolean;
  notes: string[];
};

export type Verification = {
  passed: boolean;
  inputRows: number;
  outputRows: number;
  duplicatesBefore: number;
  duplicatesAfter: number;
  whitespaceBefore: number;
  whitespaceAfter: number;
  unresolvedCells: number;
  checks: VerificationCheck[];
};

export type ExecuteSuccess = {
  status: "succeeded";
  outputCsv: string;
  report: ScriptReport | null;
  verification: Verification;
  logs: string;
  execMs: number | null;
  runtime: "CreateOS Sandbox";
  sourceFile: string;
  repaired: boolean;
  attempts: Attempt[];
  finalPythonCode: string;
};

export type ApiErrorBody = {
  error: string;
  requestId?: string;
  attempts?: Attempt[];
  verification?: Verification;
};
