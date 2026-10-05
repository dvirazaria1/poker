# Push Quarantine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One row the server permanently refuses no longer blocks every later write: it is set aside (quarantined) with its reason, everything else keeps syncing, and the sync dot names what was set aside.

**Architecture:** Client-only, inside `pushCloudRun` (kupa-sgura.html, cloud store section). A row-specific refusal is identified (existing `cloudNameRefusedRow` for batch inserts, per-row UPDATE loop already tags its row), added to an in-memory quarantine keyed by row id + content hash, and the push re-runs without it. Rows that reference a quarantined parent are held (not sent) in the same run. Quarantine is released on boot, on a tap of the dot, and automatically when the row's content changes.

**Tech Stack:** vanilla JS in `kupa-sgura.html`; Node built-in test runner (`tests/*.test.cjs`, vm-sliced source).

## Global Constraints

- Only runtime source is `kupa-sgura.html`; never hand-edit `index.html` / `sw.js` cache line; release = bump `VERSION` in `build.py`, `python3 build.py`, tests, commit, push.
- No new localStorage keys. Quarantine is in memory only.
- A quarantined row is never deleted or altered locally — it stays in `state` exactly as the person left it.
- Keep the insert/update split (`splitCloudWrites`, `cloudNameRefusedRow`, `.update(cloudUpdateFields(row))`) exactly as it is.
- UI copy Hebrew; code/comments/commits English.

## Failure modes found while planning, and how the plan resolves each

| # | Failure mode | Resolution |
|---|---|---|
| Q1 | An expired session (401, `PGRST301`, "JWT expired") is classified "surface"; quarantining would set aside perfectly good rows. | `isRowSpecificRefusal(error)`: only `42501`, `22P02`, `23xxx` with an identified row quarantine. Auth/status errors keep today's behavior. |
| Q2 | A batch INSERT is refused but every row passes when probed one by one (a race). Nothing to quarantine. | `cloudNameRefusedRow` returns the batch error untagged; no row → no quarantine → today's red + pull. |
| Q3 | Parent refused, children sent anyway → each child fails FK `23503` → N extra failed pushes, N quarantines of innocent rows. | `cloudHeldByQuarantine(row, ids)`: a row whose `group_id` / `game_id` / `participant_id` / `from_participant_id` / `to_participant_id` names a quarantined id is held for this run, not quarantined. |
| Q4 | Infinite loop: quarantine → re-push → same row refused again (different hash each run because `updated_at`-like fields change). | Hash = JSON of the row minus `updated_at`; and a hard cap of 8 quarantine re-runs per push cycle (`cloudQuarantineRuns`), reset on success/tap/boot. |
| Q5 | Red forever after the cause is fixed server-side. | Released on `enterCloudMode` (boot/sign-in) and `cloudRetryNow` (dot tap); a changed row is retried automatically. |
| Q6 | Quarantined ids still counted in the outbox → dot flips between red and grey. | `cloudOutboxSignal` excludes quarantined ids; red wins over grey anyway. |
| Q7 | A quarantined open game → its buy-ins never reach other phones silently. | The dot detail names the game row; red persists while anything is quarantined. |
| Q8 | `pushCloudGameDeletes` (batch DELETE) cannot name a row. | Out of scope: deletes keep today's behavior (red, stop). Documented. |

---

### Task 1: Quarantine helpers (pure) + tests

**Files:**
- Modify: `kupa-sgura.html` — cloud mapping (pure) section, next to `cloudStillPendingIds`
- Test: `tests/push-quarantine.test.cjs` (create)

**Interfaces:**
- Produces: `cloudRowHash(row) -> string`, `isRowSpecificRefusal(error) -> boolean`, `cloudHeldByQuarantine(row, quarantinedIds:Set<string>) -> boolean`

- [ ] **Step 1: Write the failing test** (`tests/push-quarantine.test.cjs`)

