/**
 * RFC 4180-style CSV parsing and profiling shared by the browser (inspection)
 * and the server (independent verification). Keeping a single implementation
 * guarantees both sides count duplicates, blanks, and edge spaces identically.
 */

export type CsvTable = {
  headers: string[];
  /** Data rows, each padded or truncated to the header width. */
  rows: string[][];
  /** Number of data rows whose raw width differed from the header. */
  raggedRows: number;
};

export type CsvProfile = {
  rowCount: number;
  columnCount: number;
  duplicateRows: number;
  missingCells: number;
  edgeWhitespaceCells: number;
  inconsistentColumns: string[];
};

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

/** Parses CSV text into raw rows. Blank lines are skipped; a UTF-8 BOM is ignored. */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endRow = () => {
    row.push(cell);
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
    cell = "";
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      endRow();
    } else {
      cell += char;
    }
  }

  if (quoted) throw new CsvParseError("The CSV has an unterminated quoted field.");
  endRow();
  return rows;
}

export function toTable(rawRows: string[][]): CsvTable {
  const headers = rawRows[0] ?? [];
  let raggedRows = 0;
  const rows = rawRows.slice(1).map((row) => {
    if (row.length !== headers.length) raggedRows += 1;
    return headers.map((_, index) => row[index] ?? "");
  });
  return { headers, rows, raggedRows };
}

export function parseCsvTable(text: string): CsvTable {
  return toTable(parseCsv(text));
}

export function countDuplicateRows(rows: string[][]): number {
  const keys = new Set<string>();
  for (const row of rows) keys.add(JSON.stringify(row));
  return rows.length - keys.size;
}

export function countEmptyCells(rows: string[][]): number {
  let count = 0;
  for (const row of rows) for (const cell of row) if (!cell.trim()) count += 1;
  return count;
}

export function countEdgeWhitespaceCells(rows: string[][]): number {
  let count = 0;
  for (const row of rows) for (const cell of row) if (cell.trim() && cell !== cell.trim()) count += 1;
  return count;
}

/** Columns where the same text value appears with different capitalization. */
export function findInconsistentColumns(table: CsvTable): string[] {
  return table.headers.filter((_, columnIndex) => {
    const variantsByKey = new Map<string, string>();
    for (const row of table.rows) {
      const value = row[columnIndex]?.trim();
      if (!value || !/[a-z]/i.test(value)) continue;
      const key = value.toLocaleLowerCase();
      const seen = variantsByKey.get(key);
      if (seen === undefined) variantsByKey.set(key, value);
      else if (seen !== value) return true;
    }
    return false;
  });
}

export function profileTable(table: CsvTable): CsvProfile {
  return {
    rowCount: table.rows.length,
    columnCount: table.headers.length,
    duplicateRows: countDuplicateRows(table.rows),
    missingCells: countEmptyCells(table.rows),
    edgeWhitespaceCells: countEdgeWhitespaceCells(table.rows),
    inconsistentColumns: findInconsistentColumns(table),
  };
}
