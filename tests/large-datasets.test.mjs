import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length)) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.length)) rows.push(row);
  return rows;
}

for (const size of [1_000, 10_000, 50_000]) {
  test(`profiles the ${size.toLocaleString()}-row load fixture within the upload limit`, async () => {
    const file = new URL(`../public/samples/sales_load_test_${size}.csv`, import.meta.url);
    const [csv, details] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const started = performance.now();
    const parsed = parseCsv(csv);
    const headers = parsed[0];
    const rows = parsed.slice(1).map((row) => headers.map((_, index) => row[index] ?? ""));
    const keys = rows.map((row) => JSON.stringify(row));
    const duplicateRows = keys.length - new Set(keys).size;
    const missingCells = rows.reduce((count, row) => count + row.filter((cell) => !cell.trim()).length, 0);
    const whitespaceCells = rows.reduce((count, row) => count + row.filter((cell) => cell !== cell.trim()).length, 0);
    const elapsedMs = performance.now() - started;

    assert.equal(rows.length, size);
    assert.equal(headers.length, 8);
    assert.equal(duplicateRows, Math.floor((size - 1) / 50));
    assert.ok(missingCells > 0);
    assert.ok(whitespaceCells > 0);
    assert.ok(details.size < 10 * 1024 * 1024);
    assert.ok(elapsedMs < 5_000, `profiling took ${elapsedMs.toFixed(0)} ms`);
  });
}
