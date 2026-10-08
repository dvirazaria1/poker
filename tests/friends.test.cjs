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

// The friends (pure) section only depends on identityKey/sameIdentity (defined later, in the
// groups domain (pure) section) and newId (defined elsewhere in the file, stubbed here the same
// way tests/groups-domain.test.cjs stubs it for resolveGuestId/newCurrentGame).
const friendsSource = sourceBetween('  // ---------- friends (pure) ----------', '  // ---------- player exit (pure) ----------');
const identitySource = sourceBetween('  function identityKey(ref) {', '  function resolveGuestId(');

function load(newIdStub) {
  const context = vm.createContext({ newId: newIdStub || (() => 'stub-new-id') });
  vm.runInContext(friendsSource, context);
  vm.runInContext(identitySource, context);
  return context;
}

// vm.runInContext returns objects/arrays from the sandbox's own realm, so a plain deepEqual
// against a native literal fails on "same structure, not reference-equal". JSON round-trip fixes it.
function runJSON(code, context) {
  return JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context));
}

function ref(guestId, displayName) {
  return { userId: null, guestId, displayName };
}

// ---------- friendRequestsFor ----------

test('friendRequestsFor partitions pending/accepted friendships relative to meRef', () => {
  const context = load();
  const me = ref('g-me', 'דביר');
  const other = ref('g-a', 'עומר');
  const other2 = ref('g-b', 'רותם');
  const other3 = ref('g-c', 'יובל');
  const friendships = [
    { id: 'f1', requester: me, addressee: other, status: 'pending', createdAt: 't1', respondedAt: null },      // outgoing (I'm requester)
    { id: 'f2', requester: other2, addressee: me, status: 'pending', createdAt: 't2', respondedAt: null },     // incoming (I'm addressee)
    { id: 'f3', requester: me, addressee: other3, status: 'accepted', createdAt: 't3', respondedAt: 't3b' },   // friend (I'm requester)
    { id: 'f4', requester: ref('g-d', 'נועה'), addressee: ref('g-e', 'אלון'), status: 'pending', createdAt: 't4', respondedAt: null }, // unrelated to me
  ];
  const result = runJSON(`friendRequestsFor(${JSON.stringify(friendships)}, ${JSON.stringify(me)})`, context);
  assert.deepEqual(result.outgoing.map(f => f.id), ['f1']);
  assert.deepEqual(result.incoming.map(f => f.id), ['f2']);
  assert.deepEqual(result.friends, [other3]);
});

test('friendRequestsFor maps an accepted friendship to the other party even when I am the addressee', () => {
  const context = load();
  const me = ref('g-me', 'דביר');
  const other = ref('g-a', 'עומר');
  const friendships = [
    { id: 'f1', requester: other, addressee: me, status: 'accepted', createdAt: 't1', respondedAt: 't1b' },
  ];
  const result = runJSON(`friendRequestsFor(${JSON.stringify(friendships)}, ${JSON.stringify(me)})`, context);
  assert.deepEqual(result.friends, [other]);
  assert.deepEqual(result.incoming, []);
  assert.deepEqual(result.outgoing, []);
});

test('friendRequestsFor returns empty lists for an empty or missing friendships array', () => {
  const context = load();
  const me = ref('g-me', 'דביר');
  assert.deepEqual(runJSON(`friendRequestsFor([], ${JSON.stringify(me)})`, context), { incoming: [], outgoing: [], friends: [] });
  assert.deepEqual(runJSON(`friendRequestsFor(undefined, ${JSON.stringify(me)})`, context), { incoming: [], outgoing: [], friends: [] });
});

// ---------- createFriendRequest ----------

test('createFriendRequest refuses a self-request and does not mutate the array', () => {
  const context = load(() => 'new-id-1');
  const me = ref('g-me', 'דביר');
  vm.runInContext(`var friendships = [];`, context);
  const result = vm.runInContext(`createFriendRequest(friendships, ${JSON.stringify(me)}, ${JSON.stringify(me)}, 't0')`, context);
  assert.equal(result, null);
  assert.equal(runJSON(`friendships.length`, context), 0);
});

