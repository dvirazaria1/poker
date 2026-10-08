# Connecting Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "not connected yet" notes with a mini hold'em hand while the backend connects, and show "יש ליצור קודם חשבון" only when the server is up and nobody is signed in.

**Architecture:** A pure `connectionGate(hasClient, sessionChecked, hasUser)` decides `"connecting" | "signedOut" | "online"`; `gateNow()` feeds it the live `supabase`, a new `authSessionChecked` flag (set when the first `getSession()` answers) and `authUser`. A self-contained "connecting game" section renders one persistent instance per surface (`renderConnectingSlot(parent, key, kind, gate)`) using the Web Animations API, and folds it away when the gate leaves "connecting". Six surfaces call it.

**Tech Stack:** Vanilla JS/CSS in `kupa-sgura.html`; `node --test`; `python3 build.py`.

Spec: `docs/superpowers/specs/2026-10-08-connecting-game-design.md`

## Global Constraints

- Work in worktree `../פוקר-connecting` on branch `feat/connecting-game`. Never edit the main checkout's working tree.
- Copy, verbatim: "מערבבים", "מחלקים", "פלופ", "פותחים קלפים", "רגע, מתחברים", "אין חיבור לאינטרנט", "מתחברים לשרת", "יש ליצור קודם חשבון".
- Colours only through CSS variables. No new localStorage keys. `cloudMode()` unchanged.
- WAAPI ignores the global reduced-motion CSS rule: the JS must check `matchMedia("(prefers-reduced-motion: reduce)")` itself.
- "קישור חברים דורש חיבור לחשבון", "אין חיבור כרגע, נסו שוב בעוד רגע" and "יעבוד כשהאפליקציה תתחבר לשרת" must not appear in `kupa-sgura.html`.

---

### Task 1: Gate + game + every surface

**Files:**
- Modify: `kupa-sgura.html`
- Create: `tests/connecting-game.test.cjs`
- Modify tests: `tests/friends.test.cjs`, `tests/friend-requests.test.cjs`, `tests/group-members.test.cjs`, `tests/join-invite.test.cjs`, `tests/auth-session-hardening.test.cjs`

**Interfaces:**
- Produces: `connectionGate(hasClient, sessionChecked, hasUser)`, `gateNow()`, `let authSessionChecked`, `refreshAfterSessionCheck()`, `renderConnectingSlot(parent, key, kind, gate)` with `kind` ∈ `"full" | "mini"`.
- Changes signatures: `renderFriendsEmpty(sec, gate)`, `renderFriendsList(sec, data, gate, enter)`.

- [ ] **Step 1: Tests first.** Create `tests/connecting-game.test.cjs`:

