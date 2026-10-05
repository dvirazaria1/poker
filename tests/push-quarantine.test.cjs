// Push quarantine (docs/superpowers/plans/2026-10-05-push-quarantine.md): one row the server
// refuses for what it contains is set aside, so it no longer blocks every later write.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync("kupa-sgura.html", "utf8");
const fn = name => {
  const s = Math.max(html.indexOf("  function " + name + "("), html.indexOf("  async function " + name + "("));
  return html.slice(s, html.indexOf("\n  }\n", s) + 4);
};
const ctx = vm.createContext({});
vm.runInContext(html.slice(html.indexOf("  const CLOUD_PARENT_COLUMNS"), html.indexOf("\n", html.indexOf("  const CLOUD_PARENT_COLUMNS")))
  + "\n" + ["cloudRowHash", "isRowSpecificRefusal", "cloudHeldByQuarantine"].map(fn).join("\n"), ctx);

test("a row's hash ignores updated_at, so the same refused row is recognised next run", () => {
  assert.equal(ctx.cloudRowHash({ id: "a", x: 1, updated_at: "1" }), ctx.cloudRowHash({ id: "a", x: 1, updated_at: "2" }));
  assert.notEqual(ctx.cloudRowHash({ id: "a", x: 1 }), ctx.cloudRowHash({ id: "a", x: 2 }));
});

test("only RLS / constraint / bad-value refusals of an identified row quarantine", () => {
  assert.equal(ctx.isRowSpecificRefusal({ code: "42501", cloudRow: { id: "a" } }), true);
  assert.equal(ctx.isRowSpecificRefusal({ code: "23505", cloudRow: { id: "a" } }), true);
  assert.equal(ctx.isRowSpecificRefusal({ code: "42501" }), false);
  assert.equal(ctx.isRowSpecificRefusal({ code: "PGRST301", cloudRow: { id: "a" } }), false);
  assert.equal(ctx.isRowSpecificRefusal({ status: 401, cloudRow: { id: "a" } }), false);
});

test("a child of a quarantined parent is held, not refused", () => {
  const q = new Set(["g1", "p1"]);
  assert.equal(ctx.cloudHeldByQuarantine({ id: "e", game_id: "g1" }, q), true);
  assert.equal(ctx.cloudHeldByQuarantine({ id: "m", group_id: "g1" }, q), true);
  assert.equal(ctx.cloudHeldByQuarantine({ id: "t", from_participant_id: "p1" }, q), true);
  assert.equal(ctx.cloudHeldByQuarantine({ id: "x", game_id: "g2" }, q), false);
});

test("pushCloudRun skips quarantined and held rows, and a row refusal re-runs the push instead of stopping", () => {
  const run = fn("pushCloudRun");
  assert.match(run, /const quarantined = cloudQuarantinedIds\(\);/);
  assert.match(run, /!cloudQuarantineSkips\(row, quarantined\)/);
  assert.match(run, /if \(isRowSpecificRefusal\(e\) && cloudQuarantineRuns < 8\)/);
});

test("the quarantine is released on boot and on a dot tap, and never counts as waiting", () => {
  assert.match(fn("enterCloudMode"), /releaseCloudQuarantine\(\);/);
  assert.match(fn("cloudRetryNow"), /releaseCloudQuarantine\(\);/);
  assert.match(fn("cloudOutboxSignal"), /cloudQuarantinedIds\(\)/);
});

test("a debt that failed to upload after its game closed is retried, not dropped as frozen (review P8)", () => {
  assert.match(fn("pushCloudRun"), /: pair\[0\] === "debts" \? \(next\[pair\[0\]\] \|\| \[\]\)\.filter\(row => !foreignClosed\.has\(String\(row\.game_id\)\)\)/);
});
