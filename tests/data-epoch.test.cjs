// The 2026-10-05 fresh start: a stored document from before DATA_EPOCH is replaced on load.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "kupa-sgura.html"), "utf8");

test("DATA_EPOCH is declared before the first load() runs (a const in its TDZ would throw at boot)", () => {
  assert.ok(html.indexOf("const DATA_EPOCH = 1;") > 0);
  assert.ok(html.indexOf("const DATA_EPOCH = 1;") < html.indexOf("let state = load();"));
});

test("an old document is wiped once, a current one is kept, and new devices start current", () => {
  const body = html.slice(html.indexOf("  function load() {"), html.indexOf("  function save() {"));
  assert.match(body, /s\.dataEpoch >= DATA_EPOCH \? s : freshStart\(s\)/);
  assert.match(body, /example\.dataEpoch = DATA_EPOCH;/);
  assert.match(html, /dataEpoch: Number\(s\.dataEpoch\) \|\| 0,/);
});