```js
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
const gateSource = sourceBetween('  // ---------- connection gate (pure) ----------', '  // ---------- friends (pure) ----------');
const game = sourceBetween('  // ---------- connecting game ----------', '  // ---------- join by invite ----------');

test('connectionGate: no client or an unanswered session read is "connecting"; a user is "online"', () => {
  const context = vm.createContext({});
  vm.runInContext(gateSource, context);
  const gate = (...a) => vm.runInContext(`connectionGate(${a.map(String).join(',')})`, context);
  assert.equal(gate(false, false, false), 'connecting');
  assert.equal(gate(false, true, false), 'connecting');
  assert.equal(gate(true, false, false), 'connecting');
  assert.equal(gate(true, true, false), 'signedOut');
  assert.equal(gate(true, false, true), 'online');
  assert.equal(gate(true, true, true), 'online');
});

test('the UI reads the gate from the live client, the first session answer and the user', () => {
  assert.match(html, /function gateNow\(\) \{ return connectionGate\(!!supabase, authSessionChecked, !!authUser\); \}/);
  assert.match(html, /let authSessionChecked = false;/);
  const init = sourceBetween('  function initAuth() {', '  // Profile-failure line');
  assert.equal((init.match(/authSessionChecked = true;/g) || []).length, 2, 'answered and failed reads both end "connecting"');
  assert.equal((init.match(/refreshAfterSessionCheck\(\);/g) || []).length, 2);
  assert.match(html, /function refreshAfterSessionCheck\(\) \{ if \(!authUser\) \{ render\(\); refreshInviteNotices\(\); \} \}/);
});

test('the hand: riffle, deal two to four seats, flop, show, gather -- and the caption follows', () => {
  ['"מערבבים"', '"מחלקים"', '"פלופ"', '"פותחים קלפים"', '"רגע, מתחברים"'].forEach(s => assert.ok(game.includes('dealSay(slot, ' + s + ')'), s));
  assert.match(game, /navigator\.onLine === false \? "אין חיבור לאינטרנט" : text/);
  assert.match(game, /const DEAL_SEATS = \[\[-86, -26\], \[-30, -36\], \[30, -36\], \[86, -26\]\];/);
  assert.match(game, /node\.setAttribute\("role", "status"\);/);
  assert.match(game, /node\.setAttribute\("aria-label", "מתחברים לשרת"\);/);
  assert.match(game, /cap\.setAttribute\("aria-hidden", "true"\);/);
});

test('reduced motion shows a still table -- the Web Animations ignore the global CSS rule', () => {
  assert.match(game, /function dealStill\(\) \{ return matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches; \}/);
  assert.match(game, /if \(dealStill\(\)\) \{ dealStillFrame\(slot\); return; \}/);
});

test('one instance per surface survives re-renders; leaving gathers, folds and removes it', () => {
  assert.match(game, /const connectingSlots = new Map\(\);/);
  assert.match(game, /parent\.appendChild\(slot\.node\);\n    slot\.shownAt = performance\.now\(\);\n    if \(!slot\.running\) runConnectingSlot\(slot\);/);
  assert.match(game, /if \(!slot\.leaving\) leaveConnectingSlot\(key, slot\);/);
  const leave = sourceBetween('  async function leaveConnectingSlot(key, slot) {', '  function renderConnectingSlot(');
  assert.match(leave, /await dealGather\(/);
  assert.match(leave, /height: "0px"/);
  assert.match(leave, /slot\.node\.remove\(\);/);
});

test('every surface: connecting shows the game, signed out shows the account note', () => {
  assert.match(html, /renderConnectingSlot\(wrap, "friends", "full", gate\);\n    if \(gate === "signedOut"\) wrap\.appendChild\(el\("p", "friends-note", ACCOUNT_NOTE\)\);/);
  assert.match(html, /renderConnectingSlot\(sec, "friends-list", "mini", gate\);\n    if \(gate === "signedOut"\) sec\.appendChild\(el\("p", "friends-note", ACCOUNT_NOTE\)\);/);
  assert.match(html, /renderConnectingSlot\(content, "group-add", "mini", gate\);\n    if \(gate === "signedOut"\) content\.appendChild\(el\("p", "games-member-add-note", ACCOUNT_NOTE\)\);/);
  assert.match(html, /if \(qr\) card\.appendChild\(qr\);\n    renderConnectingSlot\(card, "group-invite", "mini", gateNow\(\)\);/);
  assert.match(html, /renderConnectingSlot\(ui\.connecting, "join", "full", gate\);/);
  assert.match(html, /renderConnectingSlot\(ui\.connecting, "friend-notice", "full", gate\);/);
  assert.match(html, /<div id="joinNoticeConnecting"><\/div>/);
  assert.match(html, /<div id="friendNoticeConnecting"><\/div>/);
  assert.doesNotMatch(html, /קישור חברים דורש חיבור לחשבון/);
  assert.doesNotMatch(html, /אין חיבור כרגע, נסו שוב בעוד רגע/);
  assert.doesNotMatch(html, /יעבוד כשהאפליקציה תתחבר לשרת/);
});

test('cards draw only from tokens, so both themes work', () => {
  assert.match(html, /\.deal-card \{[^}]*border: 1px solid var\(--accent\);[^}]*var\(--deal-stripe\)/);
  assert.match(html, /\.deal-card\.face \{ background: var\(--card-face\); border-color: var\(--card-back\); \}/);
  assert.match(html, /--deal-stripe: rgba\(53,224,220,\.28\);/);
  assert.match(html, /--deal-stripe: rgba\(8,158,152,\.30\);/);
});
```

Append to `tests/auth-session-hardening.test.cjs`:

