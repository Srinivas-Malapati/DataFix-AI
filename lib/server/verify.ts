import { CsvParseError, countDuplicateRows, countEdgeWhitespaceCells, countEmptyCells, parseCsvTable, type CsvTable } from "../csv.ts";
import type { ScriptReport, Verification, VerificationCheck } from "../contract.ts";
import { isRecord } from "./http.ts";

/**
 * Application-owned verification of sandbox output. The AI never grades its
 * own work: these checks compare the original and cleaned files directly.
 * Blocking checks gate the release of the output; advisory checks are shown
 * to the reviewer but cannot be enforced exactly (e.g. key-based dedupe may
 * legitimately keep a row whose blank was filled in another copy).
 */
export function verifyOutput(input: CsvTable, outputCsv: string): Verification {
  let output: CsvTable | null = null;
  try {
    output = parseCsvTable(outputCsv);
  } catch (error) {
    if (!(error instanceof CsvParseError)) throw error;
  }

  const outputRows = output?.rows ?? [];
  const sameHeader =
    output !== null &&
    output.headers.length === input.headers.length &&
    output.headers.every((header, index) => header.trim() === input.headers[index].trim());
  const whitespaceAfter = countEdgeWhitespaceCells(outputRows);
  const duplicatesAfter = countDuplicateRows(outputRows);
  const emptyAfter = countEmptyCells(outputRows);
  const minimumEmpty = minimumPreservedEmptyCells(input.rows);

  const check = (id: string, name: string, passed: boolean, blocking: boolean, detail?: string): VerificationCheck =>
    ({ id, name, passed, blocking, ...(detail && !passed ? { detail } : {}) });

  const checks: VerificationCheck[] = [
    check("parseable", "Output is a valid CSV", output !== null, true, "The output file could not be parsed."),
    check("header", "Column names and order preserved", sameHeader, true, "The output header differs from the input header."),
    check("has-rows", "Output contains data", input.rows.length === 0 || outputRows.length > 0, true, "The output has no data rows."),
    check("no-growth", "No rows added", outputRows.length <= input.rows.length, true,
      `Output has ${outputRows.length} rows; input had ${input.rows.length}.`),
    check("width", "Every row has one value per column", (output?.raggedRows ?? 0) === 0, true,
      `${output?.raggedRows ?? 0} rows have the wrong number of values.`),
    check("edge-spaces", "Leading and trailing spaces removed", whitespaceAfter === 0, true,
      `${whitespaceAfter} cells still have leading or trailing spaces.`),
    check("duplicates", "No exact duplicate rows remain", duplicatesAfter === 0, false,
      `${duplicatesAfter} exact duplicate rows remain.`),
    check("no-invented-values", "Missing values left for review, not filled in", emptyAfter >= minimumEmpty, false,
      `Expected at least ${minimumEmpty} blank cells to be preserved; found ${emptyAfter}.`),
  ];

  return {
    passed: checks.every((item) => item.passed || !item.blocking),
    inputRows: input.rows.length,
    outputRows: outputRows.length,
    duplicatesBefore: countDuplicateRows(input.rows),
    duplicatesAfter,
    whitespaceBefore: countEdgeWhitespaceCells(input.rows),
    whitespaceAfter,
    unresolvedCells: emptyAfter,
    checks,
  };
}

/**
 * Lower bound on blank cells a non-inventing script must keep: blanks in the
 * input after collapsing rows that are identical up to spacing and case.
 */
function minimumPreservedEmptyCells(rows: string[][]): number {
  const unique = new Map<string, string[]>();
  for (const row of rows) unique.set(JSON.stringify(row.map((cell) => cell.trim().toLocaleLowerCase())), row);
  return countEmptyCells([...unique.values()]);
}

const MAX_NOTES = 20;
const MAX_NOTE_CHARS = 300;

/** Parses the script-authored report defensively; it is untrusted model output. */
export function parseScriptReport(text: string | null): ScriptReport | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const count = (key: string) => (typeof value[key] === "number" ? (value[key] as number) : undefined);
  return {
    input_rows: count("input_rows"),
    output_rows: count("output_rows"),
    duplicate_rows_removed: count("duplicate_rows_removed"),
    changed_cells: count("changed_cells"),
    flagged_rows: count("flagged_rows"),
    validation_passed: typeof value.validation_passed === "boolean" ? value.validation_passed : undefined,
    notes: Array.isArray(value.notes)
      ? value.notes.filter((note): note is string => typeof note === "string").slice(0, MAX_NOTES).map((note) => note.slice(0, MAX_NOTE_CHARS))
      : [],
  };
}
