# Friends Screen "Thin Rings" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the friends screen to the owner-approved "thin rings" design, and remove the "יעבוד כשהאפליקציה תתחבר לשרת" note from the whole app.

**Architecture:** All runtime code lives in `kupa-sgura.html` (CSS + one vanilla-JS IIFE). The friends screen is rebuilt from small render helpers (`renderFriendRows`, `friendInviteLabel`, `makeFriendInviteBtn`, `makeFriendSearchBtn`, `renderFriendsEmpty`, `renderFriendsList`) called by `renderFriendsPage`. Pure friends functions, sync, state and RPCs are untouched. Tests are Node `node:test` files that assert on source slices (regex), so TDD here means: change the assertions first, watch them fail, then change the source.

**Tech Stack:** Vanilla JS/CSS in one HTML file, `python3 build.py` (generates `index.html`, bumps the `sw.js` cache name), `node --test tests/*.test.cjs`.

Spec: `docs/superpowers/specs/2026-10-08-friends-screen-design.md`

## Global Constraints

- Work in a git worktree on branch `feat/friends-rings` (another session commits to `main` in the main checkout; never edit the main checkout's working tree).
- Edit only `kupa-sgura.html`, tests, `DESIGN.md`, `build.py` (VERSION). Never hand-edit `index.html` or `sw.js`; never touch `poker-settle.html`, `HANDOFF.md`, `privacy.html`, `terms.html`.
- Colours only through CSS variables so dark and light themes both work. No new localStorage keys, no new state.
- Copy, verbatim: "החברים שלך", "מי שמצטרף זמין לכל משחק וקבוצה", "עוד אין חברים", "חברים שמצטרפים דרך קישור זמינים מיד לבחירה בכל משחק וקבוצה.", "בקשה חדשה" / "N בקשות חדשות", "חברים" / "חבר אחד" / "N חברים", "+ הזמן", "+ שתף קישור", "הזמן חבר בקישור", "שתף את קישור ההזמנה", "יוצר קישור…", "חיפוש לפי שם או מייל", "ממתין לאישור", "יש ליצור קודם חשבון", "אין חיבור כרגע, נסו שוב בעוד רגע".
- The string "יעבוד כשהאפליקציה תתחבר לשרת" and the identifier `SERVER_NOTE` must not appear in `kupa-sgura.html` after Task 1.
- Every touch target ≥ 44px. All motion stays under the global `prefers-reduced-motion` rule (no per-component override).

---

### Task 1: Retire SERVER_NOTE app-wide

**Files:**
- Modify: `kupa-sgura.html` (the `SERVER_NOTE` constant; `renderAddMemberPanel`; the invite card; the join notice; `renderFriendsPage`; the `.games-invite-note` CSS rule)
- Test: `tests/design-round.test.cjs`, `tests/join-invite.test.cjs`, `tests/group-members.test.cjs`, `tests/friends.test.cjs`, `tests/friend-requests.test.cjs`

**Interfaces:**
- Produces: `const ACCOUNT_NOTE = "יש ליצור קודם חשבון";` (Task 2 uses it on the friends screen).

- [ ] **Step 1: Rewrite the tests**

In `tests/design-round.test.cjs`, replace the whole test that starts with `test('one shared "יעבוד כשהאפליקציה תתחבר לשרת" constant replaces the four separate wordings'` with:

```js
test('no screen says "יעבוד כשהאפליקציה תתחבר לשרת" -- the app is always connected (owner, 2026-10-08)', () => {
  assert.doesNotMatch(html, /יעבוד כשהאפליקציה תתחבר לשרת/);
  assert.doesNotMatch(html, /SERVER_NOTE/);
  assert.match(html, /const ACCOUNT_NOTE = "יש ליצור קודם חשבון";/);
  // the add-member note and the friends screen are the signed-out gates that read it
  assert.ok((html.match(/ACCOUNT_NOTE/g) || []).length >= 3);
  // the invite card's note is gone, CSS included
  assert.doesNotMatch(html, /games-invite-note/);
  // the older wordings stay gone too
  assert.doesNotMatch(html, /חיבור חשבונות יגיע עם השרת/);
  assert.doesNotMatch(html, /הצטרפות דרך הזמנה תעבוד כשהאפליקציה תתחבר לשרת/);
  assert.doesNotMatch(html, /הצטרפות תעבוד כשהשרת יחובר/);
  assert.doesNotMatch(html, /דורש חיבור לשרת/);
});
```

In `tests/join-invite.test.cjs`, replace the test `test('the notice keeps the offline copy when supabase is missing', ...)` with:

```js
test('with no SDK the notice says the connection is down, never "coming soon"', () => {
  assert.match(joinSource, /if \(!supabase\) \{\n      ui\.note\.textContent = "אין חיבור כרגע, נסו שוב בעוד רגע";/);
  assert.doesNotMatch(joinSource, /SERVER_NOTE/);
});
```

In `tests/group-members.test.cjs`, in the test `renderGroupMembers takes active and former members...`, change the last assertion to:

```js
  assert.match(html, /if \(!cloudMode\(\)\) content\.appendChild\(el\("p", "games-member-add-note", ACCOUNT_NOTE\)\)/);
```

In `tests/friends.test.cjs`, change `assert.match(html, /el\("p", "friend-helper", SERVER_NOTE\)/);` to:

```js
  assert.match(html, /el\("p", "friend-helper", ACCOUNT_NOTE\)/);
```

In `tests/friend-requests.test.cjs`, change `assert.match(page, /if \(!online\) friendsSec\.appendChild\(el\("p", "friend-helper", SERVER_NOTE\)\);/);` to:

```js
  assert.match(page, /if \(!online\) friendsSec\.appendChild\(el\("p", "friend-helper", ACCOUNT_NOTE\)\);/);
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/design-round.test.cjs tests/join-invite.test.cjs tests/group-members.test.cjs tests/friends.test.cjs tests/friend-requests.test.cjs`
Expected: FAIL in exactly the five assertions above (SERVER_NOTE still present).

- [ ] **Step 3: Change the source**

In `kupa-sgura.html`, replace

```js
  // One wording for every "not yet, needs a backend" note (design review, row 22): the invite
  // note, the add-member note, the friends tab helper and the join notice all read this.
  const SERVER_NOTE = "יעבוד כשהאפליקציה תתחבר לשרת";
```

with

```js
  // Signed-out gates say what to do, never "once the server is connected" -- the app is always
  // connected (owner, 2026-10-08). The add-member panel and the friends screen read this.
  const ACCOUNT_NOTE = "יש ליצור קודם חשבון";
```

In `renderAddMemberPanel`, replace `if (!cloudMode()) content.appendChild(el("p", "games-member-add-note", SERVER_NOTE));` with:

```js
    if (!cloudMode()) content.appendChild(el("p", "games-member-add-note", ACCOUNT_NOTE));
```

In the invite card, delete the line:

```js
    if (!supabase) card.appendChild(el("p", "games-invite-note", SERVER_NOTE));
```

and delete its now-unused CSS rule (`.games-invite-note { margin: 0; color: var(--dim); font-size: 12px; font-weight: 300; max-width: 280px; }`).

In the join notice (`// ---------- join by invite ----------` section), replace `ui.note.textContent = SERVER_NOTE;` with:

```js
      ui.note.textContent = "אין חיבור כרגע, נסו שוב בעוד רגע";
```

In `renderFriendsPage`, replace `if (!online) friendsSec.appendChild(el("p", "friend-helper", SERVER_NOTE));` with:

```js
    if (!online) friendsSec.appendChild(el("p", "friend-helper", ACCOUNT_NOTE));
```

- [ ] **Step 4: Run the full suite**

Run: `node --test tests/*.test.cjs`
Expected: all pass. Also `grep -c "SERVER_NOTE\|יעבוד כשהאפליקציה" kupa-sgura.html` prints `0`.

- [ ] **Step 5: Commit**

```bash
git add kupa-sgura.html tests/design-round.test.cjs tests/join-invite.test.cjs tests/group-members.test.cjs tests/friends.test.cjs tests/friend-requests.test.cjs
git commit -m "fix: no note says 'יעבוד כשהאפליקציה תתחבר לשרת' -- signed out reads 'יש ליצור קודם חשבון', a missing SDK says the connection is down"
```

---

### Task 2: The thin-rings friends screen

**Files:**
- Modify: `kupa-sgura.html` (friends CSS block; `:root` avatar vars; the `.friends-page .debt-row .pavatar` rule; `let gamesPageEnterNext` neighbourhood; `setAppView`; `renderFriendGroup` → `renderFriendRows`; `renderAddFriendPanel`; `renderFriendsPage` + new helpers)
- Test: `tests/friends.test.cjs`, `tests/friend-requests.test.cjs`, `tests/profile-avatar.test.cjs`

**Interfaces:**
- Consumes: `ACCOUNT_NOTE` (Task 1); existing `renderAvatarEl(token, size, name, key)`, `cachedAvatar(id)`, `ensureAvatars(ids)`, `friendRequestsFor`, `myFriendRef`, `respondToFriend`, `withdrawFriendRequest`, `shareFriendInvite`, `toggleAddFriendPanel`, `cloudMode`, globals `me`, `authUser`, `addFriendOpen`, `friendInviteSharing`, `friendInviteLinkCache`, `friendInviteShareError`.
- Produces (new functions, in this file order, between `closeAddFriendPanel` and `renderProfile`):
  - `renderFriendRows(parent, refs, kind, metaLabel, actionsFor, enter)` — `kind` ∈ `"incoming" | "friend" | "outgoing"`
  - `renderAddFriendPanel(parent)` (existing, restyled)
  - `friendInviteLabel(short)` → string
  - `makeFriendInviteBtn(cls, short, online)` → `<button>`
  - `makeFriendSearchBtn(cls, online, label)` → `<button>`
  - `renderFriendsEmpty(sec, online)`
  - `renderFriendsList(sec, data, online, enter)`
  - `renderFriendsPage()` (existing, rewritten)
  - `let friendsPageEnterNext` set by `setAppView`

- [ ] **Step 1: Rewrite the tests**

In `tests/friends.test.cjs`:

(a) In the test `friends are a primary screen and are no longer rendered inside profile`, replace everything from the comment `// Design round (row 22): ...` to the end of that test body with:

```js
  // 2026-10-08 thin rings: the empty state states the fact; search and invite are disabled
  // without a session, and ACCOUNT_NOTE says what to do.
  assert.match(html, /עוד אין חברים/);
  assert.match(html, /"חיפוש לפי שם או מייל"/);
  assert.match(html, /btn\.disabled = !online;/);
  assert.match(html, /btn\.setAttribute\("aria-disabled", online \? "false" : "true"\);/);
  assert.match(html, /el\("p", "friends-note", ACCOUNT_NOTE\)/);
```

(b) Replace the line `const friendsPageSource = sourceBetween('  function renderFriendsPage()', '  function renderProfile()');` and every test after it in the file (the `// ---------- empty-state redesign ...` block through the end of the file) with:

```js
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

test('the empty state: decorative rings, a headline, the benefit line, one primary invite, then a quiet search link', () => {
  const empty = sourceBetween('  function renderFriendsEmpty(sec, online)', '  function renderFriendsList(');
  assert.match(empty, /rings\.setAttribute\("aria-hidden", "true"\);/);
  assert.match(empty, /el\("h2", "friends-title", "עוד אין חברים"\)/);
  assert.match(empty, /el\("p", "friends-lead", "חברים שמצטרפים דרך קישור זמינים מיד לבחירה בכל משחק וקבוצה\."\)/);
  const invite = empty.indexOf('makeFriendInviteBtn("btn-primary friends-share-btn", false, online)');
  const search = empty.indexOf('makeFriendSearchBtn("friends-search-link", online, "חיפוש לפי שם או מייל")');
  assert.ok(invite >= 0 && search > invite, 'the primary invite comes first, the search link under it');
  assert.equal((empty.match(/btn-primary/g) || []).length, 1, 'one primary action only');
});

test('the invite action keeps its loading and cached-link labels in both places', () => {
  const label = sourceBetween('  function friendInviteLabel(short)', '  function makeFriendInviteBtn(');
  assert.match(label, /if \(friendInviteSharing\) return "יוצר קישור…";/);
  assert.match(label, /cached \? "\+ שתף קישור" : "\+ הזמן"/);
  assert.match(label, /cached \? "שתף את קישור ההזמנה" : "הזמן חבר בקישור"/);
});

test('with data: title, incoming requests, the heading with both add actions, then friends, then outgoing', () => {
  const list = sourceBetween('  function renderFriendsList(sec, data, online, enter)', '  function renderFriendsPage()');
  const steps = [
    'el("h2", "friends-title", "החברים שלך")',
    'renderFriendRows(sec, data.incoming.map(f => f.requester), "incoming"',
    'makeFriendSearchBtn("friends-icon-btn", online, "")',
    'makeFriendInviteBtn("friends-invite-link", true, online)',
    'renderFriendRows(sec, data.friends, "friend", "", null, enter)',
    'renderFriendRows(sec, data.outgoing.map(f => f.addressee), "outgoing", "ממתין לאישור"',
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
```

In `tests/friend-requests.test.cjs`, in the test `the whole feature is gated by cloudMode()`, replace from the comment `// signed out keeps today's behaviour: disabled button + the shared server note` to the end of the test body with:

```js
  // signed out keeps the screen's shape: faint disabled actions + ACCOUNT_NOTE
  const page = sourceBetween('  function friendInviteLabel(short)', '  function renderProfile()');
  assert.match(page, /const online = cloudMode\(\);/);
  assert.match(page, /btn\.disabled = !online;/);
  assert.match(page, /btn\.disabled = !online \|\| friendInviteSharing;/);
  assert.equal((page.match(/if \(online\) renderAddFriendPanel\((wrap|sec)\);\n\s+else (wrap|sec)\.appendChild\(el\("p", "friends-note", ACCOUNT_NOTE\)\);/g) || []).length, 2);
  // the row actions only exist online
  assert.match(page, /online \? \(i => \{/);
```

In `tests/profile-avatar.test.cjs`, in the test `the friends lists lead every row with an avatar; settings and the profile header open the editor`, replace its first four lines (from `const group = between('  function renderFriendGroup(` through `assert.match(page, /ensureAvatars\(/);`) with:

```js
  const rows = between('  function renderFriendRows(', '  // The inline add-friend panel');
  assert.match(rows, /row\.appendChild\(renderAvatarEl\(cachedAvatar\(ref\.userId\), 34, ref\.displayName \|\| "", ref\.userId \|\| ""\)\);/);
  const page = between('  function renderFriendsList(', '  function renderProfile() {');
  assert.equal((page.match(/renderFriendRows\(sec, /g) || []).length, 3, 'incoming, friends and outgoing all render through renderFriendRows');
  assert.match(page, /ensureAvatars\(/);
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/friends.test.cjs tests/friend-requests.test.cjs tests/profile-avatar.test.cjs`
Expected: FAIL — `missing   function renderFriendRows(` and the other new markers.

- [ ] **Step 3: CSS**

In `kupa-sgura.html`, delete these rules (between `.debt-paid-btn:hover` and `.empty-note`): `.friend-helper`, the `/* Friends screen empty state ... */` comment, `.friends-hero`, the `/* .profile .psection centres ... */` comment, `.friends-page .debt-group`, `.friends-page-title`, `.friends-hero-title`, `.friends-hero-benefit`, the `/* Section rhythm ... */` comment, `.friends-share-btn`, `.friends-add-toggle`, the `/* friend request row actions ... */` comment, `.friend-action` (all four rules) and `.friend-error`. In their place insert:

```css
  /* Friends screen, 2026-10-08 (owner pick "טבעות דקות", 2 of 8 mockups): a centred title and one
     lead line like "השולחנות שלך", then quiet rows -- a 34px avatar ring and a name, no dividers,
     no card. Turquoise marks only what can be acted on: a request waiting on me, "+ הזמן", "אשר".
     No section animation here: the view's .load-in plays on entry, and rows stagger only then. */
  .friends-sec { width: 100%; max-width: 380px; margin: 24px auto 0; text-align: start; }
  .friends-head { text-align: center; margin-bottom: 6px; }
  .friends-title { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.01em; }
  .friends-lead { margin: 6px 0 0; color: var(--dim); font-size: 14px; font-weight: 300; }
  .friends-label-row { display: flex; align-items: center; gap: 2px; min-height: 44px; margin-top: 14px; }
  .friends-label { flex: 1 1 auto; margin: 0; color: var(--dim); font-size: 13px; font-weight: 400; }
  .friends-icon-btn {
    width: 44px; height: 44px; flex: 0 0 auto; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--dim); transition: color .2s, transform .12s ease;
  }
  .friends-icon-btn[aria-expanded="true"] { color: var(--accent); }
  .friends-invite-link {
    flex: 0 0 auto; min-height: 44px; padding: 8px 4px; color: var(--accent);
    font-size: 13px; font-weight: 600; transition: color .2s, transform .12s ease;
  }
  .friends-search-link {
    display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 6px; margin-top: 10px;
    color: var(--dim); font-size: 13px; font-weight: 400; transition: color .2s, transform .12s ease;
  }
  .friends-icon-btn svg, .friends-search-link svg {
    width: 18px; height: 18px; fill: none; stroke: currentColor;
    stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;
  }
  .friends-search-link svg { width: 15px; height: 15px; }
  .friends-icon-btn:disabled, .friends-invite-link:disabled, .friends-search-link:disabled { color: var(--faint); cursor: default; }
  .friends-note { margin: 4px 0 0; color: var(--dim); font-size: 12px; font-weight: 300; text-align: center; animation: fadeIn .25s ease; }
  .friend-row { display: flex; align-items: center; gap: 12px; min-height: 50px; padding: 8px 0; }
  .friend-name { flex: 1 1 auto; min-width: 0; color: var(--text); font-size: 15px; font-weight: 500; overflow-wrap: anywhere; }
  .friend-meta { display: block; color: var(--dim); font-size: 12px; font-weight: 300; }
  .friend-row.is-outgoing .friend-name { color: var(--dim); }
  /* The ring. A friend with no picture gets a thin outline and a light initial; a picture, suit or
     cards keep their own look and only take the ring's edge. Scoped to the row, so the profile and
     settings avatar is untouched -- and patchAvatars() swaps the node inside the row, so a picture
     that arrives later is styled the same way. */
  .friend-row .pavatar { border-color: var(--avatar-ring); }
  .friend-row .pavatar-initial { background: transparent; color: var(--dim); font-weight: 300; }
  .friend-row.is-incoming .pavatar { border-color: var(--accent); }
  .friend-row.is-incoming .pavatar-initial { color: var(--accent); }
  .friend-row.is-outgoing .pavatar { border-style: dashed; }
  /* Row actions keep a full 44px target; "אשר" draws its thin pill on an inner span. */
  .friend-action {
    flex: 0 0 auto; min-height: 44px; padding: 0 4px; color: var(--dim);
    font-size: 13px; font-weight: 500; transition: color .18s ease, transform .12s ease;
  }
  .friend-action:hover { color: var(--text); }
  .friend-action.primary { color: var(--accent); font-weight: 700; }
  .friend-action.primary span { display: inline-block; border: 1px solid var(--accent); border-radius: 999px; padding: 5px 14px; }
  .friend-action:active, .friends-invite-link:active, .friends-icon-btn:active, .friends-search-link:active { transform: scale(.96); }
  .friends-invite-link:disabled:active, .friends-icon-btn:disabled:active, .friends-search-link:disabled:active { transform: none; }
  .friend-error { color: var(--bad); font-size: 13px; font-weight: 500; margin: 0; text-align: center; animation: rise .25s ease both; }
  /* Empty state: three dashed rings stand in for the friends to come -- the row's own ring, not a
     new illustration (decorative, aria-hidden) -- then the page's one primary action. */
  .friends-empty { display: flex; flex-direction: column; align-items: center; text-align: center; }
  .friends-rings { display: flex; justify-content: center; margin: 10px 0 18px; }
  .friends-rings span {
    width: 44px; height: 44px; border-radius: 50%; box-sizing: border-box;
    border: 1px dashed var(--faint); background: var(--bg);
    display: inline-flex; align-items: center; justify-content: center;
  }
  .friends-rings span + span { margin-inline-start: -12px; }
  .friends-rings .is-add { border-color: var(--accent); color: var(--accent); }
  .friends-rings.is-off .is-add { border-color: var(--faint); color: var(--faint); }
  .friends-rings svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
  .friends-empty .friends-lead { max-width: 270px; }
  .friends-empty .btn-primary { align-self: center; margin-top: 22px; }
  .friends-empty .btn-primary:disabled { opacity: 1; }
  /* The search panel reuses .games-create-panel (same 0fr -> 1fr), lighter here: no heading,
     an underline field, then "שלח בקשה" beside "ביטול". */
  .friends-sec .games-create-panel { margin-top: 0; align-self: stretch; }
  .friends-sec .games-create-panel-content { align-items: stretch; gap: 10px; padding: 2px 0 12px; }
  .friends-sec .games-create-panel-content input[type="text"] { text-align: start; }
  .friends-empty .games-create-panel-content input[type="text"] { text-align: center; }
  .friends-panel-actions { display: flex; align-items: center; gap: 16px; }
  .friends-empty .friends-panel-actions { justify-content: center; }
```

Delete the rule `.friends-page .debt-row .pavatar { margin-inline-end: 2px; }`.

In the avatar `:root { --avatar-soft: ...` block add `--avatar-ring: rgba(234,244,244,.16);`, and in the matching `:root[data-theme="light"] { --avatar-soft: ...` block add `--avatar-ring: rgba(12,21,25,.16);`.

- [ ] **Step 4: Enter-only stagger flag**

Right after the `let gamesPageEnterNext = false; ...` declaration (and its two comment lines) add:

```js
  let friendsPageEnterNext = false; // friend rows stagger in on the next renderFriendsPage() -- set only by
                                    // setAppView(), never by an in-place re-render (same as gamesPageEnterNext)
```

In `setAppView`, right after `gamesPageEnterNext = nextView === "games";` add:

```js
    friendsPageEnterNext = nextView === "friends";
```

- [ ] **Step 5: Rows**

Replace the whole `renderFriendGroup` function and its 3-line leading comment (`// Flat .debt-row-style rows for one friends list ...`) with:

```js
  // One friends list as quiet rows: a 34px avatar ring, the name, and (online only) the row's
  // actions. `kind` sets the ring -- "incoming" turquoise (waiting on me), "outgoing" dashed
  // (waiting on them), "friend" plain; the accepted list passes no actions, nothing destructive.
  // `enter` is true only on a fresh navigation into the screen, so opening the search panel or
  // answering a request never replays the stagger (same rule as the dashboard's enterStagger).
  function renderFriendRows(parent, refs, kind, metaLabel, actionsFor, enter) {
    refs.forEach((ref, i) => {
      const row = el("div", "friend-row is-" + kind + (enter ? " anim" : ""));
      if (enter) row.style.animationDelay = (i * 45) + "ms";
      row.appendChild(renderAvatarEl(cachedAvatar(ref.userId), 34, ref.displayName || "", ref.userId || ""));
      const name = el("span", "friend-name", ref.displayName || "משתמש");
      if (metaLabel) name.appendChild(el("span", "friend-meta", metaLabel));
      row.appendChild(name);
      (actionsFor ? actionsFor(i) : []).forEach(action => {
        const btn = el("button", "friend-action" + (action.primary ? " primary" : ""));
        btn.type = "button";
        btn.appendChild(el("span", "", action.label));
        btn.addEventListener("click", action.onClick);
        row.appendChild(btn);
      });
      parent.appendChild(row);
    });
  }
```

- [ ] **Step 6: Lighter search panel**

In `renderAddFriendPanel`, delete `content.appendChild(el("h3", "games-section-title", "חבר חדש"));`, and replace

```js
    content.append(input, submitBtn);
    if (addFriendError) content.appendChild(el("p", "friend-error", addFriendError));
    content.appendChild(cancelBtn);
```

with

```js
    const actions = el("div", "friends-panel-actions");
    actions.append(submitBtn, cancelBtn);
    content.append(input, actions);
    if (addFriendError) content.appendChild(el("p", "friend-error", addFriendError));
```

- [ ] **Step 7: Page**

Replace the whole `renderFriendsPage` function with:

```js
  // The invite action's label. `short` is the list heading's "+ הזמן"; the long form is the empty
  // state's one primary button. Once the link is cached (iOS refused a share sheet that opened
  // after the first await), the label says the next tap shares straight away.
  function friendInviteLabel(short) {
    if (friendInviteSharing) return "יוצר קישור…";
    const cached = !!(friendInviteLinkCache && authUser && friendInviteLinkCache.userId === authUser.id);
    if (short) return cached ? "+ שתף קישור" : "+ הזמן";
    return cached ? "שתף את קישור ההזמנה" : "הזמן חבר בקישור";
  }
  // Primary path: share my personal link -- no lookup, no typed name. The link comes from a
  // server RPC, so without a signed-in session the button stays, faint and disabled.
  function makeFriendInviteBtn(cls, short, online) {
    const btn = el("button", cls, friendInviteLabel(short));
    btn.type = "button";
    btn.disabled = !online || friendInviteSharing;
    btn.setAttribute("aria-disabled", online ? "false" : "true");
    if (online) btn.addEventListener("click", shareFriendInvite);
    return btn;
  }
  // Secondary path: look someone up by exact email or name. In the list heading it is an icon
  // with an aria-label; in the empty state a quiet text link under the primary button.
  function makeFriendSearchBtn(cls, online, label) {
    const btn = el("button", cls);
    btn.type = "button";
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m20 20-4.2-4.2"></path></svg>';
    if (label) btn.appendChild(el("span", "", label));
    else btn.setAttribute("aria-label", "חיפוש לפי שם או מייל");
    btn.disabled = !online;
    btn.setAttribute("aria-disabled", online ? "false" : "true");
    btn.setAttribute("aria-expanded", addFriendOpen ? "true" : "false");
    if (online) btn.addEventListener("click", toggleAddFriendPanel);
    return btn;
  }
  // No friends and no requests: three dashed rings (decorative), a headline, the benefit line,
  // then the page's one primary action and the quieter search link beneath it.
  function renderFriendsEmpty(sec, online) {
    const wrap = el("div", "friends-empty");
    const rings = el("div", "friends-rings" + (online ? "" : " is-off"));
    rings.setAttribute("aria-hidden", "true");
    rings.innerHTML = '<span></span><span></span><span class="is-add"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"></path></svg></span>';
    wrap.appendChild(rings);
    wrap.appendChild(el("h2", "friends-title", "עוד אין חברים"));
    wrap.appendChild(el("p", "friends-lead", "חברים שמצטרפים דרך קישור זמינים מיד לבחירה בכל משחק וקבוצה."));
    if (me) wrap.appendChild(makeFriendInviteBtn("btn-primary friends-share-btn", false, online));
    if (friendInviteShareError) wrap.appendChild(el("p", "friend-error", friendInviteShareError));
    wrap.appendChild(makeFriendSearchBtn("friends-search-link", online, "חיפוש לפי שם או מייל"));
    if (online) renderAddFriendPanel(wrap);
    else wrap.appendChild(el("p", "friends-note", ACCOUNT_NOTE));
    sec.appendChild(wrap);
  }
  // With data: the title, then any request waiting on me (it always needs a decision, so it
  // leads), then the list heading carrying both add actions, then friends, then requests I sent.
  function renderFriendsList(sec, data, online, enter) {
    const head = el("div", "friends-head");
    head.appendChild(el("h2", "friends-title", "החברים שלך"));
    head.appendChild(el("p", "friends-lead", "מי שמצטרף זמין לכל משחק וקבוצה"));
    sec.appendChild(head);
    const count = data.incoming.length;
    if (count) {
      const label = el("div", "friends-label-row");
      label.appendChild(el("h3", "friends-label", count === 1 ? "בקשה חדשה" : count + " בקשות חדשות"));
      sec.appendChild(label);
      renderFriendRows(sec, data.incoming.map(f => f.requester), "incoming", "", online ? (i => {
        const id = data.incoming[i].id;
        return [
          { label: "אשר", primary: true, onClick: () => respondToFriend(id, true) },
          { label: "דחה", onClick: () => respondToFriend(id, false) },
        ];
      }) : null, enter);
    }
    const n = data.friends.length;
    const heading = el("div", "friends-label-row");
    heading.appendChild(el("h3", "friends-label", n === 0 ? "חברים" : n === 1 ? "חבר אחד" : n + " חברים"));
    heading.appendChild(makeFriendSearchBtn("friends-icon-btn", online, ""));
    if (me) heading.appendChild(makeFriendInviteBtn("friends-invite-link", true, online));
    sec.appendChild(heading);
    if (friendInviteShareError) sec.appendChild(el("p", "friend-error", friendInviteShareError));
    if (online) renderAddFriendPanel(sec);
    else sec.appendChild(el("p", "friends-note", ACCOUNT_NOTE));
    renderFriendRows(sec, data.friends, "friend", "", null, enter);
    renderFriendRows(sec, data.outgoing.map(f => f.addressee), "outgoing", "ממתין לאישור", online ? (i => {
      const id = data.outgoing[i].id;
      return [{ label: "בטל", onClick: () => withdrawFriendRequest(id) }];
    }) : null, enter);
    ensureAvatars(data.friends.concat(data.incoming.map(f => f.requester), data.outgoing.map(f => f.addressee))
      .map(ref => ref && ref.userId));
  }

  function renderFriendsPage() {
    const box = document.getElementById("friendsPage");
    box.hidden = appView !== "friends";
    if (appView !== "friends") return;
    const enter = friendsPageEnterNext;
    friendsPageEnterNext = false;
    box.innerHTML = "";
    // Sending, answering and withdrawing all need a session. Without one the screen keeps its
    // shape -- the add actions stay, faint and disabled, above ACCOUNT_NOTE.
    const online = cloudMode();
    const sec = el("section", "friends-sec");
    const friendData = me
      ? friendRequestsFor(state.friendships || [], myFriendRef())
      : { friends: [], incoming: [], outgoing: [] };
    const hasFriendData = friendData.friends.length || friendData.incoming.length || friendData.outgoing.length;
    if (hasFriendData) renderFriendsList(sec, friendData, online, enter);
    else renderFriendsEmpty(sec, online);
    box.appendChild(sec);
  }
```

- [ ] **Step 8: Run the full suite**

Run: `node --test tests/*.test.cjs`
Expected: all pass. Also `grep -n "renderFriendGroup\|friends-hero\|friend-helper\|friends-add-toggle\|friends-page-title" kupa-sgura.html` prints nothing.

- [ ] **Step 9: Commit**

```bash
git add kupa-sgura.html tests/friends.test.cjs tests/friend-requests.test.cjs tests/profile-avatar.test.cjs
git commit -m "style: friends screen as thin rings -- 34px avatar rings, no dividers, search and '+ הזמן' in the list heading, dashed rings for the empty state"
```

---

### Task 3: Docs, build, and a look in the browser

**Files:**
- Modify: `DESIGN.md` (sections "### הוספת חבר", "### בלוק הזמנה", "### מסך חברים ראשי"), `build.py` (VERSION)
- Generated: `index.html`, `sw.js` (by `python3 build.py`)

- [ ] **Step 1: DESIGN.md — add-member and invite notes**

In "### הוספת חבר", replace the sentences from `מתחת לפאנל יושבת ההערה השקטה` through `לא חשבון רשום.` with:

```
בלי חשבון מחובר יושבת מתחת לפאנל הערה שקטה (`.games-member-add-note`, `12px`, `--dim`): "יש ליצור קודם
חשבון" (קבוע `ACCOUNT_NOTE`, משותף למסך החברים). האפליקציה מחוברת תמיד, ולכן אף הערה לא אומרת "יעבוד
כשהאפליקציה תתחבר לשרת" (החלטת הבעלים, 2026-10-08).
```

In "### בלוק הזמנה", replace `— במקומו נשארת רק ההערה השקטה המשותפת `SERVER_NOTE`; QR` with `— ההערה השקטה שהייתה שם הוסרה (2026-10-08); QR`.

- [ ] **Step 2: DESIGN.md — friends screen**

Replace everything from the line `### מסך חברים ראשי` up to (not including) `### תנועה שנוספה (Task 18)` with:

```
### מסך חברים ראשי — "טבעות דקות" (2026-10-08)

היעד הראשי "חברים" (`appView === "friends"`) נמצא בקצה הימני של הניווט התחתון. הבעלים בחר את העיצוב
מתוך שמונה הצעות (גרסה 2, "טבעות דקות"). הכלל: הרבה אוויר, בלי קווי הפרדה ובלי כרטיסים, והטורקיז
מסמן רק דברים שאפשר לעשות (בקשה שמחכה לי, "+ הזמן", "אשר"). spec:
`docs/superpowers/specs/2026-10-08-friends-screen-design.md`.

**עם נתונים** (`renderFriendsList`): כותרת "החברים שלך" ממורכזת (`.friends-title`, `20px/800`, כמו
"השולחנות שלך") ושורת הסבר "מי שמצטרף זמין לכל משחק וקבוצה" (`.friends-lead`, `14px/300`, `--dim`).
אחריהן, לפי הסדר:
- בקשות שהתקבלו, תחת "בקשה חדשה" / "N בקשות חדשות". בקשה תמיד דורשת החלטה, ולכן היא מופיעה ראשונה.
- שורת כותרת הרשימה (`.friends-label-row`): "N חברים" / "חבר אחד" / "חברים". בצד השני שלה כפתור
  זכוכית מגדלת (`.friends-icon-btn`, `44px`, `aria-label`, נצבע טורקיז כשהפאנל פתוח) ו"+ הזמן"
  (`.friends-invite-link`). שתי דרכי ההוספה זמינות בלי לגלול.
- פאנל החיפוש, אם פתוח.
- החברים.
- בקשות שנשלחו.

שורה (`.friend-row`) היא אווטאר של 34px ושם (`15px/500`), בלי מפריד. האווטאר הוא `renderAvatarEl`.
מי שלא בחר תמונה מקבל אות ראשונה דקה (`300`, `--dim`) בטבעת שקופה (`--avatar-ring`). מי שבחר תמונה,
סמל או קלפים מוצג כפי שבחר, בתוך הטבעת. לבקשה נכנסת יש טבעת וטקסט בטורקיז, "אשר" כקפסולה דקה על
`span` פנימי (יעד מגע של `44px`) ו"דחה" כטקסט. לבקשה שנשלחה יש טבעת מקווקוות, שם ב־`--dim`, "ממתין
לאישור" ו"בטל". כל העיצוב הזה מוגבל ל־`.friend-row`, והאווטאר בפרופיל ובהגדרות לא משתנה. השורות
נכנסות בדירוג (`.anim`, `45ms`) רק בכניסה למסך (`friendsPageEnterNext`, נקבע ב־`setAppView`). רינדור
במקום, למשל פתיחת החיפוש או אישור בקשה, לא מריץ את הכניסה מחדש.

**ריק** (`renderFriendsEmpty`):
- שלוש טבעות מקווקוות של `44px`, חופפות (`.friends-rings`). זו קישוט בלבד (`aria-hidden`), אותה טבעת
  כמו בשורה ולא איור חדש. האחרונה בטורקיז עם "+".
- כותרת "עוד אין חברים" ומשפט התועלת.
- הכפתור הראשי היחיד: `.btn-primary` "הזמן חבר בקישור".
- מתחתיו קישור שקט "חיפוש לפי שם או מייל" (`.friends-search-link`).

**תוויות ההזמנה** (`friendInviteLabel`): בזמן יצירה "יוצר קישור…". כשהקישור שמור (iOS סירב לגיליון
שיתוף שנפתח אחרי await) "+ שתף קישור" / "שתף את קישור ההזמנה", כדי שהלחיצה הבאה תשתף מיד.

**פאנל החיפוש** הוא `games-create-panel` הקיים (`0fr → 1fr`), בגרסה קלה: בלי כותרת, שדה עם קו תחתון
שעובר ל־`dir="ltr"` כשמופיע `@`, ו"שלח בקשה" ליד "ביטול" (`.friends-panel-actions`). השגיאות עוברות
כולן דרך `friendRequestError(kind)`, כמו קודם.

**בלי חשבון** (`!cloudMode()`): אותו מבנה. הפעולות מוצגות ב־`--faint` וחסומות (`disabled` +
`aria-disabled`), גם הכפתור הראשי (בלי opacity). מתחתן מופיעה ההערה "יש ליצור קודם חשבון"
(`.friends-note`, `ACCOUNT_NOTE`). לבקשות אין כפתורי פעולה.

המסך לא מציג לעולם מייל של אדם אחר, רווח, הפסד או חוב.
```

- [ ] **Step 3: Version + build**

Run: `grep -n "^VERSION" build.py` and set `VERSION` to the printed number + 1. Then:

```bash
python3 build.py
node --test tests/*.test.cjs
git diff --check
```

Expected: build prints the new version; all tests pass; `git diff --check` prints nothing.

- [ ] **Step 4: Look at it**

Serve the worktree (`python3 -m http.server <free port> --bind 127.0.0.1` from the worktree root, started through the preview tool), open `index.html` at 375×812, continue with a local name, and seed demo data from the console:

```js
const s = JSON.parse(localStorage.getItem('poker-settle-v1') || '{}');
const me = { userId: null, guestId: 'gme', displayName: localStorage.getItem('poker-settle-me') };
const p = n => ({ userId: null, guestId: null, displayName: n });
const at = new Date().toISOString();
s.dataEpoch = 99; s.players = s.players || []; s.debts = s.debts || [];
s.history = [{ id: 'h1', at, players: [{ name: me.displayName, guestId: 'gme', net: 0, buyin: 0, cashout: 0 }] }];
s.friendships = [
  { id: 'f1', requester: me, addressee: p('יוסי כהן'), status: 'accepted', createdAt: at, respondedAt: at },
  { id: 'f2', requester: p('מיכל'), addressee: me, status: 'accepted', createdAt: at, respondedAt: at },
  { id: 'f3', requester: p('נועם'), addressee: me, status: 'pending', createdAt: at, respondedAt: null },
  { id: 'f4', requester: me, addressee: p('שירה'), status: 'pending', createdAt: at, respondedAt: null },
];
localStorage.setItem('poker-settle-v1', JSON.stringify(s)); location.reload();
```

Check, with screenshots: the populated screen and the empty screen (clear `friendships`), dark and light theme. Compare with the spec mockups. Fix anything off in CSS only, re-run the suite.

- [ ] **Step 5: Commit**

```bash
git add DESIGN.md build.py index.html sw.js
git commit -m "docs+build: friends screen thin rings in DESIGN.md; ACCOUNT_NOTE replaces SERVER_NOTE"
```

- [ ] **Step 6: Land**

Rebase the branch onto the current `main`. If `build.py`/`index.html`/`sw.js` conflict, take `main`'s side, set `VERSION` to `main`'s + 1, rerun `python3 build.py` and the suite, then commit. From the main checkout, run `git merge --ff-only feat/friends-rings`. Push (`git push origin main`) only after the owner says so.