```js
test('initAuth marks the first session read as answered, so "connecting" can end', async () => {
  const env = makeEnv();
  assert.equal(env.get('authSessionChecked'), false);
  env.get('initAuth')();
  await new Promise(r => setImmediate(r));
  assert.equal(env.get('authSessionChecked'), true);
});
```

and in the same file change `if \(!supabase\) joinNoticeParts\(\)\.notice\.hidden = true;` in the regex to `if \(gateNow\(\) === "connecting"\) joinNoticeParts\(\)\.notice\.hidden = true;`.

In `tests/join-invite.test.cjs`, replace the test `with no SDK the notice says the connection is down, never "coming soon"` with:

```js
test('while connecting the notice shows the game and keeps the token; never "coming soon"', () => {
  assert.match(joinSource, /if \(gate === "connecting"\) \{\n      ui\.note\.textContent = "";\n      ui\.joinBtn\.hidden = true;\n      ui\.continueBtn\.hidden = false;/);
  assert.doesNotMatch(joinSource, /SERVER_NOTE/);
});
```

In `tests/group-members.test.cjs` change the add-member assertion to:

```js
  assert.match(html, /renderConnectingSlot\(content, "group-add", "mini", gate\);\n    if \(gate === "signedOut"\) content\.appendChild\(el\("p", "games-member-add-note", ACCOUNT_NOTE\)\);/);
```

In `tests/friends.test.cjs` change the markers `'  function renderFriendsEmpty(sec, online)'` → `'  function renderFriendsEmpty(sec, gate)'` and `'  function renderFriendsList(sec, data, online, enter)'` → `'  function renderFriendsList(sec, data, gate, enter)'`.

In `tests/friend-requests.test.cjs`, in `the whole feature is gated by cloudMode()`, replace `assert.match(page, /const online = cloudMode\(\);/);` with

```js
  assert.match(page, /const gate = gateNow\(\);/);
  assert.equal((page.match(/const online = gate === "online";/g) || []).length, 2);
```

and replace the `assert.equal((page.match(/if \(online\) renderAddFriendPanel...` line with

```js
  assert.equal((page.match(/if \(online\) renderAddFriendPanel\((wrap|sec)\);\n\s+renderConnectingSlot\((wrap|sec), "friends(-list)?", "(full|mini)", gate\);\n\s+if \(gate === "signedOut"\) (wrap|sec)\.appendChild\(el\("p", "friends-note", ACCOUNT_NOTE\)\);/g) || []).length, 2);
```

- [ ] **Step 2:** `node --test tests/*.test.cjs` → the new and changed assertions fail.

- [ ] **Step 3: Gate.** Right before `  // ---------- friends (pure) ----------` insert:

```js
  // ---------- connection gate (pure) ----------
  // Which of three states a server-backed control is in (2026-10-08). "connecting": the SDK has not
  // loaded, or it has but the first session read has not answered -- no user is not yet "signed
  // out", so a signed-in person never sees the account note flash. "online" as soon as a user is
  // known. Spec: docs/superpowers/specs/2026-10-08-connecting-game-design.md
  function connectionGate(hasClient, sessionChecked, hasUser) {
    if (!hasClient) return "connecting";
    if (hasUser) return "online";
    return sessionChecked ? "signedOut" : "connecting";
  }

```

After `function cloudMode() { return !!(supabase && authUser); }` add:

```js
  function gateNow() { return connectionGate(!!supabase, authSessionChecked, !!authUser); }
```

After `let authResendUntil = 0;` add:

```js
  let authSessionChecked = false; // the first getSession() answered -- ends "connecting" (connectionGate)
```

Replace `initAuth` with:

```js
  // With no session nothing else re-renders, so the screens leave "connecting" here.
  function refreshAfterSessionCheck() { if (!authUser) { render(); refreshInviteNotices(); } }
  function initAuth() {
    if (!supabase) return;
    supabase.auth.getSession().then(async ({ data, error }) => {
      authSessionChecked = true;
      if (error) { if (isInvalidSessionError(error)) await applySession(null); }
      else await applySession(data && data.session);
      refreshAfterSessionCheck();
    }).catch(() => { authSessionChecked = true; refreshAfterSessionCheck(); });
    supabase.auth.onAuthStateChange((event, session) => { applySession(session); });
  }
```

