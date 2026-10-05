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
  "mergeOpenGameSlots", "replaceGameSlot"].map(fn).join("\n"), ctx);
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

test("a realtime snapshot replaces its own slot and nothing else", () => {
  const out = ctx.replaceGameSlot([slot("a", "g1", 1), slot("b", null, 1)], slot("a", "g1", 5));
  assert.equal(out.length, 2);
  assert.equal(out[0].players.length, 5);
  assert.equal(out[1].gameId, "b");
  assert.equal(ctx.replaceGameSlot([slot("b", null)], slot("c", null)).length, 2);
});
