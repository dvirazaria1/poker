// Cloud READ hardening: a failed read must never pass for an empty answer, a realtime read must
// obey the same trust/session rules as the full pull, and a red dot must always say why.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('kupa-sgura.html', 'utf8');
function sourceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + 1);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end >= 0, `missing ${endMarker}`);
  return html.slice(start, end);
}
const pureSource = sourceBetween('  // ---------- cloud mapping (pure) ----------', '  function el(');
const storeSource = sourceBetween('  // ---------- cloud store (Supabase) ----------', '  // ---------- cloud mapping (pure) ----------');
function fn(name) {
  const start = storeSource.search(new RegExp(`  (async )?function ${name}\\(`));
  assert.ok(start >= 0, `missing ${name}`);
  return storeSource.slice(start, storeSource.indexOf('\n  }\n', start) + 5);
}
const plain = value => JSON.parse(JSON.stringify(value));
function pureContext(extra) {
  const context = vm.createContext({ ...(extra || {}) });
  vm.runInContext(pureSource, context);
  return context;
}

test('fetchCloudGameChildren reports a failed child query instead of returning empty arrays as data', async () => {
  const answers = {
    game_participants: { data: [{ id: 'p' }] },
    entries: { error: { code: '42501', message: 'denied' }, status: 403 },
    transfers: { data: [] },
  };
  const supabase = {
    from: table => {
      const chain = { select: () => chain, in: () => chain, order: () => Promise.resolve(answers[table]) };
      return chain;
    },
  };
  const context = pureContext({ supabase, authUser: { id: 'me' } });
  vm.runInContext(fn('fetchCloudGameChildren'), context);
  const bad = plain(await context.fetchCloudGameChildren(['g']));
  assert.equal(bad.failures.length, 1);
  assert.equal(bad.failures[0].table, 'entries');
  assert.equal(bad.failures[0].code, '42501');
  assert.deepEqual(bad.participants, [], 'a failed read exposes no half-applied rows');
  // A SUCCESSFUL empty answer (player boundary: 200 + []) stays an ordinary, failure-free result.
  answers.entries = { data: [] };
  answers.game_participants = { data: [] };
  const ok = plain(await context.fetchCloudGameChildren(['g']));
  assert.deepEqual(ok.failures, []);
  assert.deepEqual(ok.participants, []);
});

