const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('kupa-sgura.html', 'utf8');

function between(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + 1);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end >= 0, `missing ${endMarker}`);
  return html.slice(start, end);
}

const pureSource = between('  // ---------- profile avatar (pure) ----------', '  // ---------- player exit (pure) ----------');
const uiSource = between('  // ---------- profile avatar (UI) ----------', '  // ---------- settings overlay ----------');

function load() {
  const context = vm.createContext({});
  vm.runInContext(pureSource, context);
  return context;
}
function runJSON(code, context) {
  return JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context));
}

// ---------- parseAvatar / formatAvatar ----------

test('a suit avatar round-trips in every shape and style', () => {
  const c = load();
  for (const suit of ['spade', 'heart', 'diamond', 'club']) {
    for (const style of ['plain', 'accent', 'outline', 'chip']) {
      const token = `kupa:suit:${suit}:${style}`;
      assert.deepEqual(runJSON(`parseAvatar(${JSON.stringify(token)})`, c), { kind: 'suit', suit, style });
      assert.equal(vm.runInContext(`formatAvatar(parseAvatar(${JSON.stringify(token)}))`, c), token);
    }
  }
});

test('one or two cards round-trip, including the two-digit rank', () => {
  const c = load();
  assert.deepEqual(runJSON(`parseAvatar("kupa:cards:As")`, c), { kind: 'cards', cards: [{ rank: 'A', suit: 'spade' }] });
  assert.deepEqual(runJSON(`parseAvatar("kupa:cards:10h.Kd")`, c),
    { kind: 'cards', cards: [{ rank: '10', suit: 'heart' }, { rank: 'K', suit: 'diamond' }] });
  assert.equal(vm.runInContext(`formatAvatar({ kind: "cards", cards: [{ rank: "Q", suit: "club" }, { rank: "2", suit: "spade" }] })`, c), 'kupa:cards:Qc.2s');
});

test('a base64 jpeg/png/webp photo is accepted as-is', () => {
  const c = load();
  const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
  assert.deepEqual(runJSON(`parseAvatar(${JSON.stringify(photo)})`, c), { kind: 'photo', photo });
  assert.equal(vm.runInContext(`formatAvatar({ kind: "photo", photo: ${JSON.stringify(photo)} })`, c), photo);
  assert.ok(vm.runInContext(`parseAvatar("data:image/png;base64,iVBORw0KGgo=")`, c));
  assert.ok(vm.runInContext(`parseAvatar("data:image/webp;base64,UklGRg==")`, c));
});

test('anything else -- another person\'s stray value included -- parses to null', () => {
  const c = load();
  const rejected = [
    null, undefined, '', 42,
    'javascript:alert(1)',
    'https://example.com/me.jpg',
    'data:image/svg+xml;base64,PHN2Zz4=',          // an SVG can carry script
    'data:image/jpeg;base64,abc def',               // not base64
    'data:text/html;base64,PGgxPg==',
    'kupa:suit:spade',                              // no style
    'kupa:suit:star:plain',
    'kupa:suit:heart:neon',
    'kupa:cards:',
    'kupa:cards:1s', 'kupa:cards:11h', 'kupa:cards:Ax',
    'kupa:cards:As.Kh.Qd',                          // three cards
    'kupa:cards:As,Kh',
    ' kupa:suit:spade:plain',
  ];
  for (const value of rejected) {
    assert.equal(vm.runInContext(`parseAvatar(${JSON.stringify(value)})`, c), null, `accepted ${JSON.stringify(value)}`);
  }
  const huge = 'data:image/jpeg;base64,' + 'A'.repeat(32000);
  assert.equal(vm.runInContext(`parseAvatar(${JSON.stringify(huge)})`, c), null, 'oversized values are refused');
});

test('formatAvatar refuses an incomplete draft, so photo mode cannot save without a photo', () => {
  const c = load();
  assert.equal(vm.runInContext(`formatAvatar({ kind: "photo", photo: null })`, c), null);
  assert.equal(vm.runInContext(`formatAvatar({ kind: "cards", cards: [] })`, c), null);
  assert.equal(vm.runInContext(`formatAvatar({ kind: "suit", suit: "spade" })`, c), null);
  assert.equal(vm.runInContext(`formatAvatar(null)`, c), null);
});

// ---------- rendering and wiring ----------

test('the avatar is built with DOM calls; a photo reaches <img src> only after parseAvatar', () => {
  const render = between('  function renderAvatarEl(token, size, name, key) {', '  function renderEmptyPhotoAvatar(size) {');
  assert.match(render, /const a = parseAvatar\(token\);/);
  assert.match(render, /img\.src = a\.photo;/);
  assert.doesNotMatch(uiSource, /\.innerHTML\s*=/, 'no innerHTML anywhere in the avatar UI');
  // the club/heart/diamond glyphs are text with VS15 so iOS never swaps in colour emoji
  assert.ok(uiSource.includes('heart: "♥︎"'), 'heart glyph carries U+FE0E');
});