test('createFriendRequest pushes a new pending friendship and blocks duplicates in either direction', () => {
  const context = load(() => 'new-id-1');
  const me = ref('g-me', 'דביר');
  const other = ref('g-a', 'עומר');
  vm.runInContext(`
    var me = ${JSON.stringify(me)};
    var other = ${JSON.stringify(other)};
    var friendships = [];
  `, context);

  const created = runJSON(`createFriendRequest(friendships, me, other, 't1')`, context);
  assert.deepEqual(created, { id: 'new-id-1', requester: me, addressee: other, status: 'pending', createdAt: 't1', respondedAt: null });
  assert.equal(runJSON(`friendships.length`, context), 1);

  // same direction again -> blocked
  assert.equal(vm.runInContext(`createFriendRequest(friendships, me, other, 't2')`, context), null);
  // reverse direction -> also blocked (a pending request already links the two)
  assert.equal(vm.runInContext(`createFriendRequest(friendships, other, me, 't3')`, context), null);
  assert.equal(runJSON(`friendships.length`, context), 1);
});

test('createFriendRequest also blocks a duplicate once the existing friendship is accepted', () => {
  const context = load(() => 'new-id-2');
  const me = ref('g-me', 'דביר');
  const other = ref('g-a', 'עומר');
  const third = ref('g-c', 'יובל');
  vm.runInContext(`
    var me = ${JSON.stringify(me)};
    var other = ${JSON.stringify(other)};
    var third = ${JSON.stringify(third)};
    var friendships = [{ id: 'f1', requester: me, addressee: other, status: 'accepted', createdAt: 't1', respondedAt: 't1b' }];
  `, context);
  assert.equal(vm.runInContext(`createFriendRequest(friendships, me, other, 't2')`, context), null);
  assert.equal(runJSON(`friendships.length`, context), 1);

  // a request to a different, unrelated person still succeeds
  const created = runJSON(`createFriendRequest(friendships, me, third, 't3')`, context);
  assert.equal(created.id, 'new-id-2');
  assert.equal(runJSON(`friendships.length`, context), 2);
});

// ---------- respondToFriendRequest ----------

test('respondToFriendRequest only lets the addressee of a pending request accept or reject it', () => {
  const context = load();
  const me = ref('g-me', 'דביר');
  const other = ref('g-a', 'עומר');
  vm.runInContext(`
    var me = ${JSON.stringify(me)};
    var other = ${JSON.stringify(other)};
    var friendships = [
      { id: 'f1', requester: other, addressee: me, status: 'pending', createdAt: 't1', respondedAt: null },
      { id: 'f2', requester: me, addressee: other, status: 'pending', createdAt: 't2', respondedAt: null },
    ];
  `, context);

  // the requester (not the addressee) may not respond to their own outgoing request
  assert.equal(vm.runInContext(`respondToFriendRequest(friendships, 'f2', me, true, 't3')`, context), false);
  assert.equal(runJSON(`friendships[1].status`, context), 'pending');

  // an unknown id fails
  assert.equal(vm.runInContext(`respondToFriendRequest(friendships, 'nope', me, true, 't3')`, context), false);

  // the addressee accepts
  assert.equal(vm.runInContext(`respondToFriendRequest(friendships, 'f1', me, true, 't4')`, context), true);
  assert.equal(runJSON(`friendships[0].status`, context), 'accepted');
  assert.equal(runJSON(`friendships[0].respondedAt`, context), 't4');

  // already resolved -> responding again fails
  assert.equal(vm.runInContext(`respondToFriendRequest(friendships, 'f1', me, false, 't5')`, context), false);
});

test('respondToFriendRequest can reject a pending request', () => {
  const context = load();
  const me = ref('g-me', 'דביר');
  const other = ref('g-a', 'עומר');
  vm.runInContext(`
    var friendships = [
      { id: 'f1', requester: ${JSON.stringify(other)}, addressee: ${JSON.stringify(me)}, status: 'pending', createdAt: 't1', respondedAt: null },
    ];
  `, context);
  assert.equal(vm.runInContext(`respondToFriendRequest(friendships, 'f1', ${JSON.stringify(me)}, false, 't2')`, context), true);
  assert.equal(runJSON(`friendships[0].status`, context), 'rejected');
  assert.equal(runJSON(`friendships[0].respondedAt`, context), 't2');
});

// ---------- UI wiring ----------