- [ ] **Step 4: Game.** Right before `  // ---------- join by invite ----------` insert:

```js
  // ---------- connecting game ----------
  // The "connecting" state of every server-backed control (owner pick, 2026-10-08): instead of a
  // loading label, a tiny hold'em hand plays out -- riffle, two cards to each of four seats, the
  // flop, the hands shown -- and the caption follows the hand. "mini" is the riffle alone beside
  // "רגע, מתחברים". One instance per surface key: renderConnectingSlot re-appends the same node on
  // every render and the Web Animations keep running, so a render never restarts the hand. Once the
  // gate leaves "connecting" the cards gather, the slot folds and removes itself; the real controls
  // are live already. Spec: docs/superpowers/specs/2026-10-08-connecting-game-design.md
  const connectingSlots = new Map(); // key -> { node, kind, stage, cap, cards, running, leaving, shownAt }
  const DEAL_SUITS = [["♠︎", false], ["♥︎", true], ["♣︎", false], ["♦︎", true]];
  const DEAL_DECK = [0, 42];
  const DEAL_SEATS = [[-86, -26], [-30, -36], [30, -36], [86, -26]];
  const DEAL_FLOP = [[24, 6], [0, 6], [-24, 6]];
  function dealStill() { return matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function dealT(x, y, r, s, ry) {
    return "translate(" + x + "px," + y + "px) rotate(" + (r || 0) + "deg)" +
      (ry != null ? " rotateY(" + ry + "deg)" : "") + " scale(" + (s == null ? 1 : s) + ")";
  }
  // A cancelled animation rejects `finished`; the hand simply moves on.
  function dealMove(target, frames, opts) {
    const o = opts || {};
    return target.animate(frames, {
      duration: o.d || 300, delay: o.delay || 0, easing: o.e || "cubic-bezier(.2,.8,.2,1)", fill: "forwards",
    }).finished.catch(() => {});
  }
  function dealWait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function dealCard(stage) { const card = el("span", "deal-card"); stage.appendChild(card); return card; }
  function dealPlace(card, x, y, r, opacity) {
    card.getAnimations().forEach(a => a.cancel());
    card.style.transform = dealT(x, y, r);
    card.style.opacity = String(opacity);
  }
  function dealFace(card, suit) { card.classList.add("face"); card.classList.toggle("red", suit[1]); card.textContent = suit[0]; }
  function dealBack(card) { card.classList.remove("face", "red", "win"); card.textContent = ""; }
  function dealRandomSuit() { return DEAL_SUITS[Math.floor(Math.random() * DEAL_SUITS.length)]; }
  function dealHolePos(i) {
    const s = DEAL_SEATS[i % 4], second = i >= 4;
    return [s[0] + (second ? 5 : -4), s[1] + (second ? 1 : 0), second ? 8 : -7];
  }
  function dealHalf(i, deck, spread) {
    const left = i < 3, k = i % 3;
    return [deck[0] + (left ? -spread : spread), deck[1] - 4 - k * 1.5, left ? -13 : 13];
  }
  function slotAlive(slot) { return !slot.leaving && slot.node.isConnected && slot.node.getClientRects().length > 0; }
  async function dealSay(slot, text) {
    const t = navigator.onLine === false ? "אין חיבור לאינטרנט" : text;
    if (slot.cap.textContent === t) return;
    await dealMove(slot.cap, [{ opacity: 1 }, { opacity: 0 }], { d: 120 });
    slot.cap.textContent = t;
    await dealMove(slot.cap, [{ opacity: 0 }, { opacity: 1 }], { d: 180 });
  }
  function dealGather(cards, deck) {
    return Promise.all(cards.map((card, i) => dealMove(card, [
      { transform: getComputedStyle(card).transform, opacity: getComputedStyle(card).opacity },
      { transform: dealT(deck[0], deck[1], 0), opacity: 0 },
    ], { d: 300, delay: i * 24, e: "cubic-bezier(.6,0,.3,1)" })));
  }
  async function dealTurn(card, x, y, r, suit) {
    await dealMove(card, [{ transform: dealT(x, y, r, 1, 0) }, { transform: dealT(x, y - 2, r, 1.1, 90) }], { d: 120, e: "ease-in" });
    dealFace(card, suit);
    await dealMove(card, [{ transform: dealT(x, y - 2, r, 1.1, -90) }, { transform: dealT(x, y, r, 1, 0) }], { d: 150, e: "ease-out" });
  }
  // Split, interleave, square. Returns whether the slot is still worth animating.
  async function dealRiffle(slot, deck, spread) {
    const r = slot.cards.riffle;
    r.forEach((card, i) => { dealPlace(card, deck[0], deck[1] - i * 0.6, 0, 1); card.style.zIndex = String(i); });
    await Promise.all(r.map((card, i) => {
      const h = dealHalf(i, deck, spread);
      card.style.zIndex = String(i % 3);
      return dealMove(card, [{ transform: dealT(deck[0], deck[1] - i * 0.6, 0) }, { transform: dealT(h[0], h[1], h[2]) }], { delay: (i % 3) * 40 });
    }));
    if (!slotAlive(slot)) return false;
    await dealWait(160);
    const order = [0, 3, 1, 4, 2, 5];
    for (let k = 0; k < order.length; k++) {
      const i = order[k], h = dealHalf(i, deck, spread);
      r[i].style.zIndex = String(10 + k);
      dealMove(r[i], [{ transform: dealT(h[0], h[1], h[2]) }, { transform: dealT(deck[0], deck[1] - k * 1.1, 0) }], { d: 190, e: "cubic-bezier(.5,0,.3,1)" });
      await dealWait(95);
    }
    await dealWait(220);
    await Promise.all(r.map(card => dealMove(card, [
      { transform: getComputedStyle(card).transform },
      { transform: dealT(deck[0], deck[1] - 2, 0, 1.06) },
      { transform: dealT(deck[0], deck[1], 0) },
    ], { d: 220 })));
    return slotAlive(slot);
  }
  async function runDealerHand(slot) {
    const c = slot.cards, deck = DEAL_DECK;
    for (;;) {
      c.hole.concat(c.flop).forEach(card => { dealBack(card); dealPlace(card, deck[0], deck[1], 0, 0); card.style.zIndex = ""; });
      c.base.forEach(card => dealPlace(card, deck[0], deck[1], 0, 0));
      dealSay(slot, "מערבבים");
      if (!(await dealRiffle(slot, deck, 17))) return;
      c.base.forEach((card, k) => dealPlace(card, deck[0], deck[1] - k, 0, 1));
      c.riffle.forEach(card => dealPlace(card, deck[0], deck[1], 0, 0));
      dealSay(slot, "מחלקים");
      for (let i = 0; i < 8; i++) {
        const p = dealHolePos(i);
        c.hole[i].style.zIndex = String(20 + i);
        dealMove(c.hole[i], [
          { transform: dealT(deck[0], deck[1], 0), opacity: 1 },
          { transform: dealT(p[0], p[1], p[2] + (p[0] < 0 ? -360 : 360)), opacity: 1 },
        ], { d: 320, e: "cubic-bezier(.15,.75,.25,1)" });
        await dealWait(125);
      }
      await dealWait(420);
      if (!slotAlive(slot)) return;
      dealSay(slot, "פלופ");
      for (let f = 0; f < 3; f++) {
        c.flop[f].style.zIndex = String(40 + f);
        dealMove(c.flop[f], [{ transform: dealT(deck[0], deck[1], 0), opacity: 1 }, { transform: dealT(DEAL_FLOP[f][0], DEAL_FLOP[f][1], 0), opacity: 1 }]);
        await dealWait(150);
      }
      await dealWait(380);
      for (let f = 0; f < 3; f++) { await dealTurn(c.flop[f], DEAL_FLOP[f][0], DEAL_FLOP[f][1], 0, dealRandomSuit()); await dealWait(70); }
      await dealWait(500);
      if (!slotAlive(slot)) return;
      dealSay(slot, "פותחים קלפים");
      for (let s = 0; s < 4; s++) {
        const a = dealHolePos(s), b = dealHolePos(s + 4);
        dealTurn(c.hole[s], a[0], a[1], a[2], dealRandomSuit());
        await dealTurn(c.hole[s + 4], b[0], b[1], b[2], dealRandomSuit());
        await dealWait(110);
      }
      const w = Math.floor(Math.random() * 4);
      [w, w + 4].forEach(i => {
        const p = dealHolePos(i);
        c.hole[i].classList.add("win");
        dealMove(c.hole[i], [{ transform: dealT(p[0], p[1], p[2]) }, { transform: dealT(p[0], p[1] - 4, p[2], 1.08) }], { d: 260 });
      });
      await dealWait(1100);
      if (!slotAlive(slot)) return;
      dealSay(slot, "רגע, מתחברים");
      await dealGather(c.hole.concat(c.flop), deck);
      await dealWait(250);
      if (!slotAlive(slot)) return;
    }
  }
  async function runMiniRiffle(slot) {
    for (;;) {
      dealSay(slot, "רגע, מתחברים");
      if (!(await dealRiffle(slot, [0, 0], 9))) return;
      await dealWait(350);
      if (!slotAlive(slot)) return;
    }
  }
  function dealStillFrame(slot) {
    const c = slot.cards;
    if (slot.kind === "mini") { c.riffle.forEach((card, i) => dealPlace(card, 0, -i * 0.8, 0, 1)); return; }
    c.base.forEach((card, k) => dealPlace(card, DEAL_DECK[0], DEAL_DECK[1] - k, 0, 1));
    c.hole.forEach((card, i) => { const p = dealHolePos(i); dealPlace(card, p[0], p[1], p[2], 1); });
    c.flop.forEach((card, i) => { dealFace(card, DEAL_SUITS[i]); dealPlace(card, DEAL_FLOP[i][0], DEAL_FLOP[i][1], 0, 1); });
  }
  function buildConnectingSlot(kind) {
    const node = el("div", "connecting " + kind);
    node.setAttribute("role", "status");
    node.setAttribute("aria-label", "מתחברים לשרת");
    const stage = el("div", "connecting-stage");
    stage.setAttribute("aria-hidden", "true");
    const cap = el("span", "connecting-cap", "רגע, מתחברים");
    cap.setAttribute("aria-hidden", "true");
    node.append(stage, cap);
    const slot = { node, kind, stage, cap, cards: {}, running: false, leaving: false, shownAt: 0 };
    if (kind === "full") {
      DEAL_SEATS.forEach(s => {
        const seat = el("span", "deal-seat");
        seat.style.transform = "translate(" + s[0] + "px," + (s[1] - 20) + "px)";
        stage.appendChild(seat);
      });
      slot.cards.base = [dealCard(stage), dealCard(stage)];
      slot.cards.riffle = Array.from({ length: 6 }, () => dealCard(stage));
      slot.cards.hole = Array.from({ length: 8 }, () => dealCard(stage));
      slot.cards.flop = Array.from({ length: 3 }, () => dealCard(stage));
    } else {
      slot.cards.riffle = Array.from({ length: 6 }, () => dealCard(stage));
    }
    return slot;
  }
  function runConnectingSlot(slot) {
    if (dealStill()) { dealStillFrame(slot); return; }
    slot.running = true;
    (slot.kind === "full" ? runDealerHand : runMiniRiffle)(slot).catch(() => {}).then(() => { slot.running = false; });
  }
  async function leaveConnectingSlot(key, slot) {
    slot.leaving = true;
    if (!dealStill() && slot.node.isConnected) {
      const deck = slot.kind === "full" ? DEAL_DECK : [0, 0];
      await dealGather(Object.values(slot.cards).flat(), deck);
      const cs = getComputedStyle(slot.node);
      await dealMove(slot.node, [
        { height: slot.node.offsetHeight + "px", marginTop: cs.marginTop, marginBottom: cs.marginBottom, opacity: 1 },
        { height: "0px", marginTop: "0px", marginBottom: "0px", opacity: 0 },
      ], { d: 260, e: "ease-in-out" });
    }
    slot.node.remove();
    if (connectingSlots.get(key) === slot) connectingSlots.delete(key);
  }
  // Called by each surface on every render. A slot last shown more than 1.5s ago is stale (its
  // screen was left while connecting): it goes without a fold.
  function renderConnectingSlot(parent, key, kind, gate) {
    let slot = connectingSlots.get(key);
    if (gate !== "connecting") {
      if (!slot) return;
      if (!slot.leaving && performance.now() - slot.shownAt > 1500) { connectingSlots.delete(key); slot.node.remove(); return; }
      parent.appendChild(slot.node);
      if (!slot.leaving) leaveConnectingSlot(key, slot);
      return;
    }
    if (!slot || slot.leaving) {
      if (slot) slot.node.remove();
      slot = buildConnectingSlot(kind);
      connectingSlots.set(key, slot);
    }
    parent.appendChild(slot.node);
    slot.shownAt = performance.now();
    if (!slot.running) runConnectingSlot(slot);
  }

```

