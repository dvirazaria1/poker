const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('kupa-sgura.html', 'utf8');
const settings = html.slice(html.indexOf('<div class="login" id="settings"'), html.indexOf('<div class="login" id="groupSettings"'));
const refresh = html.slice(html.indexOf('function refreshSettings()'), html.indexOf('\n  }', html.indexOf('function refreshSettings()')));

// The settings screen (2026-10-08): a list in titled groups -- identity, (sign-in), account
// (ending in sign-out), display, notifications, info, danger zone -- with the version last.

test('the groups appear in order, each with a quiet title', () => {
  const order = ['class="set-identity"', 'id="setSignIn"', 'id="setAccountTitle"', 'id="setSwapBtn"', '>תצוגה<', 'id="setPush"', '>מידע<', 'id="setDangerTitle"', 'class="set-version"'];
  let last = -1;
  for (const marker of order) {
    const at = settings.indexOf(marker);
    assert.ok(at > last, `${marker} is out of order or missing`);
    last = at;
  }
  assert.match(settings, /<h3 class="set-section-title" id="setAccountTitle">חשבון<\/h3>/);
  assert.match(refresh, /setAccountTitle"\)\.textContent = authUser \? "חשבון" : "פרטים";/);
});

test('every row is a label at the start and its value or control at the end, on a hairline', () => {
  assert.match(html, /\.set-row \{\n    display: flex; align-items: center; gap: 12px; width: 100%; min-height: 54px;/);
  assert.match(html, /\.set-row-label \{ margin-inline-end: auto;/);
  assert.match(html, /\.set-group \{ border-top: 1px solid var\(--line\); \}/);
  // the name row shows the name as its value, with the pencil as its control
  assert.match(settings, /<span class="set-row-label">שם<\/span>\s*<span class="set-row-value" id="setNameValue"><\/span>\s*<button type="button" class="set-name-edit" id="setNameEdit"/);
  assert.match(refresh, /setNameValue"\)\.textContent = me \|\| "אורח";/);
});

test('a whole tappable row forwards the tap to its own control, never to a nested link or input', () => {
  const start = html.indexOf('document.getElementById("settings").addEventListener("click"');
  assert.ok(start >= 0, 'missing the row-tap delegation');
  const handler = html.slice(start, html.indexOf('\n  });', start));
  assert.match(handler, /e\.target\.closest\("\.set-row-tap"\)/);
  assert.match(handler, /e\.target\.closest\("button, a, input"\)\) return;/);
  assert.match(handler, /row\.querySelector\("button:not\(\[hidden\]\)"\)/);
  assert.equal((settings.match(/class="set-row set-row-tap/g) || []).length, 3, 'name, contact and dark-mode rows');
});

test('"מצב כהה" is on while the dark theme is', () => {
  assert.match(settings, /<span class="set-row-label" id="setThemeLabel">מצב כהה<\/span>\s*<button type="button" class="switch" id="setThemeSwitch" role="switch" aria-labelledby="setThemeLabel"><\/button>/);
  assert.match(refresh, /const isDark = document\.documentElement\.dataset\.theme !== "light";/);
  assert.match(refresh, /sw\.classList\.toggle\("on", isDark\);/);
});

test('a local player sees where their data lives and one filled sign-in button', () => {
  assert.match(settings, /<p class="set-local-note" id="setLocalNote" hidden>בלי חשבון · נשמר רק במכשיר הזה<\/p>/);
  assert.match(refresh, /setLocalNote"\)\.hidden = sessionHeld;/);
  assert.match(refresh, /setSignIn"\)\.hidden = !canSignIn;/);
  assert.equal((settings.match(/btn-fill/g) || []).length, 1, 'one filled button on the screen');
});

test('the version line keeps the "גרסה N" shape build.py rewrites', () => {
  assert.match(settings, /<p class="set-version">גרסה \d+<\/p>/);
});

test('every new control animates, and the global reduced-motion rule is still last', () => {
  assert.match(html, /\.set-row-tap:active, \.set-row-btn:active, \.set-row-link:active \{ background-color: var\(--avatar-soft\); \}/);
  assert.match(html, /\.set-row-action:active \{ transform: scale\(\.94\); \}/);
  assert.match(html, /#settings \.set-name-editor, #settings \.set-contact-editor \{[^}]*animation: rise \.28s ease both;/);
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert.match(style, /@media \(prefers-reduced-motion: reduce\) \{\n    \* \{ animation: none !important; transition: none !important; \}\n  \}\n$/);
});
