import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the DataFix product surface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>DataFix AI — Autonomous data repair<\/title>/i);
  assert.match(html, /Messy data in\./);
  assert.match(html, /Trusted data out\./);
  assert.match(html, /Step 01 · Inspect/);
  assert.match(html, /Choose dataset/);
  assert.match(html, /Try a synthetic dataset/);
  assert.match(html, /Sales/);
  assert.match(html, /Customers/);
  assert.match(html, /Transactions/);
  assert.match(html, /Download samples/);
  assert.match(html, /A clear path from upload to verified output/);
  assert.match(html, /DATAFIX \/ LIVE TOUR/);
  assert.match(html, /Powered by CreateOS Sandbox \+ Stripe Projects/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});
