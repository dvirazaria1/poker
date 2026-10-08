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

test('one quiet caption under the hand -- "רגע, מתחברים לשרת" -- not a running commentary', () => {
  assert.match(game, /const DEAL_CAPTION = "רגע, מתחברים לשרת";/);
  assert.match(game, /navigator\.onLine === false \? "אין חיבור לאינטרנט" : DEAL_CAPTION/);
  assert.doesNotMatch(game, /"מערבבים"|"מחלקים"|"פלופ"|"טרן"|"ריבר"|"פותחים קלפים"/);
  assert.equal((game.match(/dealCaption\(slot\);/g) || []).length, 2, 'set once per round, full and mini');
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
  assert.match(game, /parent\.appendChild\(slot\.node\);\n    slot\.seenAt = performance\.now\(\);\n    if \(!slot\.running\) runConnectingSlot\(slot\);/);
  assert.match(game, /if \(!slot\.leaving\) leaveConnectingSlot\(key, slot\);/);
  const leave = sourceBetween('  async function leaveConnectingSlot(key, slot) {', '  function renderConnectingSlot(');
  assert.match(leave, /await Promise\.resolve\(\);\n    if \(!dealStill\(\) && slot\.node\.isConnected\)/);
  assert.match(leave, /dealGather\(cards, /);
  assert.match(leave, /slot\.node\.classList\.add\("leaving"\);/);
  assert.match(game, /function dealFrozen\(target, o\) \{ return !o\.exit && !!target\.closest\("\.connecting\.leaving"\); \}/);
  assert.match(leave, /height: "0px"/);
  assert.match(leave, /await dealWait\(\(cards\.length - 1\) \* 24 \+ 300\);/);
  assert.match(leave, /await dealWait\(280\);/);
  assert.match(leave, /slot\.node\.remove\(\);/);
  assert.match(leave, /clearInterval\(slot\.beat\);/);
  assert.match(game, /slot\.beat = setInterval\(\(\) => \{ if \(slot\.node\.getClientRects\(\)\.length\) slot\.seenAt = performance\.now\(\); \}, 250\);/);
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

test('a five-card board dealt like a casino: the flop leaves the deck as one stack, turns as one, fans out', () => {
  assert.match(game, /const DEAL_BOARD = \[\[-44, 6\], \[-22, 6\], \[0, 6\], \[22, 6\], \[44, 6\]\];/);
  assert.match(game, /slot\.cards\.board = Array\.from\(\{ length: 5 \}, \(\) => dealCard\(stage\)\);/);
  const hand = sourceBetween('  async function runDealerHand(slot) {', '  async function runMiniRiffle(slot) {');
  const flop = hand.indexOf('// The flop, the casino way'), stack = hand.indexOf('await dealFlipTogether('), fan = hand.indexOf('// fan the flop out'), turn = hand.indexOf('for (const i of [3, 4]) {');
  assert.ok(flop >= 0 && stack > flop && fan > stack && turn > fan, 'flop stack -> flip together -> fan -> turn, river');
  // no seat markers any more: the hole cards are the players
  assert.doesNotMatch(html, /deal-seat/);
});

test('on the friends screen the hand sits 25px lower than elsewhere (owner, 2026-10-08)', () => {
  assert.match(html, /\.connecting\.full \{ margin-top: 18px; \}/);
  assert.match(html, /\.friends-empty \.connecting\.full \{ margin-top: 43px; \}/);
});
