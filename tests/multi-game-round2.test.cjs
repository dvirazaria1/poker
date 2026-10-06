// Multi-game Round 2 (docs/superpowers/plans/2026-10-05-multi-game-round2.md): several open
// tables on one device. state.gameId stays the current-table pointer; state.games is the store.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync("kupa-sgura.html", "utf8");
const fn = n => {
  const s = Math.max(html.indexOf("  function " + n + "("), html.indexOf("  async function " + n + "("));
  assert.ok(s > 0, "missing " + n);
  return html.slice(s, html.indexOf("\n  }\n", s) + 4);
};
let seq = 0;
const ctx = vm.createContext({ crypto: { randomUUID: () => "new-" + (++seq) } });
vm.runInContext(["hasOpenPhase", "isGameOpen", "isEmptyOpenGame", "currentGameSlot", "syncCurrentGameMirror", "newId",
  "openGameSlots", "groupGameSlot", "openNewGameSlot", "selectGameSlot", "canStartGroupGame", "initialAppView",
  "mergeIncomingSlot", "mergeOpenGameSlots", "replaceGameSlot"].map(fn).join("\n"), ctx);
const slot = (id, groupId, n = 1, phase = "active") => ({ gameId: id, phase, groupId,
  players: Array.from({ length: n }, (_, i) => ({ id: id + i })), startedAt: null, leaderRef: null, settlementStatuses: {} });

test("starting a table keeps every other open table and drops only an empty current one", () => {
  const s = { gameId: "a", games: [slot("a", "g1"), slot("b", null)] };
  const next = ctx.openNewGameSlot(s, { phase: "active", groupId: "g2" });
  assert.deepEqual(next.games.map(g => g.gameId).slice(0, 2), ["a", "b"]);
  assert.equal(next.games.length, 3);
  assert.equal(next.groupId, "g2");
  const empty = { gameId: "e", games: [slot("e", null, 0), slot("b", null)] };
  assert.equal(ctx.openNewGameSlot(empty, { phase: "active" }).games.some(g => g.gameId === "e"), false);
});

test("selecting a table moves the pointer and the mirror; an unknown id changes nothing", () => {
  const s = ctx.syncCurrentGameMirror({ gameId: "a", games: [slot("a", "g1", 2), slot("b", null, 3)] });
  const b = ctx.selectGameSlot(s, "b");
  assert.equal(b.gameId, "b");
  assert.equal(b.players.length, 3);
  assert.equal(ctx.selectGameSlot(s, "zzz").gameId, "a");
});

test("a group is blocked only by its own open table, local or on the server", () => {
  const c = { groups: [{ id: "g1" }, { id: "g2" }], games: [slot("a", "g1")] };
  assert.equal(ctx.canStartGroupGame(c, "g1", []).reason, "group-has-open-game");
  assert.equal(ctx.canStartGroupGame(c, "g2", []).ok, true);
  assert.equal(ctx.canStartGroupGame(c, "g2", [{ groupId: "g2", gameId: "x" }]).reason, "group-has-open-game");
});

test("boot resumes into the one open table, or the dashboard when there are several", () => {
  assert.equal(ctx.initialAppView(ctx.syncCurrentGameMirror({ gameId: "a", games: [slot("a", null)] })), "game");
  assert.equal(ctx.initialAppView(ctx.syncCurrentGameMirror({ gameId: "a", games: [slot("a", null), slot("b", "g")] })), "games");
  assert.equal(ctx.initialAppView(ctx.syncCurrentGameMirror({ gameId: "x", games: [slot("b", "g")] })), "games");
  assert.equal(ctx.initialAppView(ctx.syncCurrentGameMirror({ gameId: "x", games: [] })), "profile");
});

test("the pull keeps every server table, keeps unsynced local ones, drops tables closed or deleted on the server", () => {
  const local = [slot("a", "g1"), slot("b", null), slot("c", "g3"), slot("d", null)];
  const server = [slot("a", "g1", 4), slot("e", "g5")];
  const merged = ctx.mergeOpenGameSlots(local, server, {
    closedOnServer: new Set(["c"]), confirmedOnServer: new Set(["d"]), closedHere: new Set(),
  });
  assert.deepEqual(merged.map(g => g.gameId).sort(), ["a", "b", "e"]);
  assert.equal(merged.find(g => g.gameId === "a").players.length, 4);
});

test("a realtime snapshot replaces its own slot and nothing else, and never re-adds a table gone here", () => {
  const out = ctx.replaceGameSlot([slot("a", "g1", 1), slot("b", null, 1)], slot("a", "g1", 5));
  assert.equal(out.length, 2);
  assert.equal(out[0].players.length, 5);
  assert.equal(out[1].gameId, "b");
  assert.equal(ctx.replaceGameSlot([slot("b", null)], slot("c", null)).length, 1, "closed/reset here: not re-added (M6)");
});

test("an open table's paid marks survive a server snapshot that carries none, per table (M2)", () => {
  const a = { ...slot("a", "g1", 2, "settlement"), settlementStatuses: { "x>y:50": true } };
  const b = { ...slot("b", null, 2, "settlement"), settlementStatuses: { "p>q:20": true } };
  const fromServer = id => ({ ...slot(id, null, 3, "settlement"), settlementStatuses: null });
  const viaRealtime = ctx.replaceGameSlot([a, b], fromServer("a"));
  assert.deepEqual(viaRealtime[0].settlementStatuses, { "x>y:50": true });
  assert.deepEqual(viaRealtime[1].settlementStatuses, { "p>q:20": true });
  const viaPull = ctx.mergeOpenGameSlots([a, b], [fromServer("a"), fromServer("b")], {});
  assert.deepEqual(viaPull.find(g => g.gameId === "b").settlementStatuses, { "p>q:20": true });
  const explicit = ctx.replaceGameSlot([a], { ...fromServer("a"), settlementStatuses: {} });
  assert.deepEqual(explicit[0].settlementStatuses, {}, "an explicit server map still wins");
});