test('friends are a primary screen and are no longer rendered inside profile', () => {
  const nav = html.slice(html.indexOf('<nav class="tabbar'), html.indexOf('</nav>'));
  assert.ok(nav.indexOf('id="modeFriends"') < nav.indexOf('id="modeGames"'));
  assert.ok(nav.indexOf('id="modeGames"') < nav.indexOf('id="modeProfile"'));
  assert.match(html, /id="friendsPage"/);
  assert.match(html, /function renderFriendsPage\(\)/);
  assert.match(html, /box\.hidden = appView !== "friends";/);
  const profileSource = html.slice(html.indexOf('  function renderProfile()'), html.indexOf('  // Shared tail of "add a player'));
  assert.doesNotMatch(profileSource, /renderFriendGroup\(/);
  assert.doesNotMatch(profileSource, /friendRequestsFor\(/);
  // 2026-10-08 thin rings: the empty state states the fact; search and invite are disabled
  // without a session, and ACCOUNT_NOTE says what to do.
  assert.match(html, /אין פוקר בלי חבר'ה/);
  assert.match(html, /"חיפוש לפי שם או מייל"/);
  assert.match(html, /btn\.disabled = !online;/);
  assert.match(html, /btn\.setAttribute\("aria-disabled", online \? "false" : "true"\);/);
  assert.match(html, /el\("p", "friends-note", ACCOUNT_NOTE\)/);
});

test('render routes and controls the standalone friends screen', () => {
  assert.match(html, /document\.body\.classList\.toggle\("friends-view", appView === "friends"\)/);
  assert.match(html, /document\.getElementById\("modeFriends"\)\.classList\.toggle\("on", appView === "friends"\)/);
  assert.match(html, /document\.getElementById\("friendsPage"\)\.hidden = appView !== "friends"/);
  assert.match(html, /document\.getElementById\("settingsBtn"\)\.hidden = appView !== "profile" && appView !== "games" && appView !== "friends"/);
  assert.match(html, /document\.getElementById\("modeFriends"\)\.addEventListener\("click", \(\) => setAppView\("friends"\)\)/);
});

// The pure mutations are now wired to the friends screen, but through exactly one caller each:
// the id/validation rules must stay in the pure functions, not be re-implemented in a handler.
test('createFriendRequest and respondToFriendRequest each have exactly one UI caller', () => {
  const createCalls = html.split('createFriendRequest(').length - 1;
  const respondCalls = html.split('respondToFriendRequest(').length - 1;
  assert.equal(createCalls, 2, 'its definition plus submitFriendRequest');
  assert.equal(respondCalls, 2, 'its definition plus respondToFriend');
  assert.match(html, /if \(!createFriendRequest\(state\.friendships, meRef, toRef, new Date\(\)\.toISOString\(\)\)\)/);
  assert.match(html, /if \(!respondToFriendRequest\(state\.friendships \|\| \[\], id, myFriendRef\(\), accept, new Date\(\)\.toISOString\(\)\)\) return;/);
});

// ---------- thin-rings design (2026-10-08) ----------

const friendsScreenSource = sourceBetween('  function renderFriendRows(', '  function renderProfile()');

test('rows are a 34px avatar ring and a name; the stagger only plays on entering the screen', () => {
  const rows = sourceBetween('  function renderFriendRows(parent, refs, kind, metaLabel, actionsFor, enter)', '  // The inline add-friend panel');
  assert.match(rows, /el\("div", "friend-row is-" \+ kind \+ \(enter \? " anim" : ""\)\)/);
  assert.match(rows, /if \(enter\) row\.style\.animationDelay = \(i \* 45\) \+ "ms";/);
  assert.match(rows, /renderAvatarEl\(cachedAvatar\(ref\.userId\), 34, ref\.displayName \|\| "", ref\.userId \|\| ""\)/);
  assert.match(html, /friendsPageEnterNext = nextView === "friends";/);
  assert.match(html, /\.friend-row \.pavatar-initial \{[^}]*background: transparent;/);
  assert.match(html, /\.friend-row\.is-incoming \.pavatar \{ border-color: var\(--accent\); \}/);
  assert.match(html, /\.friend-row\.is-outgoing \.pavatar \{ border-style: dashed; \}/);
});

test('the empty state mirrors the empty Games screen: heading, two lines, the open-seat scene, a dashed invite over ghosts', () => {
  const empty = sourceBetween('  function renderFriendsEmpty(sec, gate)', '  function renderFriendsList(');
  assert.match(empty, /el\("h2", "friends-title", "אין פוקר בלי חבר'ה"\)/);
  assert.match(empty, /lead\.append\("שלחו קישור לחבר'ה\.", el\("br"\), "הם יופיעו כאן, מוכנים לכל משחק\."\);/);
  const steps = [
    'renderFriendsEmptyHero(wrap);',
    'el("h3", "friends-label", "החברים שלי")',
    'makeFriendInviteBtn("fr-cta", false, online)',
    'renderFriendGhosts(list, me ? 1 : 0, false, 4);',
    'makeFriendSearchBtn("friends-search-link", online, "חיפוש לפי שם או מייל")',
    'renderConnectingSlot(wrap, "friends", "mini", gate);',
  ].map(s => empty.indexOf(s));
  steps.forEach((idx, i) => assert.ok(idx >= 0, `missing step ${i}`));
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] > steps[i - 1], `step ${i} out of order`);
  assert.doesNotMatch(empty, /btn-primary|friends-rings/);
});

test('the open-seat scene: your hand face up, an empty seat dealt two face-down cards, one instance, a still frame for reduced motion', () => {
  const hero = sourceBetween('  // ---------- Friends, empty: an open seat across the table', '  // No friends and no requests:');
  assert.match(hero, /let frHero = null;/);
  assert.match(hero, /stage\.setAttribute\("aria-hidden", "true"\);/);
  assert.doesNotMatch(html, /fr-tag|מקום פנוי/, 'owner: no caption under the scene');
  assert.match(hero, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(hero, /if \(!frAlive\(hero\)\) \{ hero\.running = false; return; \}/);
  assert.match(hero, /const FR_HANDS = \[/);
  assert.match(html, /\.fr-card\.face \{[^}]*background: var\(--card-face\);/);
  assert.match(html, /\.fr-seat\.open \{[^}]*border: 1px dashed var\(--faint\);/);
  assert.match(html, /\.fr-cta \{[^}]*border: 1\.5px dashed var\(--accent\);/);
});

test('the invite action keeps its loading and cached-link labels in both places', () => {
  const label = sourceBetween('  function friendInviteLabel(short)', '  function makeFriendInviteBtn(');
  assert.match(label, /if \(friendInviteSharing\) return "יוצר קישור…";/);
  assert.match(label, /cached \? "\+ שתף קישור" : "\+ הזמן"/);
  assert.match(label, /cached \? "שתף את קישור ההזמנה" : "הזמן את החבר הראשון"/);
});

test('with data: title, incoming requests, the heading with both add actions, then friends, then outgoing', () => {
  const list = sourceBetween('  function renderFriendsList(sec, data, gate, enter)', '  function renderFriendsPage()');
  const steps = [
    'el("h2", "friends-title", "החברים שלך")',
    'renderFriendRows(incomingList, data.incoming.map(f => f.requester), "incoming"',
    'makeFriendSearchBtn("friends-icon-btn", online, "")',
    'makeFriendInviteBtn("friends-invite-link", true, online)',
    'renderFriendRows(list, data.friends, "friend", "", online ? (i =>',
    'renderFriendRows(list, data.outgoing.map(f => f.addressee), "outgoing", "ממתין לאישור"',
    'renderFriendGhosts(list, data.friends.length + data.outgoing.length, enter)',
  ].map(s => list.indexOf(s));
  steps.forEach((idx, i) => assert.ok(idx >= 0, `missing step ${i}`));
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] > steps[i - 1], `step ${i} out of order`);
  assert.match(list, /el\("p", "friends-lead", "מי שמצטרף זמין לכל משחק וקבוצה"\)/);
  assert.match(list, /n === 0 \? "חברים" : n === 1 \? "חבר אחד" : n \+ " חברים"/);
  assert.match(list, /count === 1 \? "בקשה חדשה" : count \+ " בקשות חדשות"/);
});

test('the redesign is presentation only -- no localStorage access on the friends screen', () => {
  assert.doesNotMatch(friendsScreenSource, /localStorage\./);
});

test('every friend is its own card; a short list is topped up to five with fading ghost cards', () => {
  assert.match(html, /\.friends-list \{ display: flex; flex-direction: column; gap: 8px; \}/);
  assert.match(html, /\.friend-row \{[^}]*border: 1px solid var\(--line\); border-radius: 16px;/);
  assert.match(html, /\.friend-row\.is-incoming \{ border-color: var\(--accent\); \}/);
  assert.match(html, /\.friend-ghost \{[^}]*border: 1px dashed var\(--faint\); border-radius: 16px;/);
  const ghosts = sourceBetween('  function renderFriendGhosts(parent, shown, enter, target = FRIEND_GHOST_TARGET) {', '  // The inline add-friend panel');
  assert.match(html, /const FRIEND_GHOST_TARGET = 5;/);
  assert.match(ghosts, /const ghosts = Math\.max\(0, target - shown\);/);
  assert.match(ghosts, /ghost\.setAttribute\("aria-hidden", "true"\);/);
  assert.match(ghosts, /ghost\.style\.opacity = String\(\+\(0\.75 \* \(1 - j \/ ghosts\)\)\.toFixed\(2\)\);/);
});

// ---------- ending a friendship (owner, 2026-10-08) ----------

test('endFriendship lets either party end an accepted friendship, and nothing else', () => {
  const context = load();
  const J = JSON.stringify;
  const me = { userId: 'u-me', guestId: null, displayName: 'דביר' };
  const a = { userId: 'u-a', guestId: null, displayName: 'עומר' };
  const b = { userId: 'u-b', guestId: null, displayName: 'נועה' };
  vm.runInContext(`var fs = [
    { id: 'f1', requester: ${J(me)}, addressee: ${J(a)}, status: 'accepted' },
    { id: 'f2', requester: ${J(b)}, addressee: ${J(me)}, status: 'accepted' },
    { id: 'f3', requester: ${J(me)}, addressee: ${J(b)}, status: 'pending' },
    { id: 'f4', requester: ${J(a)}, addressee: ${J(b)}, status: 'accepted' }
  ];`, context);
  assert.equal(vm.runInContext(`endFriendship(fs, 'f3', ${J(me)})`, context), null, 'a pending request is withdrawn, not ended');
  assert.equal(vm.runInContext(`endFriendship(fs, 'f4', ${J(me)})`, context), null, 'not my friendship');
  assert.equal(vm.runInContext(`endFriendship(fs, 'f2', ${J(me)}).id`, context), 'f2', 'the addressee may end it too');
  assert.equal(vm.runInContext(`endFriendship(fs, 'f1', ${J(me)}).id`, context), 'f1');
  assert.deepEqual(runJSON(`fs.map(f => f.id)`, context), ['f3', 'f4']);
});

test('friendshipIdWith finds the accepted friendship between me and someone, in either direction', () => {
  const context = load();
  const J = JSON.stringify;
  const me = { userId: 'u-me', guestId: null, displayName: 'דביר' };
  const a = { userId: 'u-a', guestId: null, displayName: 'עומר' };
  const b = { userId: 'u-b', guestId: null, displayName: 'נועה' };
  vm.runInContext(`var fs = [
    { id: 'f1', requester: ${J(a)}, addressee: ${J(me)}, status: 'accepted' },
    { id: 'f2', requester: ${J(me)}, addressee: ${J(b)}, status: 'pending' }
  ];`, context);
  assert.equal(vm.runInContext(`friendshipIdWith(fs, ${J(me)}, ${J(a)})`, context), 'f1');
  assert.equal(vm.runInContext(`friendshipIdWith(fs, ${J(me)}, ${J(b)})`, context), null);
});

test('a friend card carries an unfriend button: an icon that arms into a red "בטל חברות" for 4s', () => {
  const list = sourceBetween('  function renderFriendsList(sec, data, gate, enter)', '  function renderFriendsPage()');
  assert.match(list, /renderFriendRows\(list, data\.friends, "friend", "", online \? \(i => \{/);
  assert.match(list, /\{ label: "בטל חברות", danger: true, onClick: \(\) => unfriend\(id\) \}/);
  assert.match(list, /ariaLabel: "בטל חברות עם " \+/);
  const un = sourceBetween('  function armUnfriend(id) {', '  // A row action:');
  assert.match(un, /setTimeout\(\(\) => \{ unfriendArmedId = null; renderFriendsPage\(\); \}, 4000\);/);
  assert.match(un, /if \(!cloudMode\(\)\) return;/);
  assert.match(un, /endFriendship\(state\.friendships \|\| \[\], id, myFriendRef\(\)\)/);
  assert.match(un, /cloudDeleteFriendship\(removed\.id\);/);
  assert.match(html, /\.friend-action\.danger span \{[^}]*border: 1px solid var\(--bad\);/);
  const sql = fs.readFileSync('docs/backend/friendship-unfriend.sql', 'utf8');
  assert.match(sql, /CREATE POLICY friendships_delete_party ON friendships FOR DELETE TO authenticated/);
  assert.match(sql, /status = 'accepted'/);
});

test('the suits mark is set aside, not deleted: out of the layout, its artwork kept for later', () => {
  assert.match(html, /<div class="suits-mark" aria-hidden="true">\s*<img class="suits-mark-dark" src="data:image\/png;base64,/);
  // 2026-10-08: the owner asked for the screens to move up into its 48px, so the row is gone too;
  // the sync dot moved down by the same 48px (-40px -> 8px) to stay in the corner.
  assert.match(html, /\.suits-mark \{ display: none; \}/);
  assert.match(html, /\.dot \{[^}]*position: absolute; top: 8px;/);
  assert.match(html, /\.table-header \{[^}]*margin-top: 20px;/);
});
