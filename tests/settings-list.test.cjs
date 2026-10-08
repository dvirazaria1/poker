const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('kupa-sgura.html', 'utf8');
const settings = html.slice(html.indexOf('<section class="settings-page" id="settings"'), html.indexOf('</section><!-- /#settings -->'));
const refresh = html.slice(html.indexOf('function refreshSettings()'), html.indexOf('\n  }', html.indexOf('function refreshSettings()')));

// The settings screen (2026-10-08): identity (picture, the underlined name with its pencil),
// (sign-in), then titled groups -- account, notifications, info, danger zone -- then sign-out
// and the version at the bottom. Dark mode lives only in the corner toggle.

test('the groups appear in order, each with a quiet title, and sign-out sits at the bottom', () => {
  const order = ['class="set-identity"', 'id="setSignIn"', 'id="setAccountTitle"', 'id="setPush"', '>מידע<', 'id="setDangerTitle"', 'id="setSwapBtn"', 'class="set-version"'];
  let last = -1;
  for (const marker of order) {
    const at = settings.indexOf(marker);
    assert.ok(at > last, `${marker} is out of order or missing`);
    last = at;
  }
  assert.match(settings, /<h3 class="set-section-title" id="setAccountTitle">חשבון<\/h3>/);
  assert.match(refresh, /setAccountTitle"\)\.textContent = authUser \? "חשבון" : "פרטים";/);
  assert.match(settings, /<button type="button" class="btn-quiet set-signout-btn" id="setSwapBtn">התנתקות<\/button>\s*<p class="set-version">/);
});

test('every row is a label at the start and its value or control at the end, on a hairline', () => {
  assert.match(html, /\.set-row \{\n    display: flex; align-items: center; gap: 12px; width: 100%; min-height: 54px;/);
  assert.match(html, /\.set-row-label \{ margin-inline-end: auto;/);
  assert.match(html, /\.set-group \{ border-top: 1px solid var\(--line\); \}/);
});

test('the big name is underlined with its pencil beside it, and the editor takes its place', () => {
  const identity = settings.slice(settings.indexOf('class="set-identity"'), settings.indexOf('id="setSignIn"'));
  assert.match(identity, /<div class="set-name-line" id="setNameLine">\s*<div class="set-name" id="setName"><\/div>\s*<button type="button" class="set-name-edit" id="setNameEdit" aria-label="עריכת השם">/);
  assert.match(identity, /<div class="set-name-editor" id="setNameEditor" hidden>/);
  assert.match(html, /\.set-name-line \.set-name \{ padding-bottom: 4px; border-bottom: 1px solid var\(--faint\);/);
  assert.match(html, /\.set-name-line \{ display: grid; grid-template-columns: 44px auto 44px;/);
  assert.match(refresh, /setNameLine"\)\.hidden = setNameEditing;/);
  assert.doesNotMatch(settings, /id="setNameValue"/, 'no separate name row any more');
});

test('dark mode is only the corner toggle, not a settings row', () => {
  assert.doesNotMatch(settings, /setThemeSwitch|מצב כהה|>תצוגה</);
  assert.doesNotMatch(html, /getElementById\("setThemeSwitch"\)/);
});

test('notifications are a switch that turns on and off', () => {
  assert.match(settings, /<span class="set-row-label" id="setPushLabel">התראות לטלפון<\/span>/);
  assert.match(settings, /<button type="button" class="switch" id="setPushBtn" role="switch" aria-checked="false" aria-labelledby="setPushLabel"><\/button>/);
  const row = html.slice(html.indexOf('  function refreshPushRow() {'), html.indexOf('  function refreshSettings() {'));
  assert.match(row, /btn\.classList\.toggle\("on", on\);/);
  assert.match(row, /btn\.setAttribute\("aria-checked", on \? "true" : "false"\);/);
  assert.doesNotMatch(row, /btn\.textContent/);
});

test('a whole tappable row forwards the tap to its own control, never to a nested link or input', () => {
  const start = html.indexOf('document.getElementById("settings").addEventListener("click"');
  assert.ok(start >= 0, 'missing the row-tap delegation');
  const handler = html.slice(start, html.indexOf('\n  });', start));
  assert.match(handler, /e\.target\.closest\("\.set-row-tap"\)/);
  assert.match(handler, /e\.target\.closest\("button, a, input"\)\) return;/);
  assert.match(handler, /row\.querySelector\("button:not\(\[hidden\]\)"\)/);
  assert.equal((settings.match(/class="set-row set-row-tap/g) || []).length, 2, 'contact and notifications rows');
});

test('a local player sees where their data lives and one filled sign-in button', () => {
  assert.match(settings, /<p class="set-local-note" id="setLocalNote" hidden>בלי חשבון · נשמר רק במכשיר הזה<\/p>/);
  assert.match(refresh, /setLocalNote"\)\.hidden = sessionHeld;/);
  assert.match(refresh, /setSignIn"\)\.hidden = !canSignIn;/);
  assert.equal((settings.match(/btn-fill/g) || []).length, 1, 'one filled button on the screen');
});

test('settings is a view of its own, reached from the gear, with the tab bar and corner still there', () => {
  // a section of the page, after the other tabs' sections -- not a full-screen overlay
  const wrap = html.indexOf('<div class="wrap">');
  assert.ok(html.indexOf('<section class="settings-page" id="settings" hidden>') > wrap, 'settings lives inside .wrap');
  assert.doesNotMatch(html, /<div class="login" id="settings"/);
  assert.doesNotMatch(settings, /id="setBackBtn"/, 'a tab has no back arrow');
  // render() shows it for appView "settings" only, and lights the gear there
  const render = html.slice(html.indexOf('  function render() {'), html.indexOf('const rows = document.getElementById("rows");'));
  assert.match(render, /document\.getElementById\("settings"\)\.hidden = appView !== "settings";\n    if \(appView === "settings"\) refreshSettings\(\);/);
  assert.match(render, /settingsBtn\.classList\.toggle\("on", appView === "settings"\);/);
  assert.match(render, /appView !== "friends" && appView !== "settings";/);
  // the gear toggles: opens settings from the current tab, and goes back to it
  const gear = html.slice(html.indexOf('document.getElementById("settingsBtn").addEventListener("click"'), html.indexOf('  function leaveSettings() {'));
  assert.match(gear, /if \(appView === "settings"\) \{ leaveSettings\(\); return; \}\n    settingsReturnView = appView;/);
  assert.match(gear, /setAppView\("settings"\);/);
  assert.match(html, /function leaveSettings\(\) \{\n    if \(appView === "settings"\) setAppView\(settingsReturnView \|\| "profile"\);/);
  // nothing hides the old overlay any more
  assert.doesNotMatch(html, /getElementById\("settings"\)\.hidden = (true|false)/);
  assert.match(html, /\.corner-btn\.on \{ color: var\(--accent\); \}/);
});

test('the gear goes dark when settings closes: its hover tint is for devices that hover only', () => {
  // on a phone a tapped button keeps :hover, which kept the gear turquoise after leaving settings
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const hoverBlock = style.slice(style.indexOf('@media (hover: hover) {'));
  assert.match(hoverBlock, /\.corner-btn:hover \{ color: var\(--accent\); \}/);
  const outside = style.slice(0, style.indexOf('@media (hover: hover) {'));
  assert.doesNotMatch(outside, /\.corner-btn:hover/);
  assert.doesNotMatch(outside, /\n  \.set-name-edit:hover/);
});

test('the version line keeps the "גרסה N" shape build.py rewrites', () => {
  assert.match(settings, /<p class="set-version">גרסה \d+<\/p>/);
});

test('every new control animates, and the global reduced-motion rule is still last', () => {
  assert.match(html, /\.set-row-tap:active, \.set-row-btn:active, \.set-row-link:active \{ background-color: var\(--avatar-soft\); \}/);
  assert.match(html, /#settings \.set-name-editor, #settings \.set-contact-editor \{[^}]*animation: rise \.28s ease both;/);
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert.match(style, /@media \(prefers-reduced-motion: reduce\) \{\n    \* \{ animation: none !important; transition: none !important; \}\n  \}\n$/);
});
