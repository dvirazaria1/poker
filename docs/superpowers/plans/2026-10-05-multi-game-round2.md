# Multi-Game Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Several tables can be open at once on one device (two groups playing the same night, or a group game plus an ad-hoc one); the dashboard lists every open table, each can be entered, played, settled and closed independently, and cloud sync + realtime keep every one of them current.

**Architecture:** `state.games` (Round 1) is already the authoritative store. Round 2 keeps `state.gameId` as the persisted *current-table pointer* and `syncCurrentGameMirror` as the view the 80+ existing readers use — switching tables is "move the pointer, re-mirror". What changes: starting a table no longer replaces the open one; every list-shaped reader iterates `state.games`; the cloud pull merges all server-open tables into `state.games` (instead of picking one) and writes realtime updates into the right slot; realtime keeps one channel per open table (capped).

**Tech Stack:** vanilla JS in `kupa-sgura.html`; Supabase JS v2 (postgres_changes); Node test runner.

## Global Constraints

- Only runtime source `kupa-sgura.html`; release via `build.py`; never hand-edit `index.html` / the `sw.js` cache line.
- One source of truth: `state`. No new localStorage keys. UI-only state (`currentGroupId`, menus) never persisted.
- `syncCurrentGameMirror` remains the ONLY writer of `state.players/phase/groupId/startedAt/leaderRef/settlementStatuses` (tests/multi-game-migration.test.cjs staleness guard).
- Behavior that must not regress (CLAUDE.md): buy-in/entryLog sync, integer settlement, normal close only at zero, unbalanced close hold, reversible payment toggles, debts only for unpaid transfers, `סיים משחק` 1s hold changes only phase.
- Server rule unchanged: one open game per group (`games_one_open_per_group_uk`); ad-hoc games unlimited.
- Keep the insert/update split in `pushCloudRun` untouched.

## Decisions (stated, so they are decisions and not accidents)