test('cloudPullErrorInfo gives every red route its own reason: read failure, missing reconcile row', () => {
  const ctx = pureContext();
  const readFail = ctx.cloudReadFailure('invites', { error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 });
  const info = plain(ctx.cloudPullErrorInfo(['groups:abcdef1234567890'], [readFail]));
  assert.equal(info.table, 'invites');
  assert.match(ctx.cloudErrorDetail(info), /^invites PGRST301: read failed: JWT expired/);
  const missing = plain(ctx.cloudPullErrorInfo(['groups:abcdef1234567890'], []));
  assert.equal(missing.table, 'sync');
  assert.equal(missing.code, 'reconcile-missing');
  assert.match(missing.message, /groups:abcdef12$/);
  assert.equal(ctx.cloudPullErrorInfo([], []), null);
  assert.equal(plain(ctx.cloudSyncReason('reconcile-retries', 'x')).code, 'reconcile-retries');
  // Both reconciliation-only routes in the store assign that reason, not just the flag.
  assert.match(fn('retryCloudInsertReconcile'), /cloudSurfaceError = true;\s*\n\s*\/\/[^\n]*\n\s*cloudLastError = cloudSyncReason\("reconcile-retries"/);
  assert.match(fn('applyCloudPull'), /cloudSurfaceError = true;\s*\n\s*cloudLastError = cloudPullErrorInfo\(missingReconcileRows, readFailures\)/);
});

test('a failed optional collection keeps its last-good local data and its last-good baseline', () => {
  const ctx = pureContext();
  const state = {
    groups: [{ id: 'g1', name: 'G' }], groupMembers: [], invites: [{ id: 'i1', groupId: 'g1' }],
    friendships: [{ id: 'f1' }], history: [{ gameId: 'old', at: '2026-01-01T00:00:00Z' }],
  };
  const pulled = { groups: [{ id: 'g1', name: 'G' }], groupMembers: [], invites: [], friendships: [] };
  const merged = plain(ctx.mergeCloudIntoState(state, { ...pulled, unavailable: ['invites', 'friendships'] }, {}));
  assert.deepEqual(merged.invites.map(i => i.id), ['i1']);
  assert.deepEqual(merged.friendships.map(f => f.id), ['f1']);
  // Without the marker an empty answer is still the server's answer (replacement stays meaningful).
  assert.deepEqual(plain(ctx.mergeCloudIntoState(state, pulled, {})).invites, []);
  const baseline = { invites: [], games: [], guests: [{ id: 'new' }] };
  const previous = { invites: [{ id: 'i1' }], games: [{ id: 'g' }], guests: [{ id: 'old' }, { id: 'new' }] };
  const kept = plain(ctx.cloudKeepPreviousRows(baseline, previous, ['invites', 'games'], ['guests']));
  assert.deepEqual(kept.invites, [{ id: 'i1' }]);
  assert.deepEqual(kept.games, [{ id: 'g' }]);
  assert.deepEqual(kept.guests.map(g => g.id), ['new', 'old']);
  const pull = fn('pullCloud');
  assert.match(pull, /readFailed\("invites", "invites", invitesResult\)/);
  assert.match(pull, /readFailed\("friendships", "friendships", friendsResult\)/);
  assert.match(pull, /readFailed\("debts", "debts", debtsResult\)/);
  assert.match(pull, /readFailed\("guests", "guests", guestsResult\)/);
  assert.match(pull, /if \(children\.failures\.length\) \{[\s\S]*?unavailable\.push\("games"\)/);
});

test('aggregates are replaced only when both views answered; a failed query keeps the last-good pair', () => {
  const apply = fn('applyCloudPull');
  assert.match(apply, /if \(payload\.groupAggregatesOk\) \{\s*cloudGroupAggregates = \{/);
  // And nowhere does a failed pull blank the cache any more (only enter/exitCloudMode reset it).
  assert.ok(!/cloudGroupAggregates = \{\s*available: !!payload/.test(apply));
});

test('the realtime read uses the full pull trust predicate and drops a result for a changed account', () => {
  const pullGame = fn('pullCloudGame');
  assert.match(pullGame, /const accountId = authUser\.id;[\s\S]*await supabase\.from\("games"\)/, 'account captured before the first await');
  assert.match(pullGame, /fetchCloudGameChildren\(\[gameId\]\)/);
  assert.match(pullGame, /children\.failures\.length\) \{ noteCloudReadFailure\(children\.failures\)/);
  assert.match(pullGame, /readSeq !== cloudWriteSeq/);
  const applyGame = fn('applyCloudGame');
  assert.match(applyGame, /accountId && authUser\.id !== accountId\) return;/);
  assert.match(applyGame, /cloudGameChildrenAreTrustworthy\(gameRow, participantRows, authUser\.id\)\) return;/);
});

test('realtime status: SUBSCRIBED runs a catch-up pull, a failure is surfaced and the channel is recreated', () => {
  const calls = [];
  let created = 0;
  const made = [];
  const makeChannel = () => {
    const ch = { on() { return ch; }, subscribe(cb) { ch.cb = cb; return ch; } };
    created++;
    made.push(ch);
    return ch;
  };
  const GAME = '11111111-1111-4111-8111-111111111111';
  const supabase = { channel: () => makeChannel(), removeChannel: () => calls.push('remove') };
  const context = pureContext({
    supabase,
    authUser: { id: 'me' },
    state: { example: false, gameId: GAME, games: [{ gameId: GAME, phase: 'active', players: [{ id: 'p' }] }] },
    isCloudId: () => true,
    openGameSlots: s => (s.games || []).filter(g => g.players && g.players.length),
    clearTimeout,
    scheduleCloudGamePull: () => calls.push('catchup'),
    noteCloudReadFailure: failures => calls.push('red:' + failures[0].code),
    document: { hidden: false },
  });
  const source = ['cloudChannelGameIds', 'syncCloudGameChannel', 'onCloudGameChannelStatus', 'leaveCloudGameChannel'].map(fn).join('\n');
  vm.runInContext('var CLOUD_GAME_CHANNEL_CAP = 4; var cloudGameChannels = new Map();\n' + source, context);
  context.syncCloudGameChannel();
  assert.equal(created, 1);
  const first = made[0];
  first.cb('SUBSCRIBED');
  assert.deepEqual(calls, ['catchup']);
  first.cb('TIMED_OUT');
  assert.equal(calls[1], 'red:TIMED_OUT');
  context.syncCloudGameChannel(); // same table, but the channel is broken: recreated
  assert.equal(created, 2);
  assert.ok(calls.includes('remove'));
  first.cb('CLOSED'); // a callback from the replaced channel (including its own teardown) is ignored
  assert.equal(calls.filter(c => c.startsWith('red:')).length, 1);
  made[1].cb('SUBSCRIBED'); // a re-subscribe catches up again
  assert.equal(calls.filter(c => c === 'catchup').length, 2);
});

test('a closed game created by someone else is never re-sent as a shell, children or close', () => {
  const ctx = pureContext();
  const rows = [{ id: 'mine', created_by: 'me' }, { id: 'theirs', created_by: 'other' }, { id: 'known', created_by: 'other' }];
  const foreign = ctx.cloudForeignClosedGameIds(rows, new Set(['known']), 'me');
  assert.deepEqual(Array.from(foreign), ['theirs']);
  const push = fn('pushCloudRun');
  assert.match(push, /cloudForeignClosedGameIds\(next\.gamesClosed, knownGameIds, pushAccountId\)/);
  assert.match(push, /!known\.has\(String\(row\.id\)\) && !foreignClosed\.has\(String\(row\.id\)\)/, 'no open shell');
  assert.match(push, /return !frozen\.has\(gameId\) && !foreignClosed\.has\(gameId\);/, 'no children or debts');
  assert.match(push, /\(next\[pair\[0\]\] \|\| \[\]\)\s*\.filter\(row => !foreignClosed\.has\(String\(row\.id\)\)\)/, 'no close');
});

test('a group someone else created is never inserted from here, nor its members or invites, and a pull that no longer shows it lets it go', () => {
  // 2026-10-10: a group deleted by its creator is hidden from its members by groups_select_members;
  // the phone kept it as an unsynced local group and every push was refused (42501, set aside).
  const push = fn('pushCloudRun');
  assert.match(push, /const foreignGroups = cloudForeignGroupIds\(next\.groups, new Set\(\(previous\.groups \|\| \[\]\)\.map\(row => String\(row\.id\)\)\), pushAccountId\);/);
  assert.match(push, /const groupKey = \{ groups: "id", groupMembers: "group_id", invites: "group_id" \}\[pair\[0\]\];/);
  assert.match(push, /\.filter\(row => !groupKey \|\| !foreignGroups\.has\(String\(row\[groupKey\]\)\)\)/);
  const apply = fn('applyCloudPull');
  assert.match(apply, /const dropGroupIds = Array\.from\(cloudForeignGroupIds\(buildCloudRows\(cloudCollections\(\), cloudContext\(\)\)\.groups,\s*new Set\(groupRows\.map\(row => String\(row && row\.id\)\)\), authUser\.id\)\);/);
  assert.match(apply, /mergeCloudIntoState\(state, pulled, \{ keepLocalIds: cloudKeepLocalIds\(\), dropGroupIds \}\)/);
});