test("a table reset here this session is not brought back by the pull (M8)", () => {
  const merged = ctx.mergeOpenGameSlots([], [slot("a", "g1"), slot("b", null)], { discarded: new Set(["a"]) });
  assert.deepEqual(merged.map(g => g.gameId), ["b"]);
});

test("the dashboard lists every open table, current first; a group reports its own table beside another", () => {
  const c2 = vm.createContext({ crypto: { randomUUID: () => "x" } });
  vm.runInContext(["hasOpenPhase", "isGameOpen", "openGameSlots", "getActiveGameSummaries", "activeGameSummary"].map(fn).join("\n"), c2);
  const st = { gameId: "b", games: [slot("a", "g1", 2), slot("b", null, 1), slot("e", "g9", 0)] };
  const out = JSON.parse(vm.runInContext("JSON.stringify(getActiveGameSummaries(" + JSON.stringify(st) + ", [{ id: 'g1', name: 'G1' }]))", c2));
  assert.deepEqual(out.map(s => s.gameId), ["b", "a"]);
  assert.equal(out[1].title, "G1");
  const summary = fn("getGroupSummary");
  assert.match(summary, /\(Array\.isArray\(c\.games\) \? c\.games : \[c\.currentGame\]\)/);
});

test("entering a table clears the per-table UI before moving the pointer", () => {
  const enter = fn("enterActiveGame");
  assert.ok(enter.indexOf("resetTableUi()") < enter.indexOf("selectGameSlot(state, id)"));
  assert.match(fn("resetTableUi"), /clearCloseHold\(\);\s+clearFinishGameHold\(\);/);
  assert.match(fn("render"), /if \(\(appView === "game" \|\| appView === "settle"\) && !currentGameSlot\(state\)\) appView = "games";/);
});

test("one realtime channel per open table: current first, cloud ids only, at most four", () => {
  const c3 = vm.createContext({ isCloudId: id => /^[0-9a-f-]{36}$/.test(id) });
  vm.runInContext(["hasOpenPhase", "isGameOpen", "openGameSlots", "cloudChannelGameIds"].map(fn).join("\n") + "\nvar CLOUD_GAME_CHANNEL_CAP = 4;", c3);
  const u = n => "0000000" + n + "-0000-4000-8000-000000000000";
  const st = { gameId: u(5), games: [1, 2, 3, 4, 5, 6].map(n => slot(u(n), null)).concat([slot("legacy-x", null)]) };
  const ids = JSON.parse(vm.runInContext("JSON.stringify(cloudChannelGameIds(" + JSON.stringify(st) + "))", c3));
  assert.deepEqual(ids, [u(5), u(1), u(2), u(3)]);
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(cloudChannelGameIds({ example: true, games: [] }))", c3)), []);
});

test("the corner button: the opener deletes the table for everyone, anyone else leaves it for good (2026-10-06)", () => {
  const handler = html.slice(html.indexOf('function resetCornerLabel()'), html.indexOf('// ---------- group settings overlay: UI-only state'));
  assert.match(handler, /isGameOpener\(state\.gameId\) \? "מחק שולחן" : "עזוב שולחן"/);
  assert.match(handler, /if \(isGameOpener\(gameId\)\) \{\s*discardCloudGame\(gameId\);/);
  assert.match(handler, /state\.leftGameIds = \[\.\.\.\(state\.leftGameIds \|\| \[\]\)\.filter\(id => id !== gameId\), gameId\]\.slice\(-50\);/);
  // a left table never comes back through a pull, and is forgotten once it closes
  assert.match(html, /discarded: new Set\(\[\.\.\.cloudDiscardedGameIds, \.\.\.\(state\.leftGameIds \|\| \[\]\)\]\)/);
  assert.match(html, /state\.leftGameIds = state\.leftGameIds\.filter\(id => stillOpen\.has\(String\(id\)\)\);/);
  assert.match(html, /leftGameIds: Array\.isArray\(s\.leftGameIds\) \? s\.leftGameIds\.map\(String\)\.slice\(-50\) : \[\],/);
  // offline, or never on the server: the table is this device's own
  assert.match(fn("isGameOpener"), /if \(!cloudMode\(\) \|\| !cloudKnownGameIds\(\)\.has\(id\)\) return true;/);
});

test("delete shows a bin; the first tap turns it red with the cost spelled out, the second deletes", () => {
  assert.match(html, /<span class="corner-note" id="resetNote" hidden>הנתונים מהשולחן לא ירשמו<\/span>/);
  assert.match(html, /delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16">/);
  const handler = html.slice(html.indexOf('document.getElementById("resetBtn").addEventListener("click"'), html.indexOf('// ---------- group settings overlay: UI-only state'));
  assert.match(handler, /btn\.classList\.add\("danger-armed"\);\s*if \(isGameOpener\(state\.gameId\)\) document\.getElementById\("resetNote"\)\.hidden = false;/);
  assert.match(handler, /resetArmed = setTimeout\(disarmResetCorner, 5000\);/);
});
