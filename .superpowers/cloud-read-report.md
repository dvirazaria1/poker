# Cloud read hardening report

Source: `kupa-sgura.html` only (plus tests). `index.html`, `sw.js`, `build.py` untouched, no build run, no SQL, no production access. Auth-section functions (applySession/ensureProfile/initAuth/login/invite notices) not touched.

## Connection review

### #4 failed child reads became empty game data
- `fetchCloudGameChildren` now returns `{participants, entries, transfers, failures}`; each query's error is described (`cloudReadFailure`, new pure helper) with its table. All three child tables are treated as required. A successful 200-empty answer stays failure-free, so player-boundary filtering still works through `cloudGameChildrenAreTrustworthy`.
- `pullCloud` marks `games` unavailable when any child read failed. `applyCloudPull` then applies the non-game collections but holds history, the open slot, debts (their ids depend on transfer settlement keys) and the game part of the diff baseline at last-good (`cloudKeepPreviousRows`; guests are unioned). Keeping the baseline matters: rebuilding it from nothing would drop closed games from `lastPushedRows` and un-freeze them (the 9b chain).
- The failing table shows on the dot: `cloudPullErrorInfo` -> `cloudLastError` + `cloudSurfaceError`.
- Not done on purpose: no per-game retry of the batched query. One `.in(game_id, ids)` request serves all games, so one failure holds all game snapshots for that pull rather than only "that game"; splitting into per-game requests would change request volume. If a reconcile marker is waiting while games are held, the pull spends one bounded reconcile retry instead of declaring rows "missing".

### #5 realtime read bypassed trust/session guards
- `pullCloudGame` captures the account id, `cloudWriteSeq` and target game before the first await and drops the result if any changed (re-schedules the read if a local write landed). It uses the same `fetchCloudGameChildren`; child failures are surfaced and nothing is applied. A 200-null game row now triggers a full `pullCloud()` (lifecycle reconciliation) instead of silently returning; game-read errors are surfaced.
- `applyCloudGame` takes the captured account id and calls `cloudGameChildrenAreTrustworthy` with the same arguments the full pull uses.
- Not done: an untrusted realtime result is dropped silently (the full pull does the same for open games), not shown on the dot.

### #7 optional reads replaced with []
- `pullCloud` records invites/friendships/debts/guests failures in `unavailable` + `readFailures`. `mergeCloudIntoState` skips `invites`/`friendships` when listed (new `unavailable` option on the pulled object; absent = old behavior, so existing semantics are unchanged); debts/history are passed as `undefined` (merge already ignores non-arrays); `cloudGuestRows` is kept. Baselines for those collections are kept via `cloudKeepPreviousRows`.
- The dot goes red with `table code: read failed: ...` until the next clean pull or push. A permanently failing optional table therefore shows a permanently red dot; that is the intent ("do not claim fully synced").

### #8 aggregates
- `applyCloudPull` replaces `cloudGroupAggregates` only when `payload.groupAggregatesOk` (both views answered). Otherwise the previous cache stays. Not done: independent per-view caches / confirmed-missing-vs-transient distinction (the report's full design). A healthy view is still not refreshed when its sibling fails; it keeps its previous value, which is the stated requirement and avoids mixing snapshots of different ages. Aggregate failures do not turn the dot red because a not-yet-migrated view would make it permanently red.

### #9 realtime failures
- `.subscribe(status => onCloudGameChannelStatus(...))`. SUBSCRIBED (first join and every re-join) schedules the debounced catch-up `pullCloudGame`. CHANNEL_ERROR / TIMED_OUT / CLOSED set `cloudGameChannelBroken` and surface `realtime <status>: live updates are down` via `noteCloudReadFailure`. `syncCloudGameChannel` recreates a broken channel despite the same-game-id check; `cloudRetryNow` (foreground, online, dot tap) now calls it first. Callbacks from replaced channels (including the CLOSED caused by our own teardown) are ignored.
- `noteCloudReadFailure` does not go red while `navigator.onLine === false` (the online event retries).
- Not done: bounded polling fallback while degraded (no timer introduced); verification of publication membership (needs production).

## Sync-failure review (9b/9c)

- Foreign closed games: `pushCloudRun` computes `cloudForeignClosedGameIds(next.gamesClosed, knownGameIds, pushAccountId)` (not in the baseline and `created_by` != me). Such a game gets no open shell, no participants/entries/transfers/debts, and its closed row is dropped from `rows` (so not sent, not confirmed). It stays local. Known/frozen games and games I created behave as before. The existing UPDATE-for-known-rows and `cloudNameRefusedRow` paths are untouched.
- Own reasons for the reconciliation-only red routes: `retryCloudInsertReconcile` exhaustion sets `sync reconcile-retries`; the missing-reconcile marker in `applyCloudPull` sets `sync reconcile-missing: written row not readable back: groups:xxxxxxxx`.

## Tests
- New `tests/cloud-read-hardening.test.cjs` (7 tests: executes `fetchCloudGameChildren` and the channel-status handler against mocks; pure helpers; source assertions for the pull/push wiring).
- Two existing source-shape assertions updated because the code they pin changed intentionally: `tests/cloud-games.test.cjs` (`.subscribe()` -> status callback) and `tests/group-aggregates.test.cjs` (aggregate cache replaced only on success).
- Full suite: 705 pass, 0 fail. `new Function` syntax check of the whole app script passes.

## Could not verify
- Nothing ran against Supabase or a real browser: supabase-js result shapes (`{data, error, status}`; network failures returned as `error` with status 0) and realtime status strings are taken from library behavior, exercised only through mocks.
- The red-dot behavior on a real flaky network (offline suppression uses `navigator.onLine`, which can be wrong on captive networks).
- Interaction of a held-games pull with a live multi-device session was not exercised end to end.