- [ ] **Step 5: CSS.** After the rule `.friends-empty .friends-panel-actions { justify-content: center; }` add:

```css
  /* Connecting (2026-10-08): a tiny hold'em hand while the server connects -- renderConnectingSlot.
     The cards move by Web Animations; reduced motion gets a still table from the JS. */
  .connecting { display: flex; flex-direction: column; align-items: center; overflow: hidden; }
  .connecting.full { margin-top: 18px; }
  .connecting.mini { flex-direction: row; justify-content: center; gap: 10px; margin: 6px 0 4px; min-height: 30px; }
  .connecting-stage { position: relative; flex: 0 0 auto; }
  .connecting.full .connecting-stage { width: 236px; height: 112px; }
  .connecting.mini .connecting-stage { width: 34px; height: 24px; }
  .connecting-cap { margin-top: 6px; min-height: 18px; color: var(--dim); font-size: 12px; font-weight: 300; }
  .connecting.mini .connecting-cap { margin-top: 0; }
  .deal-card {
    position: absolute; left: 50%; top: 50%; width: 13px; height: 18px; margin: -9px 0 0 -6.5px;
    box-sizing: border-box; border-radius: 2px; border: 1px solid var(--accent);
    background: var(--bg) repeating-linear-gradient(45deg, var(--deal-stripe) 0 1.5px, transparent 1.5px 3.5px);
    display: flex; align-items: center; justify-content: center; opacity: 0; color: var(--card-ink);
    font-family: "Segoe UI Symbol", "Apple Symbols", sans-serif; font-size: 10px; line-height: 1;
  }
  .connecting.mini .deal-card { width: 9px; height: 13px; margin: -6.5px 0 0 -4.5px; }
  .deal-card.face { background: var(--card-face); border-color: var(--card-back); }
  .deal-card.red { color: var(--card-red); }
  .deal-card.win { box-shadow: 0 0 0 1px var(--accent), 0 0 8px var(--avatar-tint-edge); }
  .deal-seat {
    position: absolute; left: 50%; top: 50%; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px;
    box-sizing: border-box; border-radius: 50%; border: 1px solid var(--avatar-ring);
  }
```

