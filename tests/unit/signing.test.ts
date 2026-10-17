import assert from "node:assert/strict";
import test from "node:test";
import { SCRIPT_TOKEN_TTL_MS, signScript, verifyScriptToken } from "../../lib/server/signing.ts";

const SECRET = "test-secret-with-enough-entropy";
const CODE = "print('hello')\n";

test("accepts a token for the exact script it was issued for", async () => {
  const token = await signScript(CODE, SECRET);
  assert.equal(await verifyScriptToken(CODE, token, SECRET), true);
});

test("rejects a modified script", async () => {
  const token = await signScript(CODE, SECRET);
  assert.equal(await verifyScriptToken(`${CODE}import os\n`, token, SECRET), false);
});

test("rejects a token signed with a different secret", async () => {
  const token = await signScript(CODE, "another-secret");
  assert.equal(await verifyScriptToken(CODE, token, SECRET), false);
});

test("rejects an expired token", async () => {
  const issuedAt = Date.now() - SCRIPT_TOKEN_TTL_MS - 1_000;
  const token = await signScript(CODE, SECRET, issuedAt);
  assert.equal(await verifyScriptToken(CODE, token, SECRET), false);
});

test("rejects a token whose expiry was extended", async () => {
  const token = await signScript(CODE, SECRET);
  const [expiry, signature] = token.split(".");
  assert.equal(await verifyScriptToken(CODE, `${Number(expiry) + 60_000}.${signature}`, SECRET), false);
});

test("rejects malformed tokens", async () => {
  for (const token of ["", "abc", "123.", "123.!!!", "123.abc.def", `${Date.now() + 10_000}.AAAA`]) {
    assert.equal(await verifyScriptToken(CODE, token, SECRET), false, token);
  }
});
