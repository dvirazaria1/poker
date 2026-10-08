// Games screen: the group list always shows at least four cards above "משחק ללא קבוצה" (owner,
// 2026-10-08) -- real groups, or the first-group card, topped up with ghost cards that fade out.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('kupa-sgura.html', 'utf8');
function sourceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + 1);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end >= 0, `missing ${endMarker}`);
  return html.slice(start, end);
}

test('ghost cards top the group list up to four, with or without groups', () => {
  const ghosts = sourceBetween('  function renderGroupGhosts(parent, shown) {', '  function renderGroupsSection(');
  assert.match(html, /const GROUP_GHOST_TARGET = 4;/);
  assert.match(ghosts, /const ghosts = Math\.max\(0, GROUP_GHOST_TARGET - shown\);/);
  assert.match(ghosts, /ghost\.setAttribute\("aria-hidden", "true"\);/);
  assert.match(ghosts, /ghost\.style\.opacity = String\(\+\(0\.75 \* \(1 - j \/ ghosts\)\)\.toFixed\(2\)\);/);
  const section = sourceBetween('  function renderGroupsSection(parent, groups, enterStagger) {', '  // 2026-10-08 (owner ask): tapping a group card');
  assert.match(section, /renderGroupGhosts\(section, 1\);/, 'no group: the first-group card counts as one');
  assert.match(section, /renderGroupGhosts\(list, groups\.length\);/, 'with groups: topped up after them');
  assert.doesNotMatch(section, /\[\.3, \.15\]/);
});

test('ghost cards read as cards: a dashed --faint edge and ring', () => {
  assert.match(html, /\.gh-ghost \{[^}]*border: 1px dashed var\(--faint\);/);
  assert.match(html, /\.gh-ghost-av \{[^}]*border: 1px dashed var\(--faint\);/);
  assert.match(html, /\.games-group-list \.gh-ghost \{ margin-top: 0; \}/);
});