- **D1 Pointer, not a new id.** `state.gameId` stays the current table (persisted). Deviation from the 2026-09-10 plan's "delete the mirror": that rewrite touches 80+ readers for no user-visible gain; the pointer keeps every one of them correct by construction.
- **D2 Boot:** exactly one open table → resume into it (today's behavior); two or more → the Games dashboard; none → Profile (today).
- **D3 Realtime:** one channel per open table, current table first, cap 4. Tables past the cap rely on the account channel (`games` events) + foreground pulls.
- **D4 A group whose open game I am not seated at** (server knows it, I have no slot): the group card says "משחק פעיל"; starting another game there is refused with "כבר יש משחק פתוח בקבוצה" (the server would refuse it anyway).

## Failure modes found while planning, and how the plan resolves each

| # | Failure mode | Resolution |
|---|---|---|
| F1 | **Existing bug:** a pulled or realtime update of the CURRENT table is written to the singular fields only (`mergeCloudIntoState` `p.game`), then `normalize → migrateGamesArray` keeps the stale slot with the same id and the mirror restores it — another phone's buy-ins can be silently dropped. | Task 4: pulls and realtime write the slot inside `state.games` (`replaceGameSlot`); the singular path is removed. Regression test with a stale slot + newer server snapshot. |
| F2 | Switching tables while a per-table UI state is live (buy-in menu, custom amount, exit confirm, close-arm/finish hold) acts on the wrong table. | Task 2 `enterActiveGame` resets every per-table UI flag and timer before moving the pointer (same set `setAppView` resets when leaving the table). |
| F3 | Two devices start a game in the same group at once → second push fails `23505`. | D4 pre-check against `cloudGroupAggregates.openGames`; the remaining race lands in the push quarantine (plan 2026-10-05-push-quarantine) with a named row; the local table stays usable. |
| F4 | Another phone closes the table I am looking at → my slot is stale forever (today `pickCloudOpenGame` keeps a "different" local game). | Task 4 merge: a slot whose id is closed on the server, or was confirmed on the server and is now gone, is removed; Task 2 render guard sends `game/settle` with no current slot to the dashboard. |
| F5 | Pointer names a removed slot after a pull/close. | `pickNextCurrentGame(state)`: pointer moves to another open slot only when the person is not inside a table; otherwise view guard (F4). |
| F6 | `getActiveGameSummaries(...)[0]` in `renderGroupPrimaryAction` returns the wrong table once there are several. | Task 2: find by the group's own slot id. Grep shows it is the only `[0]` caller. |
| F7 | Starting a table replaced the current slot (`newCurrentGame` filters `base.gameId`) — with two tables that deletes one. | Task 1 `openNewGameSlot`: keeps every slot except an EMPTY current one. `newCurrentGame` keeps its reset semantics for reset/discard callers. |
| F8 | Empty slots from another device or a half-opened table block a group. | Blocking uses `isGameOpen` (≥1 player) for local slots, plus the server's open-game list. |
| F9 | Realtime apply blocked forever by "a different game is current". | `shouldApplyIncomingGame` becomes per slot: refuse only while an input is focused inside THAT table's view. |
| F10 | Too many realtime channels. | D3 cap 4. |
| F11 | The close of a non-current table. | Close only ever happens from the settle view of the current pointer; unchanged. |

---

### Task 1: Pure slot helpers + tests

**Files:** Modify `kupa-sgura.html` (groups domain pure section next to `newCurrentGame`, and cloud mapping next to `pickCloudOpenGame`). Test: `tests/multi-game-round2.test.cjs` (create).

**Interfaces — Produces:**
- `openGameSlots(state) -> OpenGameSlot[]` — slots with `isGameOpen` true.
- `groupGameSlot(state, groupId) -> OpenGameSlot|null`
- `openNewGameSlot(base, patch) -> state` — appends a new slot, drops only an EMPTY current slot, points `gameId` at the new one, mirrors.
- `selectGameSlot(base, gameId) -> state` — moves the pointer if that slot exists, mirrors.
- `canStartGroupGame(collections, groupId, serverOpenGames)` — reasons: `group-archived`, `group-has-open-game`; no `another-game-open`.
- `initialAppView(state)` — D2.
- `mergeOpenGameSlots(localSlots, serverSlots, ctx) -> OpenGameSlot[]` with `ctx = { closedOnServer:Set, confirmedOnServer:Set, closedHere:Set }`.

- [ ] **Step 1: failing tests**

```js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync("kupa-sgura.html", "utf8");
const fn = n => { const s = html.indexOf("  function " + n + "("); return html.slice(s, html.indexOf("\n  }\n", s) + 4); };
const ctx = vm.createContext({ crypto: { randomUUID: (() => { let i = 0; return () => "new-" + (++i); })() } });
vm.runInContext(["hasOpenPhase", "isGameOpen", "isEmptyOpenGame", "currentGameSlot", "syncCurrentGameMirror", "newId",
  "openGameSlots", "groupGameSlot", "openNewGameSlot", "selectGameSlot", "canStartGroupGame", "initialAppView",
  "mergeOpenGameSlots"].map(fn).join("\n"), ctx);
const slot = (id, groupId, n = 1, phase = "active") => ({ gameId: id, phase, groupId, players: Array.from({ length: n }, (_, i) => ({ id: id + i })), startedAt: null, leaderRef: null, settlementStatuses: {} });

test("starting a table keeps every other open table and drops only an empty current one", () => {
  const s = { gameId: "a", games: [slot("a", "g1"), slot("b", null)] };
  const next = ctx.openNewGameSlot(s, { phase: "active", groupId: "g2" });
  assert.deepEqual(next.games.map(g => g.gameId).slice(0, 2), ["a", "b"]);
  assert.equal(next.games.length, 3);
  assert.equal(next.groupId, "g2");
  const empty = { gameId: "e", games: [slot("e", null, 0), slot("b", null)] };
  assert.deepEqual(ctx.openNewGameSlot(empty, { phase: "active" }).games.map(g => g.gameId).includes("e"), false);
});
test("selecting a table moves the pointer and the mirror; an unknown id changes nothing", () => {
  const s = ctx.syncCurrentGameMirror({ gameId: "a", games: [slot("a", "g1", 2), slot("b", null, 3)] });
  const b = ctx.selectGameSlot(s, "b");
  assert.equal(b.gameId, "b"); assert.equal(b.players.length, 3);
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
  assert.equal(ctx.initialAppView(ctx.syncCurrentGameMirror({ gameId: "x", games: [] })), "profile");
});
test("the pull keeps every server table, keeps unsynced local ones, and drops tables closed or deleted on the server", () => {
  const local = [slot("a", "g1"), slot("b", null), slot("c", "g3"), slot("d", null)];
  const server = [{ ...slot("a", "g1", 4) }, slot("e", "g5")];
  const merged = ctx.mergeOpenGameSlots(local, server, {
    closedOnServer: new Set(["c"]), confirmedOnServer: new Set(["d"]), closedHere: new Set(),
  });
  const ids = merged.map(g => g.gameId).sort();
  assert.deepEqual(ids, ["a", "b", "e"]);                    // c closed there, d deleted there
  assert.equal(merged.find(g => g.gameId === "a").players.length, 4); // server wins for a known table
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement**

```js
  function openGameSlots(state) {
    return (Array.isArray(state && state.games) ? state.games : []).filter(isGameOpen);
  }
  function groupGameSlot(state, groupId) {
    return openGameSlots(state).find(g => g.groupId === groupId) || null;
  }
  // Round 2: starting a table never closes another. The only slot it drops is an EMPTY current one
  // (a table opened and left with nobody seated); every other open table stays exactly as it is.
  function openNewGameSlot(base, patch) {
    const current = currentGameSlot(base);
    const dropCurrent = current && isEmptyOpenGame(current);
    const games = (Array.isArray(base.games) ? base.games : []).filter(g => !(dropCurrent && g.gameId === base.gameId));
    const gameId = newId();
    const slot = { gameId, phase: "active", players: [], groupId: null, startedAt: null, leaderRef: null, settlementStatuses: {}, ...patch };
    return syncCurrentGameMirror({ ...base, example: false, gameId, games: [...games, slot] });
  }
  function selectGameSlot(base, gameId) {
    const id = String(gameId || "");
    if (!(Array.isArray(base.games) ? base.games : []).some(g => g.gameId === id)) return base;
    return syncCurrentGameMirror({ ...base, gameId: id });
  }
```
`canStartGroupGame(collections, groupId, serverOpenGames)`:
```js
    if (group && (group.archivedAt || group.deletedAt)) return { ok: false, reason: "group-archived" };
    const slots = Array.isArray(c.games) ? c.games : (c.currentGame ? [c.currentGame] : []);
    if (slots.some(g => isGameOpen(g) && g.groupId === groupId)) return { ok: false, reason: "group-has-open-game" };
    if ((serverOpenGames || []).some(g => g && g.groupId === groupId)) return { ok: false, reason: "group-has-open-game" };
    return { ok: true, reason: null };
```
`initialAppView(gameState)`:
```js
    const open = openGameSlots(gameState);
    if (open.length > 1) return "games";
    if (isGameOpen(gameState) && gameState.phase === "active") return "game";
    if (isGameOpen(gameState) && gameState.phase === "settlement") return "settle";
    if (open.length === 1) return "games";
    return "profile";
```
`mergeOpenGameSlots(localSlots, serverSlots, ctx)`:
```js
    const c = ctx || {};
    const has = (set, id) => !!set && set.has(String(id));
    const serverIds = new Set((serverSlots || []).map(g => String(g.gameId)));
    const merged = (serverSlots || []).filter(g => !has(c.closedHere, g.gameId));
    (localSlots || []).forEach(g => {
      const id = String(g.gameId);
      if (serverIds.has(id) || has(c.closedHere, id)) return;
      if (has(c.closedOnServer, id)) return;      // closed on another device
      if (has(c.confirmedOnServer, id)) return;   // was on the server, is gone now (deleted/abandoned)
      merged.push(g);                              // never reached the server yet: keep
    });
    return merged;
```
- [ ] **Step 4:** run → PASS; full suite (update `tests/group-game-start.test.cjs` / `tests/empty-table.test.cjs` assertions that pin `another-game-open` or the old `initialAppView` to the new decisions — those changes are the feature, not regressions).
- [ ] **Step 5:** commit `feat: pure helpers for several open tables`.

### Task 2: Route, dashboard and group page on top of the helpers

**Files:** `kupa-sgura.html`: `collectionsOf` (add `games: state.games`), `startUngroupedGame`, `startGroupGame`, `continueCurrentGame`, `enterActiveGame`, `renderQuickActions`, `getActiveGameSummaries`, `getGroupSummary`, `renderGroupPrimaryAction`, `finishCloseTable`, `render()` view guard, boot `initialAppView` call. Test: append to `tests/multi-game-round2.test.cjs`.

- [ ] **Step 1: failing tests** — source/vm checks:
  - `getActiveGameSummaries(state, groups)` returns one summary per open slot (vm with two slots → length 2).
  - `getGroupSummary` reports `hasActiveGame` for g2 when the current table is g1's and g2 also has an open slot.
  - `renderQuickActions` no longer disables "משחק ללא קבוצה" (`assert.doesNotMatch(fn("renderQuickActions"), /disabled = true/)`).
  - `renderGroupPrimaryAction` no longer indexes `[0]` and enters via `enterActiveGame(`.
  - `enterActiveGame` resets per-table UI before `selectGameSlot`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement**
  - `startUngroupedGame`: remove the `isGameOpen` guard; `state = openNewGameSlot(state, { phase: "active", startedAt: now, groupId: null })`.
  - `startGroupGame`: gate `canStartGroupGame(collectionsOf(state), groupId, cloudGroupAggregates.openGames)`; `state = openNewGameSlot(state, {...})`.
  - `enterActiveGame(gameId)`:
    ```js
    function enterActiveGame(gameId) {
      if (!(state.games || []).some(g => g.gameId === String(gameId))) return;
      // Per-table UI belongs to the table it was opened on (F2).
      expandedEntries.clear();
      openMenu = null; customOpen = null; pendingAmount = null; exitOpen = null; exitJustOpened = null;
      clearCloseHold(); cancelFinishHold && cancelFinishHold();
      state = selectGameSlot(state, gameId);
      save();
      continueCurrentGame();
    }
    ```
    (`cancelFinishHold` = the existing finish-game hold cancel; locate by the `סיים משחק` pointer handlers and reuse its cancel function.)
  - `renderQuickActions`: always enabled; drop the "יש משחק פעיל אחר" line.
  - `getActiveGameSummaries(gameState, groups)`: `openGameSlots(gameState).map(slot => summaryOf(slot))` (body of today's single summary, applied per slot); current table first.
  - `getGroupSummary`: `const slot = (c.games ? c.games.filter(isGameOpen) : [c.currentGame].filter(isGameOpen)).find(g => g.groupId === groupId)`; `localActive = !!slot`; `activeGamePhase` from it.
  - `renderGroupPrimaryAction`: `const slot = groupGameSlot(state, summary.groupId)`; summary for that slot; button → `enterActiveGame(slot.gameId)`; when `summary.hasActiveGame` but no local slot (D4): status "משחק פעיל בקבוצה" + reason "אתה לא בשולחן הזה", no button.
  - `finishCloseTable`: after dropping the closed slot, `state.gameId = newId()` stays (no current table) — the person lands on the group/dashboard and picks the next table explicitly (F5).
  - `render()`: at the top, `if ((appView === "game" || appView === "settle") && !currentGameSlot(state)) appView = "games";`.
- [ ] **Step 4:** full suite green; manual check in the preview: open a group game, go back, start "משחק ללא קבוצה", both cards on the dashboard, enter each, buy-ins land on the right table, close one, the other remains.
- [ ] **Step 5:** commit `feat: several open tables on one device`.

### Task 3: Push every open table

**Files:** `kupa-sgura.html` `cloudCollections`. Test: append.

- [ ] Step 1 test: vm `cloudCollections` with two slots → `games` has two snapshots.
- [ ] Step 3: replace the single `gameSnapshotFromState(state)` with
  ```js
    (state.games || []).forEach(slot => {
      const snap = gameSnapshotFromState({ ...slot, example: !!state.example });
      if (snap) games.push(snap);
    });
  ```
- [ ] Step 4/5: suite; commit `feat: push every open table`.

### Task 4: Pull and realtime write into the right slot (fixes F1, F4)

**Files:** `kupa-sgura.html`: `applyCloudPull` (open games block, `pulled`, `serverBaseline`), `mergeCloudIntoState` (replace the `p.game` block with `p.games`), `applyCloudGame` + `shouldApplyIncomingGame`, `tryApplyParked`. Test: append + update `tests/cloud-games.test.cjs` pins of `pickCloudOpenGame`.

- [ ] Step 1 tests:
  - **F1 regression:** state with slot `a` (2 players) current; `mergeCloudIntoState(state, { games: [a with 3 players] })` then `normalize` → `state.players.length === 3`.
  - pull merge drops a slot closed on the server and keeps an unsynced one (via `mergeOpenGameSlots`, Task 1).
  - `shouldApplyIncomingGame(state, incoming, hasActiveInput, appView)` refuses only when the input is focused and `incoming.gameId === state.gameId` and `appView` is `game|settle`.
- [ ] Step 3 implement:
  - `applyCloudPull`: `const closedOnServer = new Set((payload.closedGames || []).map(r => String(r.id)));` `const confirmedOnServer = new Set((lastPushedRows && lastPushedRows.games || []).map(r => String(r.id)));` `const games = mergeOpenGameSlots(state.games, openCandidates, { closedOnServer, confirmedOnServer, closedHere });` `pulled.games = games` (drop `pulled.game`, `pickCloudOpenGame`, the `console.warn`). `serverBaseline` games = `openCandidates.map(g => gameSnapshotFromState({ ...g, example: false }))`.
  - `mergeCloudIntoState`: `...(Array.isArray(p.games) ? { example: false, games: p.games } : {})`; and a single-slot update path `...(p.gameSlot ? { games: replaceGameSlot(s.games, p.gameSlot) } : {})` where `replaceGameSlot(games, slot)` swaps by id or appends.
  - `applyCloudGame`: `mergeCloudIntoState(state, { gameSlot: incoming }, {})`.
  - After any merge: `normalize` re-mirrors from the pointer; if the pointer's slot vanished and the person is in `game/settle`, the Task 2 render guard moves them to the dashboard.
- [ ] Step 4/5: suite (expect to update pins on `pickCloudOpenGame` in `tests/cloud-games.test.cjs` — that function is deleted on purpose); commit `fix: pulls and realtime update the right table, and never resurrect a stale one`.

### Task 5: One realtime channel per open table (cap 4)

**Files:** `kupa-sgura.html` realtime section: replace `cloudGameChannel`/`cloudGameChannelId`/`cloudGameChannelBroken` with `cloudGameChannels: Map<gameId, {channel, broken}>`; `syncCloudGameChannel` → reconcile the map against `cloudChannelGameIds(state)`; `leaveCloudGameChannel(id?)`; `pullCloudGame(gameId)` stale check = "the map still has this id"; `onCloudGameChannelStatus`. Test: `tests/multi-game-round2.test.cjs` (pure `cloudChannelGameIds`), update `tests/cloud-read-hardening.test.cjs` realtime test to the map.

- [ ] Step 1 test: `cloudChannelGameIds({gameId:"b", games:[a,b,c,d,e]})` → `["b","a","c","d"]` (current first, cloud ids only, cap 4).
- [ ] Step 3 implement `cloudChannelGameIds(state)`:
  ```js
    const ids = openGameSlots(state).map(g => g.gameId).filter(isCloudId);
    const cur = String(state.gameId || "");
    const ordered = ids.includes(cur) ? [cur, ...ids.filter(id => id !== cur)] : ids;
    return ordered.slice(0, 4);
  ```
  and make `syncCloudGameChannel` add missing / remove extra / recreate broken entries.
- [ ] Step 4/5: suite; manual: two tables, buy-in on the other phone at the non-current one updates its dashboard card live; commit + release.
