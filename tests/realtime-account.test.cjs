// Live home screens: the account channel, server-known open games on the group card, and the
// owed-to-me dot.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "kupa-sgura.html"), "utf8");
const fnSource = name => {
  const start = html.indexOf("  function " + name + "(");
  return html.slice(start, html.indexOf("\n  }\n", start) + 4);
};

test("the account channel only names published tables, and every event becomes a debounced pull", () => {
  const list = html.match(/const CLOUD_ACCOUNT_TABLES = \[([^\]]*)\];/);
  assert.ok(list);
  assert.deepEqual(JSON.parse("[" + list[1] + "]"), ["games", "groups", "group_members", "friendships", "debts"]);
  assert.match(fnSource("syncCloudAccountChannel"), /\(\) => scheduleCloudPull\(600\)/);
  assert.match(html, /function enterCloudMode\(\) \{[\s\S]*?syncCloudAccountChannel\(\);/);
  assert.match(html, /function exitCloudMode\(\) \{[\s\S]*?leaveCloudAccountChannel\(\);/);
  assert.match(fnSource("cloudRetryNow"), /syncCloudAccountChannel\(\);/);
});

test("an open group game on the server lights the group card even when this member is not seated", () => {
  const ctx = vm.createContext({});
  vm.runInContext(fnSource("cloudGroupOpenGames"), ctx);
  const open = ctx.cloudGroupOpenGames([
    { id: "a", group_id: "g1", phase: "active" },
    { id: "b", group_id: null, phase: "active" },
    { id: "c", group_id: "g2", phase: "closed" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(open)), [{ groupId: "g1", gameId: "a", phase: "active" }]);
  const summary = fnSource("getGroupSummary");
  assert.match(summary, /const hasActiveGame = localActive \|\| !!serverOpen;/);
});

test("money owed to me keeps a dot on its tab until it is paid", () => {
  assert.match(html, /if \(key === "owedToMe" && list\.length\) \{/);
});