In the avatar `:root` block add `--deal-stripe: rgba(53,224,220,.28);` after `--avatar-ring: rgba(234,244,244,.16);`, and in the light block add `--deal-stripe: rgba(8,158,152,.30);` after `--avatar-ring: rgba(12,21,25,.16);`.

- [ ] **Step 6: Surfaces.**

Friends — in `renderFriendsPage` replace `const online = cloudMode();` with `const gate = gateNow();`, and the two calls with `renderFriendsList(sec, friendData, gate, enter)` / `renderFriendsEmpty(sec, gate)`. Update the comment above it to: `// Sending, answering and withdrawing all need a session. Connecting shows the dealer's hand; signed out keeps the screen's shape -- the add actions stay, faint and disabled, above ACCOUNT_NOTE.` Change the signatures to `function renderFriendsEmpty(sec, gate) {` and `function renderFriendsList(sec, data, gate, enter) {`, each opening with `    const online = gate === "online";`. In `renderFriendsEmpty` replace

```js
    if (online) renderAddFriendPanel(wrap);
    else wrap.appendChild(el("p", "friends-note", ACCOUNT_NOTE));
```
with
```js
    if (online) renderAddFriendPanel(wrap);
    renderConnectingSlot(wrap, "friends", "full", gate);
    if (gate === "signedOut") wrap.appendChild(el("p", "friends-note", ACCOUNT_NOTE));
```
and in `renderFriendsList` replace
```js
    if (online) renderAddFriendPanel(sec);
    else sec.appendChild(el("p", "friends-note", ACCOUNT_NOTE));
```
with
```js
    if (online) renderAddFriendPanel(sec);
    renderConnectingSlot(sec, "friends-list", "mini", gate);
    if (gate === "signedOut") sec.appendChild(el("p", "friends-note", ACCOUNT_NOTE));
```