```js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync("kupa-sgura.html", "utf8");
const fn = name => { const s = html.indexOf("  function " + name + "("); return html.slice(s, html.indexOf("\n  }\n", s) + 4); };
const ctx = vm.createContext({});
vm.runInContext(["cloudRowHash", "isRowSpecificRefusal", "cloudHeldByQuarantine"].map(fn).join("\n"), ctx);

test("a row's hash ignores updated_at, so the same refused row is recognised next run", () => {
  assert.equal(ctx.cloudRowHash({ id: "a", x: 1, updated_at: "1" }), ctx.cloudRowHash({ id: "a", x: 1, updated_at: "2" }));
  assert.notEqual(ctx.cloudRowHash({ id: "a", x: 1 }), ctx.cloudRowHash({ id: "a", x: 2 }));
});
test("only RLS / constraint / bad-value refusals of an identified row quarantine", () => {
  assert.equal(ctx.isRowSpecificRefusal({ code: "42501", cloudRow: { id: "a" } }), true);
  assert.equal(ctx.isRowSpecificRefusal({ code: "23505", cloudRow: { id: "a" } }), true);
  assert.equal(ctx.isRowSpecificRefusal({ code: "42501" }), false);                 // no row named
  assert.equal(ctx.isRowSpecificRefusal({ code: "PGRST301", cloudRow: { id: "a" } }), false); // expired JWT
  assert.equal(ctx.isRowSpecificRefusal({ status: 401, cloudRow: { id: "a" } }), false);
});
test("a child of a quarantined parent is held, not refused", () => {
  const q = new Set(["g1", "p1"]);
  assert.equal(ctx.cloudHeldByQuarantine({ id: "e", game_id: "g1" }, q), true);
  assert.equal(ctx.cloudHeldByQuarantine({ id: "m", group_id: "g1" }, q), true);
  assert.equal(ctx.cloudHeldByQuarantine({ id: "t", from_participant_id: "p1" }, q), true);
  assert.equal(ctx.cloudHeldByQuarantine({ id: "x", game_id: "g2" }, q), false);
});
```

- [ ] **Step 2: Run** `node --test tests/push-quarantine.test.cjs` → FAIL (functions missing).

- [ ] **Step 3: Implement** (cloud mapping section, after `cloudStillPendingIds`)

```js
  // ----- push quarantine (docs/superpowers/plans/2026-10-05-push-quarantine.md) -----
  // A row's identity across push runs: its content without updated_at, which a re-save bumps.
  function cloudRowHash(row) {
    const copy = { ...(row || {}) };
    delete copy.updated_at;
    return JSON.stringify(copy, Object.keys(copy).sort());
  }
  // Worth setting one row aside only when the server refused THAT row for what it contains:
  // RLS (42501), a constraint (23xxx) or a bad value (22P02). An expired session or an HTTP status
  // says nothing about the row, and a batch whose culprit was not found names no row at all.
  function isRowSpecificRefusal(error) {
    const e = error || {};
    if (!e.cloudRow || !e.cloudRow.id) return false;
    const code = String(e.code || "");
    return code === "42501" || code === "22P02" || /^23/.test(code);
  }
  const CLOUD_PARENT_COLUMNS = ["group_id", "game_id", "participant_id", "from_participant_id", "to_participant_id"];
  function cloudHeldByQuarantine(row, quarantinedIds) {
    if (!row || !quarantinedIds || !quarantinedIds.size) return false;
    return CLOUD_PARENT_COLUMNS.some(col => row[col] && quarantinedIds.has(String(row[col])));
  }
```

- [ ] **Step 4: Run** → PASS. Full suite `node --test tests/*.test.cjs` → green.
- [ ] **Step 5: Commit** `feat: pure helpers for the push quarantine`

### Task 2: Wire the quarantine into pushCloudRun, the dot and the release points

