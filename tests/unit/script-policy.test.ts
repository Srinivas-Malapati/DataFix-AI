import assert from "node:assert/strict";
import test from "node:test";
import { checkScript } from "../../lib/server/script-policy.ts";

const COMPLIANT = `
import csv, json
import re
from datetime import datetime
from collections import Counter as C

DATE = re.compile(r"^\\d{2}/\\d{2}/\\d{4}$")
with open("/workspace/input.csv", newline="", encoding="utf-8-sig") as handle:
    rows = list(csv.reader(handle))
parts = "10/02/2026".split("/")
stamp = datetime.strptime("10/02/2026", "%m/%d/%Y")
with open("/workspace/output.csv", "w", newline="") as handle:
    csv.writer(handle).writerows(rows)
json.dump({"notes": []}, open("/workspace/report.json", "w"))
`;

test("allows a typical compliant cleanup script", () => {
  assert.deepEqual(checkScript(COMPLIANT), { allowed: true, violations: [] });
});

const violations: Array<[string, string]> = [
  ["import os", "`os`"],
  ["import csv, os", "`os`"],
  ["import os.path as p", "`os`"],
  ["from pathlib import Path", "`pathlib`"],
  ["from . import helpers", "`.`"],
  ["import subprocess", "`subprocess`"],
  ["import sys", "`sys`"],
  ["__import__('os')", "__import__"],
  ["eval('1+1')", "eval"],
  ["exec(code)", "exec"],
  ["compile(src, 'x', 'exec')", "compile"],
  ["().__class__.__bases__[0].__subclasses__()", "__class__"],
  ["open('/etc/passwd')", "/etc/passwd"],
  ["open(\"/tmp/out.csv\", \"w\")", "/tmp/out.csv"],
];

for (const [code, expected] of violations) {
  test(`rejects: ${code}`, () => {
    const result = checkScript(code);
    assert.equal(result.allowed, false);
    assert.ok(result.violations.some((violation) => violation.includes(expected)), result.violations.join(" | "));
  });
}

test("rejects empty and oversized scripts", () => {
  assert.equal(checkScript("   ").allowed, false);
  assert.equal(checkScript("x = 1\n".repeat(20_000)).allowed, false);
});
