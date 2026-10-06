// Session hardening: stale profile work, an honest ensureProfile, session-read errors, and the
// invite / OAuth / resend edges around sign-in. The identity core (ensureProfile, applySession,
// initAuth, signOutAccount) runs from a vm slice with mocks; the DOM-bound edges are source checks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('kupa-sgura.html', 'utf8');
const start = html.indexOf('  let authUser = null;');
const end = html.indexOf('  // A provider redirect comes back with ?code=');
assert.ok(start > 0 && end > start, 'auth identity section not found');
const authSource = html.slice(start, end);

// Resolves/rejects on demand so a test can hold a profile request "in flight".
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function makeEnv(overrides = {}) {
  const calls = { upserts: 0, enterCloud: 0, showLogin: 0, exitCloud: 0, inviteRefresh: 0, signOut: 0 };
  const profilesRead = overrides.read || (() => Promise.resolve({ data: { display_name: 'Existing' }, error: null }));
  const profilesUpsert = overrides.upsert || (() => Promise.resolve({ error: null }));
  const supabase = {
    from() {
      return {
        select() { return { eq() { return { maybeSingle: () => profilesRead() }; } }; },
        upsert() { calls.upserts++; return profilesUpsert(); },
      };
    },
    auth: {
      signOut() { calls.signOut++; return Promise.resolve({ error: null }); },
      getSession: overrides.getSession || (() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange() {},
    },
  };
  const el = () => ({ hidden: false });
  const context = vm.createContext({
    supabase, me: 'Local', calls,
    document: { getElementById: () => el() },
    saveMe() {}, render() {}, stripAuthParamsFromUrl() {}, maybeRunPendingJoin() {}, maybeRunPendingFriendInvite() {},
    setAuthBusy() {},
    enterCloudMode() { calls.enterCloud++; },
    exitCloudMode() { calls.exitCloud++; },
    showLogin() { calls.showLogin++; },
    refreshInviteNotices() { calls.inviteRefresh++; },
    // the 15s profile deadline must not keep the test process alive
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); if (timer.unref) timer.unref(); return timer; },
    clearTimeout,
  });
  vm.runInContext(authSource, context);
  const get = (code) => vm.runInContext(code, context);
  return { context, calls, get };
}

const sessionOf = (id) => ({ user: { id, email: id + '@example.test', user_metadata: {} } });

test('a profile request that finishes after sign-out cannot resurrect the account', async () => {
  const gate = deferred();
  const env = makeEnv({ read: () => gate.promise });
  const pending = env.get('applySession')(sessionOf('A'));
  await env.get('applySession')(null); // SIGNED_OUT arrives while A is still loading
  gate.resolve({ data: { display_name: 'A' }, error: null });
  await pending;
  assert.equal(env.get('authUser'), null);
  assert.equal(env.get('authAppliedUserId'), null);
  assert.equal(env.calls.enterCloud, 0);
});

test('ensureProfile separates a failed read from a missing row and never fabricates success', async () => {
  const readFail = makeEnv({ read: () => Promise.resolve({ data: null, error: { message: 'denied' } }) });
  assert.equal(await readFail.get('ensureProfile')({ id: 'A', email: 'a@x.test' }), null);
  assert.equal(readFail.calls.upserts, 0, 'a failed read must not fall through to an overwrite');

  const missingNoCreate = makeEnv({
    read: () => Promise.resolve({ data: null, error: null }),
    upsert: () => Promise.resolve({ error: { message: 'denied' } }),
  });
  assert.equal(await missingNoCreate.get('ensureProfile')({ id: 'A', email: 'a@x.test' }), null);

  const existingUpdateFails = makeEnv({ upsert: () => Promise.resolve({ error: { message: 'denied' } }) });
  const kept = await existingUpdateFails.get('ensureProfile')({ id: 'A', email: 'a@x.test' });
  assert.equal(kept && kept.displayName, 'Existing', 'a valid existing profile survives a failed update');
});

