const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "kupa-sgura.html"), "utf8");
const body = name => {
  const start = Math.max(html.indexOf("  function " + name + "("), html.indexOf("  async function " + name + "("));
  return html.slice(start, html.indexOf("\n  }\n", start));
};

test("legacy setSync never reads an undeclared detail (it threw on sign-out and on read failures)", () => {
  assert.doesNotMatch(body("setSync"), /\bdetail\b/);
});

test("setCloudSync carries the refused table/code onto the dot, where a tap can show it", () => {
  assert.match(body("setCloudSync"), /d\.dataset\.detail = detail/);
  assert.match(html, /addEventListener\("click", \(\) => \{ showSyncDetail\(\); cloudRetryNow\(\); \}\)/);
});

test("debt payments and child deletes name their own table", () => {
  assert.doesNotMatch(html, /\.eq\("id", payment\.id\);\s+if \(!pushIsCurrent\(\)\) return;\s+if \(result && result\.error\) throw tagCloudError\(result\.error, pair\[1\]\)/);
  assert.match(body("pushCloudGameDeletes"), /tagCloudError\(result\.error, table\)/);
});

test("a grey waiting dot explains itself, and a code error is surfaced instead of retried forever", () => {
  assert.match(body("refreshSyncDot"), /kind === "waiting" \? cloudWaitingDetail\(\)/);
  const ctx = require("node:vm").createContext({ CLOUD_SURFACE_CODES: {} });
  require("node:vm").runInContext(body("classifyCloudError") + "\n  }", ctx);
  assert.equal(ctx.classifyCloudError({ name: "TypeError", message: "Load failed" }), "retry");
  assert.equal(ctx.classifyCloudError({ name: "TypeError", message: "Cannot read properties of undefined (reading 'id')" }), "surface");
  assert.equal(ctx.classifyCloudError({ message: "something else" }), "retry");
});

test("a pull settles pending ids the server already holds identically, and keeps the rest", () => {
  const vm = require("node:vm");
  const src = html.slice(html.indexOf("  const CLOUD_MERGED_KEYS"), html.indexOf("\n", html.indexOf("  const CLOUD_MERGED_KEYS")))
    + "\n" + body("diffCollections") + "\n  }\n" + body("cloudStillPendingIds") + "\n  }\n";
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx);
  const server = { friendships: [{ id: "f1", status: "accepted" }, { id: "f2", status: "pending" }] };
  const local = { friendships: [{ id: "f1", status: "accepted" }, { id: "f2", status: "accepted" }, { id: "f3", status: "pending" }] };
  assert.deepEqual(Array.from(ctx.cloudStillPendingIds(["f1", "f2", "f3"], server, local)), ["f2", "f3"]);
  // f4 is held locally but is not a row this device writes (absent from the built rows): dropped.
  assert.deepEqual(Array.from(ctx.cloudStillPendingIds(["f2", "f4"], server, local)), ["f2"]);
});

test("only rows this device would write are ever marked pending", () => {
  assert.match(body("markCloudPending"), /const rows = buildCloudRows\(cloudCollections\(\), cloudContext\(\)\);/);
  assert.match(body("markCloudPending"), /filter\(id => writable\.has\(id\)\)/);
});