Add member — replace `    if (!cloudMode()) content.appendChild(el("p", "games-member-add-note", ACCOUNT_NOTE));` with
```js
    const gate = gateNow();
    renderConnectingSlot(content, "group-add", "mini", gate);
    if (gate === "signedOut") content.appendChild(el("p", "games-member-add-note", ACCOUNT_NOTE));
```

Invite card — replace `    if (qr) card.appendChild(qr);` with
```js
    if (qr) card.appendChild(qr);
    renderConnectingSlot(card, "group-invite", "mini", gateNow());
```

Notices — HTML: after `<p id="joinNoticeNote"></p>` add `    <div id="joinNoticeConnecting"></div>`; after `<p class="games-invite-code friend-invite-code" id="friendNoticeCode" dir="ltr"></p>` add `    <div id="friendNoticeConnecting"></div>`. In `joinNoticeParts` add `      connecting: document.getElementById("joinNoticeConnecting"),` after the `note:` line; in `friendNoticeParts` add `      connecting: document.getElementById("friendNoticeConnecting"),` after the `code:` line.

In `showJoinNotice` replace `    if (!supabase) {\n      ui.note.textContent = "אין חיבור כרגע, נסו שוב בעוד רגע";` with
```js
    const gate = gateNow();
    renderConnectingSlot(ui.connecting, "join", "full", gate);
    if (gate === "connecting") {
      ui.note.textContent = "";
```
and `    } else if (!cloudMode()) {\n      ui.note.textContent = "ההצטרפות דורשת חשבון";` with `    } else if (gate === "signedOut") {\n      ui.note.textContent = "ההצטרפות דורשת חשבון";`. In its continue handler replace `if (!supabase) joinNoticeParts().notice.hidden = true;` with `if (gateNow() === "connecting") joinNoticeParts().notice.hidden = true;`.

