// Task 15 (games dashboard integration): regex-only checks against the raw source, matching the
// convention used by games-navigation.test.cjs and motion.test.cjs. These assert that the
// dashboard's group card reads the real GroupSummary shape (not the old stub's fields), that
// card expand/collapse and the archive toggle stay UI-only, that the "coming soon" leftovers are
// gone, and that the dashboard's card entrance stagger follows the same enterStagger pattern
// Task 18 established for the group page.
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

test('the open group card: a big table button, a "סטטיסטיקות" tile, then "צרף חבר" as the first member row', () => {
  const main = sourceBetween('  function renderGroupCardMain(content, group) {', '  // Details mode:');
  assert.match(main, /onTable = \(\) => \{ currentGroupId = groupId; toggleStartGamePanel\(\); \};/);
  assert.match(main, /el\("button", "games-group-table-btn"\)/);
  assert.match(main, /<span>סטטיסטיקות<\/span>/);
  assert.match(main, /stats\.addEventListener\("click", \(\) => setGroupCardMode\("details", "games"\)\);/);
  assert.match(main, /row\.append\(stats, rest\);/); // statistics on the start (right) side, the rest beside it
  assert.match(main, /join\.addEventListener\("click", \(\) => shareGroupInvite\(group\)\);/);
  assert.doesNotMatch(main, /formatGamesPlayedCount/);
  assert.doesNotMatch(main, /"פירוט"/);
  assert.ok(main.indexOf('"games-group-join"') < main.indexOf('members.forEach'), 'the join row comes before the members');
  assert.match(groupCardSource, /setGroupCardMode\("settings", "details"\)/);
});

test('details mode swaps the tiles for back / games / ranking / stats; settings mode for back / details / invite / roles', () => {
  const roles = sourceBetween('  function renderGroupCardRoles(view, groupId, viewerIsAdmin) {', '  function renderGroupSurface() {');
  assert.match(roles, /if \(!viewerIsAdmin \|\| lastAdmin\) \{\s*sw\.disabled = true;/);
  const details = sourceBetween('  function renderGroupCardDetails(content, group) {', '  function renderGroupCardTimeline(');
  ['<span>חזור</span>', '"משחקים"', '"דירוג"', '"נתונים"'].forEach(label => assert.ok(details.includes(label), label));
  assert.match(details, /back\.addEventListener\("click", \(\) => setGroupCardMode\("main"\)\);/);
  const settings = sourceBetween('  function renderGroupCardSettings(content, group) {', '  function renderGroupCardDetailsForm(');
  ['"חזרה"', '"פרטים"', '"הזמנה"', '"ניהול"'].forEach(label => assert.ok(settings.includes(label), label));
  assert.match(settings, /tiles\.push\(\{ key: "roles"/);
});

test('groupCardStats averages pots and durations, ignoring missing durations', () => {
  const source = sourceBetween('  function groupCardStats(games) {', '  function renderGroupCardStats(');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const stats = vm.runInContext('groupCardStats([{potSize:1000,durationMinutes:200},{potSize:1500,durationMinutes:null},{potSize:500,durationMinutes:100}])', context);
  assert.equal(stats.count, 3);
  assert.equal(stats.avgPot, 1000);
  assert.equal(stats.maxPot, 1500);
  assert.equal(stats.avgMinutes, 150);
  assert.equal(vm.runInContext('groupCardStats([]).avgMinutes', context), null);
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

// ---------- open-card motion (2026-10-08): one movement, no hard cut, no replay ----------

test('mode and tab changes turn the card like a page: side by side in a clipped track, no fades or overlays', () => {
  const src = sourceBetween('  function setGroupCardMode(mode, tab) {', '  // A row of square tiles;');
  // statistics move sideways, settings vertically; closing is the mirror image of opening
  assert.match(src, /turnGroupCardPage\(\[".games-group-body-content"\], \{ axis: "y", forward: mode === "settings" \}\);/);
  // statistics: the tile under the thumb stays; only the rest of its row and the content below turn
  assert.match(src, /turnGroupCardPage\(\[".games-group-row-rest", ".games-group-below"\], \{ axis: "x", forward: mode === "details" \}\);/);
  // settings and statistics tabs: the new view enters from the side of the tab tapped
  assert.match(src, /const order = expandedGroupMode === "settings" \? \["details", "invite", "roles"\] : \["games", "ranking", "stats"\];/);
  assert.match(src, /turnGroupCardPage\(\[".games-group-view"\], \{ axis: "x", forward: order\.indexOf\(tab\) < order\.indexOf\(current\) \}\);/);
  assert.match(src, /fromMove = turn\.forward \? "translateX\(0\)" : "translateX\(-100%\)";/);
  assert.match(src, /toMove = turn\.forward \? "translateX\(-100%\)" : "translateX\(0\)";/);
  assert.match(src, /clip\.animate\(\[\{ height: fromHeight \+ "px" \}, \{ height: toHeight \+ "px" \}\]/);
  assert.match(src, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.doesNotMatch(src, /opacity/);
  assert.match(html, /\.games-page-track \{ display: flex; align-items: flex-start; direction: ltr;/);
  assert.match(html, /\.games-page \{ flex: 0 0 100%; min-width: 0; direction: rtl; display: flow-root; \}/);
});

test('no entrance animation is left on the card views (a background re-render must not replay anything)', () => {
  const details = sourceBetween('  function renderGroupCardDetails(content, group) {', '  function renderGroupCardTimeline(');
  assert.match(details, /const view = el\("div", "games-group-view"\);/);
  assert.doesNotMatch(html, /games-group-ghost|groupCardViewEnter|swapGroupCardBody/);
});

test('every top-row tile of the open card is 54px tall, and the statistics tile keeps its width', () => {
  assert.match(html, /\.games-group-action \{\s*min-width: 0; height: 54px;/);
  assert.match(html, /\.games-group-table-btn \{\s*flex: 1 1 auto; min-width: 0; height: 54px;/);
  assert.match(html, /\.games-group-stats-btn \{\s*flex: 0 0 96px; height: 54px;/);
  assert.doesNotMatch(html, /\.games-group-tabs \.games-group-stats-btn \{ flex-basis/);
});
