import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { CsvParseError, parseCsv, parseCsvTable, profileTable } from "../../lib/csv.ts";

test("parses quoted fields, escaped quotes, embedded newlines, and CRLF", () => {
  const rows = parseCsv('id,note\r\n1,"Hello, ""world"""\r\n2,"line one\nline two"\r\n');
  assert.deepEqual(rows, [["id", "note"], ["1", 'Hello, "world"'], ["2", "line one\nline two"]]);
});

test("ignores a UTF-8 BOM and blank lines", () => {
  assert.deepEqual(parseCsv("﻿a,b\n\n1,2\n\n"), [["a", "b"], ["1", "2"]]);
});

test("rejects an unterminated quoted field", () => {
  assert.throws(() => parseCsv('a,b\n1,"unterminated\n'), CsvParseError);
});

test("pads short rows to the header width and counts ragged rows", () => {
  const table = parseCsvTable("a,b,c\n1,2\n1,2,3,4\n");
  assert.deepEqual(table.rows, [["1", "2", ""], ["1", "2", "3"]]);
  assert.equal(table.raggedRows, 2);
});

test("profiles duplicates, blanks, edge spaces, and case variants", () => {
  const profile = profileTable(parseCsvTable([
    "order_id,product,status",
    "1, Starter ,PAID",
    "2,starter,",
    "2,starter,",
    "3,Pro,paid",
  ].join("\n")));
  assert.equal(profile.rowCount, 4);
  assert.equal(profile.duplicateRows, 1);
  assert.equal(profile.missingCells, 2);
  assert.equal(profile.edgeWhitespaceCells, 1);
  assert.deepEqual(profile.inconsistentColumns, ["product", "status"]);
});

for (const size of [1_000, 10_000, 50_000]) {
  test(`profiles the ${size.toLocaleString()}-row load fixture quickly and within the upload limit`, async () => {
    const file = new URL(`../../public/samples/sales_load_test_${size}.csv`, import.meta.url);
    const [csv, details] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const started = performance.now();
    const profile = profileTable(parseCsvTable(csv));
    const elapsedMs = performance.now() - started;

    assert.equal(profile.rowCount, size);
    assert.equal(profile.columnCount, 8);
    assert.equal(profile.duplicateRows, Math.floor((size - 1) / 50));
    assert.ok(profile.missingCells > 0);
    assert.ok(profile.edgeWhitespaceCells > 0);
    assert.ok(details.size < 10 * 1024 * 1024);
    assert.ok(elapsedMs < 5_000, `profiling took ${elapsedMs.toFixed(0)} ms`);
  });
}