In `showFriendNotice` replace
```js
    if (!supabase) {
      ui.status.textContent = "קישור חברים דורש חיבור לחשבון";
      ui.status.classList.add("is-error");
      ui.status.hidden = false;
      ui.acceptBtn.hidden = true;
    } else if (!cloudMode()) {
```
with
```js
    const gate = gateNow();
    renderConnectingSlot(ui.connecting, "friend-notice", "full", gate);
    if (gate === "connecting") {
      ui.acceptBtn.hidden = true;
    } else if (gate === "signedOut") {
```

- [ ] **Step 7:** `node --test tests/*.test.cjs` → all pass. Commit: `feat: while the server connects, a mini hold'em hand plays -- riffle, deal, flop, showdown; 'יש ליצור קודם חשבון' only once the server has answered`.

### Task 2: Look, docs, release

- [ ] Build, serve the worktree with a temporary `connecting-preview.html` (a copy of `index.html` whose supabase `<script src>` points to a dead URL) to see "connecting"; check the full and mini forms, dark and light, then delete the temp file. Check the normal `index.html` too (signed out → the account note; the game folds away).
- [ ] DESIGN.md: add a "### מצב מתחברים" subsection under the friends section describing the gate, the two forms, the fold and the surfaces table; in the friends "בלי חשבון" paragraph say that connecting shows the hand instead of the note.
- [ ] Bump `VERSION`, `python3 build.py`, suite, `git diff --check`, commit, rebase on `origin/main` (re-bump if `main` moved past), ff-merge from the main checkout, push, confirm `sw.js` on production shows the new `kupa-vNN`.