**Files:**
- Modify: `kupa-sgura.html` — cloud store section: state vars near `cloudLastRetryError`; `pushCloudRun` row filter + catch; `cloudOutboxSignal`; `refreshSyncDot` / `cloudWaitingDetail`; `enterCloudMode`; `cloudRetryNow`; the CLOUD_INSERT_ONLY branch error.
- Test: `tests/push-quarantine.test.cjs` (append)

**Interfaces:**
- Consumes: Task 1 helpers, existing `cloudNameRefusedRow`, `tagCloudError`, `describeCloudRow`.
- Produces: `cloudQuarantine: Map<id, {hash, table, code, message}>`, `cloudQuarantinedIds() -> Set`, `releaseCloudQuarantine()`.

- [ ] **Step 1: Append failing source-shape tests**

```js
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
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.**

State (next to `cloudLastRetryError`):
```js
  // Rows the server refused for what they contain, set aside so the rest keeps syncing. In memory
  // only: a reload, a sign-in or a tap on the dot retries them; so does any edit to the row.
  let cloudQuarantine = new Map(); // id -> { hash, table, code, message }
  let cloudQuarantineRuns = 0;     // re-runs this push cycle spent on quarantining (cap 8)
  function cloudQuarantinedIds() { return new Set(cloudQuarantine.keys()); }
  function releaseCloudQuarantine() { cloudQuarantine = new Map(); cloudQuarantineRuns = 0; }
  // A quarantined row is skipped only while it is unchanged; an edited one gets a fresh try.
  function cloudQuarantineSkips(row, quarantined) {
    const q = row && cloudQuarantine.get(String(row.id));
    if (q && q.hash !== cloudRowHash(row)) { cloudQuarantine.delete(String(row.id)); return false; }
    return !!q || cloudHeldByQuarantine(row, quarantined);
  }
```
In `pushCloudRun`, right after `const isEditable = ...`:
```js
    const quarantined = cloudQuarantinedIds();
```
and change the per-table rows line to also drop quarantined/held rows:
```js
        const rows = (pair[0] === "gamesClosed" ? (next[pair[0]] || []) : (next[pair[0]] || []).filter(notFrozen))
          .filter(row => !cloudQuarantineSkips(row, quarantined));
```
CLOUD_INSERT_ONLY branch: `throw await cloudNameRefusedRow(result.error, pair[1], upserts);` (was `tagCloudError`).
In the catch, before the retry/surface split:
```js
      if (isRowSpecificRefusal(e) && cloudQuarantineRuns < 8) {
        const row = e.cloudRow;
        cloudQuarantine.set(String(row.id), { hash: cloudRowHash(row), table: e.cloudTable || "", code: String(e.code || ""), message: String(e.message || "").slice(0, 120) });
        cloudQuarantineRuns++;
        console.warn("cloud push: set aside", e.cloudTable, row.id, e.code, e.message);
        clearTimeout(cloudPushTimer);
        cloudPushTimer = setTimeout(() => { cloudPushTimer = null; if (pushIsCurrent()) pushCloud(); }, 0);
        return;
      }
```
On success (where `cloudLastRetryError = null` is set): `cloudQuarantineRuns = 0;`
`cloudOutboxSignal`: count only pending ids not in `cloudQuarantinedIds()`.
`refreshSyncDot`: `error: cloudSurfaceError || cloudQuarantine.size > 0`; detail for error = `cloudErrorDetail(cloudLastError)` plus, when the quarantine is non-empty, one line `"set aside: " + [...].map(q => q.table + " " + id.slice(0,8) + " " + q.code).join(", ")`.
`enterCloudMode` and `cloudRetryNow`: call `releaseCloudQuarantine();` first.

- [ ] **Step 4: Run** full suite → green. Then a vm harness (scratchpad, not committed) that stubs `supabase.from(t).upsert/update` to refuse one group row with `{code:"42501"}` and asserts: the group is quarantined, its member/invite rows are held, the friendship row in the same push is written.
- [ ] **Step 5: Commit** `feat: quarantine a refused row instead of stopping the whole push`; build + release.