test('a failed profile keeps cloud mode off, shows login once, and a later same-user event retries', async () => {
  let attempt = 0;
  const env = makeEnv({
    read: () => (++attempt === 1
      ? Promise.resolve({ data: null, error: { message: 'offline' } })
      : Promise.resolve({ data: { display_name: 'A' }, error: null })),
  });
  await env.get('applySession')(sessionOf('A'));
  assert.equal(env.get('authUser'), null);
  assert.equal(env.get('authProfileFailedUserId'), 'A');
  assert.equal(env.calls.enterCloud, 0);
  assert.equal(env.calls.showLogin, 1);
  await env.get('applySession')(sessionOf('A')); // e.g. TOKEN_REFRESHED — not deduped away
  assert.equal(env.get('authUser').id, 'A');
  assert.equal(env.get('authProfileFailedUserId'), null);
  assert.equal(env.calls.enterCloud, 1);
});

test('initAuth: a confirmed-dead session clears identity, a network failure keeps it', async () => {
  const dead = makeEnv({ getSession: () => Promise.resolve({ data: { session: null }, error: { status: 400, message: 'Invalid Refresh Token' } }) });
  await dead.get('applySession')(sessionOf('A'));
  dead.get('initAuth')();
  await new Promise(r => setImmediate(r));
  assert.equal(dead.get('authUser'), null);

  const offline = makeEnv({ getSession: () => Promise.resolve({ data: { session: null }, error: { status: 0, message: 'Failed to fetch' } }) });
  await offline.get('applySession')(sessionOf('A'));
  offline.get('initAuth')();
  await new Promise(r => setImmediate(r));
  assert.equal(offline.get('authUser').id, 'A');
});

test('invite notices are re-rendered on backend readiness and on the initial null session, and keep the token', () => {
  assert.match(html, /initAuth\(\);\s*refreshInviteNotices\(\);/, 'bootBackend refreshes the notices');
  const nullBranch = authSource.slice(authSource.indexOf('if (!user) {'), authSource.indexOf('authAppliedUserId === user.id'));
  assert.equal((nullBranch.match(/refreshInviteNotices\(\)/g) || []).length, 2, 'both null-session exits refresh');
  assert.match(html, /if \(!supabase\) joinNoticeParts\(\)\.notice\.hidden = true;\s*else closeJoinNotice\(\);/,
    'dismissing the "no backend" notice must not discard the pending token');
});

test('resend is single-flight, and a stored OAuth error is shown even when a local name exists', () => {
  assert.match(html, /async function resendEmailCode\(\) \{\s*if \(!supabase \|\| !authEmailPending \|\| authResendBusy\) return;/);
  assert.match(html, /btn\.disabled = authResendBusy;/);
  const boot = html.slice(html.indexOf('const friendToken = parseFriendToken(location.search);'));
  assert.match(boot, /if \(authRedirectError\) \{[\s\S]*?showLogin\(\);\s*\} else if \(friendToken\)/);
  assert.match(html, /window\.addEventListener\("pageshow", resetGoogleBusy\)/);
  assert.match(html, /document\.addEventListener\("visibilitychange", \(\) => \{ if \(!document\.hidden\) resetGoogleBusy\(\); \}\)/);
});

test("a hung profile request gives up after 15s and shows the retry line instead of spinning forever", () => {
  assert.match(authSource, /const AUTH_PROFILE_TIMEOUT_MS = 15000;/);
  assert.match(authSource, /const profile = await Promise\.race\(\[\s*ensureProfile\(user\),\s*new Promise\(resolve => setTimeout\(\(\) => resolve\(null\), AUTH_PROFILE_TIMEOUT_MS\)\),\s*\]\);/);
});

test("'לא עכשיו' on a friend invite before signing in keeps the invite for after sign-in", () => {
  const html = require("node:fs").readFileSync("kupa-sgura.html", "utf8");
  const show = html.slice(html.indexOf("  function showFriendNotice(token) {"), html.indexOf("  function maybeRunPendingFriendInvite()"));
  assert.match(show, /ui\.laterBtn\.addEventListener\("click", \(\) => \{\s*if \(cloudMode\(\)\) \{ closeFriendNotice\(\); return; \}\s*friendNoticeParts\(\)\.notice\.hidden = true;/);
  assert.doesNotMatch(show, /ui\.laterBtn\.addEventListener\("click", closeFriendNotice\)/);
});