test('my picture lives in profiles.avatar_url and, for this device, in the existing contact record', () => {
  assert.match(uiSource, /supabase\.from\("profiles"\)\.update\(\{ avatar_url: token \}\)\.eq\("id", owner\)/);
  assert.match(uiSource, /supabase\.from\("profiles"\)\.select\("id,avatar_url"\)\.in\("id", want\)/);
  assert.match(uiSource, /function storeMyAvatarLocally\(token\) \{\n    writeContact\(\{ avatar: token \|\| null, avatarFor: authUser \? authUser\.id : null \}\);/);
  // no new storage key: the only localStorage write in this feature is through writeContact
  assert.doesNotMatch(uiSource, /localStorage\.setItem/);
  assert.match(html, /function writeContact\(patch\) \{\n    try \{\n      localStorage\.setItem\(CONTACT_KEY, JSON\.stringify\(Object\.assign\(loadContact\(\), patch\)\)\);/);
  // a contact-details save merges instead of wiping the stored picture
  assert.match(between('function saveContact()', 'function writeContact(patch)'), /writeContact\(\{/);
});

test('only a confirmed server write updates the device copy; a failed write keeps the editor open', () => {
  const save = between('  function saveAvatarDraft() {', '  // ---------- settings overlay ----------');
  assert.match(save, /if \(error\) \{ failed\(\); return; \}\n      avatarCache\.set\(owner/);
  assert.match(save, /draft\.error = "לא הצלחנו לשמור\. בדקו את החיבור ונסו שוב\.";/);
});

test('friends fetch in one query, back off after a failure, and are swapped in place', () => {
  const ensure = between('  function ensureAvatars(ids) {', '  function shrinkAvatarPhoto(file) {');
  assert.match(ensure, /isCloudId\(id\) && !avatarInflight\.has\(id\)/);
  assert.match(ensure, /avatarRetryAfter = Date\.now\(\) \+ 30000;/);
  assert.match(ensure, /patchAvatars\(id\)/);
  assert.match(uiSource, /old\.replaceWith\(renderAvatarEl\(/);
});

test('the friends lists lead every row with an avatar; settings and the profile header open the editor', () => {
  const group = between('  function renderFriendGroup(', '  // The inline add-friend panel');
  assert.match(group, /if \(withAvatars\) row\.appendChild\(renderAvatarEl\(cachedAvatar\(ref\.userId\), 44, ref\.displayName \|\| "", ref\.userId \|\| ""\)\);/);
  const page = between('  function renderFriendsPage() {', '  function renderProfile() {');
  assert.equal((page.match(/, true\);/g) || []).length, 3, 'incoming, outgoing and friends all pass withAvatars');
  assert.match(page, /ensureAvatars\(/);

  assert.match(html, /<button type="button" class="pavatar-edit" id="setAvatar" aria-label="עריכת תמונת הפרופיל"><\/button>/);
  assert.match(html, /document\.getElementById\("setAvatar"\)\.addEventListener\("click", openAvatarEditor\);/);
  assert.match(html, /mountMyAvatar\(document\.getElementById\("setAvatar"\), 84\);/);
  const profile = between('  function renderProfile() {', '    const tabs = el("div", "profile-tabs");');
  assert.match(profile, /idAvatar\.addEventListener\("click", openAvatarEditor\);\n    mountMyAvatar\(idAvatar, 76\);/);
});

test('the editor is an overlay above settings with photo / shape / cards, and cards use a switch', () => {
  assert.match(html, /<div class="login" id="avatarEditor" role="dialog" aria-modal="true" aria-labelledby="avatarEditorTitle" hidden><\/div>/);
  assert.match(html, /#avatarEditor \{\n    z-index: 44;/);
  const build = between('  function buildAvatarEditor() {', '  function setAvatarDraftCard(patch) {');
  assert.match(build, /\[\["photo", "תמונה"\], \["suit", "צורה"\], \["cards", "קלפים"\]\]/);
  assert.match(build, /ui\.twoRow\.setAttribute\("role", "switch"\);/);
  assert.match(build, /file\.accept = "image\/\*";/);
  assert.match(uiSource, /const AVATAR_STYLES = \[\["plain", "נקי"\], \["accent", "טורקיז"\], \["outline", "קו"\], \["chip", "צ׳יפ"\]\];/);
});

test('every new control animates, and the global reduced-motion rule is still the last rule', () => {
  for (const sel of ['.avatar-suit-btn', '.avatar-style-btn', '.avatar-pick', '.avatar-card-btn', '.avatar-seg button']) {
    const rule = html.slice(html.indexOf(`  ${sel} {`), html.indexOf('}', html.indexOf(`  ${sel} {`)));
    assert.match(rule, /transition:/, `${sel} has a transition`);
  }
  assert.match(html, /\.avatar-suit-btn:active, \.avatar-style-btn:active, \.avatar-pick:active \{ transform: scale\(\.92\); \}/);
  assert.match(html, /\.avatar-panel\.avatar-panel-in \{ animation: rise \.28s ease both; \}/);
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert.match(style, /@media \(prefers-reduced-motion: reduce\) \{\n    \* \{ animation: none !important; transition: none !important; \}\n  \}\n$/);
});

test('both themes: every avatar colour comes from a token redefined for light', () => {
  const light = between('  :root[data-theme="light"] {\n    --avatar-soft', '  .pavatar {');
  for (const token of ['--avatar-soft', '--avatar-solid', '--avatar-tint', '--avatar-tint-edge', '--card-face', '--card-back', '--card-shadow']) {
    assert.match(light, new RegExp(token + ':'), `${token} is set for light`);
  }
});
