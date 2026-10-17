import assert from "node:assert/strict";
import test from "node:test";
import { parseCsvTable } from "../../lib/csv.ts";
import { parseScriptReport, verifyOutput } from "../../lib/server/verify.ts";

const INPUT = parseCsvTable([
  "order_id,customer,status",
  "1001, Ada ,paid",
  "1002,Grace,PAID",
  "1002,Grace,PAID",
  "1003,Linus,",
].join("\n"));

const CLEAN = ["order_id,customer,status", "1001,Ada,paid", "1002,Grace,PAID", "1003,Linus,"].join("\n");

const failing = (csv: string) =>
  verifyOutput(INPUT, csv).checks.filter((check) => !check.passed).map((check) => check.id);

test("passes a correct cleanup and reports before/after metrics", () => {
  const result = verifyOutput(INPUT, CLEAN);
  assert.equal(result.passed, true);
  assert.deepEqual(failing(CLEAN), []);
  assert.equal(result.inputRows, 4);
  assert.equal(result.outputRows, 3);
  assert.equal(result.duplicatesBefore, 1);
  assert.equal(result.duplicatesAfter, 0);
  assert.equal(result.whitespaceBefore, 1);
  assert.equal(result.whitespaceAfter, 0);
  assert.equal(result.unresolvedCells, 1);
});

test("blocks a changed header", () => {
  const csv = CLEAN.replace("customer", "client");
  assert.equal(verifyOutput(INPUT, csv).passed, false);
  assert.deepEqual(failing(csv), ["header"]);
});

test("blocks added rows", () => {
  const csv = `${CLEAN}\n1004,New,paid\n1005,New,paid`;
  assert.equal(verifyOutput(INPUT, csv).passed, false);
  assert.ok(failing(csv).includes("no-growth"));
});

test("blocks rows with the wrong number of values", () => {
  const csv = CLEAN.replace("1003,Linus,", "1003,Linus");
  assert.equal(verifyOutput(INPUT, csv).passed, false);
  assert.ok(failing(csv).includes("width"));
});

test("blocks remaining edge spaces", () => {
  const csv = CLEAN.replace("1001,Ada,", "1001, Ada ,");
  assert.equal(verifyOutput(INPUT, csv).passed, false);
  assert.deepEqual(failing(csv), ["edge-spaces"]);
});

test("blocks unparseable and empty output", () => {
  assert.equal(verifyOutput(INPUT, 'order_id,customer,status\n1,"broken').passed, false);
  assert.ok(failing("order_id,customer,status\n").includes("has-rows"));
});

test("flags, but does not block, remaining duplicates and filled-in blanks", () => {
  const withDuplicate = `${CLEAN}\n1002,Grace,PAID`;
  const result = verifyOutput(INPUT, withDuplicate);
  assert.equal(result.passed, true);
  assert.deepEqual(failing(withDuplicate), ["duplicates"]);

  const invented = CLEAN.replace("1003,Linus,", "1003,Linus,PAID");
  assert.equal(verifyOutput(INPUT, invented).passed, true);
  assert.deepEqual(failing(invented), ["no-invented-values"]);
});

test("parses the script report defensively", () => {
  assert.equal(parseScriptReport(null), null);
  assert.equal(parseScriptReport("not json"), null);
  assert.equal(parseScriptReport("[1,2]"), null);
  const report = parseScriptReport(JSON.stringify({ input_rows: 4, output_rows: "3", notes: ["ok", 7, "x".repeat(500)] }));
  assert.equal(report?.input_rows, 4);
  assert.equal(report?.output_rows, undefined);
  assert.deepEqual(report?.notes.map((note) => note.length), [2, 300]);
});
