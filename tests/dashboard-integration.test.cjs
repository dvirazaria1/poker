// Task 15 (games dashboard integration): regex-only checks against the raw source, matching the
// convention used by games-navigation.test.cjs and motion.test.cjs. These assert that the
// dashboard's group card reads the real GroupSummary shape (not the old stub's fields), that
// card expand/collapse and the archive toggle stay UI-only, that the "coming soon" leftovers are
// gone, and that the dashboard's card entrance stagger follows the same enterStagger pattern
// Task 18 established for the group page.
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

const groupCardSource = sourceBetween('  function renderGroupCard(group, actions) {', '  function renderGroupsSection(');

// ---------- renderGroupCard reads the real GroupSummary shape ----------

test('renderGroupCard reads the compact GroupSummary status fields', () => {
  assert.match(groupCardSource, /group\.hasActiveGame/);
  assert.match(groupCardSource, /group\.activeGamePhase/);
});

test('renderGroupCard no longer reads the old stub fields, or a raw group.id fallback (GroupSummary has no .id)', () => {
  assert.doesNotMatch(groupCardSource, /group\.lastGame\b/);
  assert.doesNotMatch(groupCardSource, /group\.leader\b/);
  assert.doesNotMatch(groupCardSource, /group\.topPlayers\b/);
  assert.doesNotMatch(groupCardSource, /group\.id\b/);
});

test('renderGroupsSection and renderArchivedGroupsSection key cards by group.groupId only', () => {
  const sectionsSource = sourceBetween('  function renderGroupsSection(', '  function closeArchivedGroups()');
  assert.doesNotMatch(sectionsSource, /group\.id\b/);
  assert.match(sectionsSource, /group\.groupId/);
});

// ---------- group card status: active vs. settlement, with the shared accent-dot class ----------

test('the group card status text distinguishes an active game from one in settlement, reusing the accent-dot class', () => {
  assert.match(groupCardSource, /group\.activeGamePhase === "settlement"/);
  assert.match(groupCardSource, /"games-card-status"/);
  assert.match(groupCardSource, /בסגירה/);
  assert.match(groupCardSource, /משחק פעיל/);
});

// ---------- group rows are a clean list; details moved to the group preview ----------

test('the active-game card toggle label is "כווץ" when expanded and "הרחב" when collapsed', () => {
  const activeCardSource = sourceBetween('  function renderActiveGameCard(summary, actions) {', '  function renderActiveGamesSection(');
  assert.match(activeCardSource, /actions\.expanded \? "כווץ" : "הרחב"/);
});

test('the group card opens in place: no "הרחב" toggle button, its body comes from renderGroupCardBody', () => {
  // 2026-10-08 owner ask: a tap on the card itself opens it; there is still no separate toggle.
  assert.doesNotMatch(groupCardSource, /games-card-toggle/);
  assert.doesNotMatch(groupCardSource, /games-card-details/);
  assert.match(groupCardSource, /if \(actions\.onToggle\) card\.appendChild\(renderGroupCardBody\(group, expanded\)\);/);
});

test('the open group card carries invite, table, details and settings, then the members one under another', () => {
  const body = sourceBetween('  function renderGroupCardBody(group, expanded) {', '  // Collapsed "ארכיון');
  assert.match(body, /groupActionButton\("invite", "צרף חבר", \(\) => shareGroupInvite\(group\)\)/);
  assert.match(body, /groupActionButton\("table", "פתח שולחן", \(\) => \{ currentGroupId = groupId; toggleStartGamePanel\(\); \}, "primary"\)/);
  assert.match(body, /groupActionButton\("details", "פירוט", \(\) => \{ resetStartGamePanel\(\); openGroupPreview\(groupId\); \}\)/);
  assert.match(body, /groupActionButton\("settings", "הגדרות", \(\) => \{ currentGroupId = groupId; openGroupSettings\(\); \}\)/);
  assert.match(body, /activeMembers\(collections\.groupMembers, groupId\)/);
  assert.ok(body.indexOf('"games-group-actions"') < body.indexOf('"games-group-players"'), 'buttons sit above the member list');
});

// ---------- quick actions: only the standalone-game action remains ----------

test('quick actions contain only the standalone-game action after create-group moved beside the groups title', () => {
  const source = sourceBetween('  function renderQuickActions(parent) {', '  function renderCreateGroupPanel(');
  assert.doesNotMatch(source, /\+ צור קבוצה/);
  assert.match(source, /games-quick-actions/);
  assert.match(source, /classList\.add\("single"\)/);
  assert.match(source, /startUngroupedGame/);
});

// ---------- dashboard interaction state never calls save() ----------

test('the dashboard region never calls save() from card expand/collapse or the archive toggle', () => {
  const dashboardSource = sourceBetween(
    '  function renderActiveGamesSection(parent, summaries, enterStagger) {',
    '  function openGroupPreview(groupId) {'
  );
  assert.doesNotMatch(dashboardSource, /\bsave\(\)/);
});

// ---------- dead code: the old "coming soon" placeholder is fully gone ----------

test('the dashboard has no leftover "coming soon" CSS or copy', () => {
  assert.doesNotMatch(html, /games-coming-soon/);
  assert.doesNotMatch(html, /בקרוב/);
});

// ---------- motion: dashboard cards stagger in only right after a navigation ----------

test('dashboard cards stagger in only right after a navigation, not on every in-place re-render (mirrors groupPageEnterNext)', () => {
  assert.match(html, /let gamesPageEnterNext = false;/);
  const setAppViewSource = sourceBetween('  function setAppView(nextView) {', '  function flashViewEnter');
  assert.match(setAppViewSource, /gamesPageEnterNext\s*=\s*nextView === "games"/);
  const dashboardSource = sourceBetween('  function renderGamesDashboard()', '  function openGroupPreview(groupId) {');
  assert.match(dashboardSource, /const enterStagger = gamesPageEnterNext;/);
  assert.match(dashboardSource, /gamesPageEnterNext = false;/);
  assert.match(dashboardSource, /renderActiveGamesSection\(inner, getActiveGameSummaries\(state, state\.groups\), enterStagger\)/);
  assert.match(dashboardSource, /renderGroupsSection\(inner, getGroupSummaries\(collectionsOf\(state\), me, cloudGroupAggregates\), enterStagger\)/);
});

test('active-game and group cards accept an anim/animDelay pair to drive the entrance stagger', () => {
  const activeCardSource = sourceBetween('  function renderActiveGameCard(summary, actions) {', '  function renderActiveGamesSection(');
  assert.match(activeCardSource, /actions\.anim/);
  assert.match(activeCardSource, /actions\.animDelay/);
  assert.match(groupCardSource, /actions\.anim/);
  assert.match(groupCardSource, /actions\.animDelay/);
});
