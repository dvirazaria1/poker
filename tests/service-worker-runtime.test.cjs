// Service worker hardening: runs sw.js against a faked ServiceWorker scope (vm), plus static checks
// on the build.py registration wrapper and the SDK-retry code in kupa-sgura.html.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sw = fs.readFileSync('sw.js', 'utf8');
const buildPy = fs.readFileSync('build.py', 'utf8');
const app = fs.readFileSync('kupa-sgura.html', 'utf8');

function loadWorker({ fetchImpl, cacheEntries = {} }) {
  const handlers = {};
  const store = new Map(Object.entries(cacheEntries));
  const cache = { put: async (req, res) => { store.set(typeof req === 'string' ? req : req.url, res); } };
  const timers = [];
  const ctx = {
    self: {
      location: { origin: 'https://app.test' },
      addEventListener: (t, f) => { handlers[t] = f; },
      skipWaiting: () => { ctx.skipped = true; },
      clients: { claim: async () => {} },
    },
    caches: {
      open: async () => cache,
      keys: async () => [],
      match: async (req) => store.get(typeof req === 'string' ? req : req.url),
      delete: async () => true,
    },
    fetch: fetchImpl, URL, Promise, Error, Set, console,
    setTimeout: (f, ms) => { timers.push(ms); return setTimeout(f, 0); }, // fire timeouts immediately
  };
  vm.runInNewContext(sw, ctx);
  return { handlers, store, ctx, timers };
}
const resp = (status, type = 'basic') => ({ ok: status >= 200 && status < 300, status, type, clone() { return this; } });
const nav = (handlers, url) => {
  const ev = { waits: [], request: { method: 'GET', url } };
  ev.respondWith = (x) => { ev.out = x; };
  ev.waitUntil = (x) => ev.waits.push(x);
  handlers.fetch(ev);
  return ev;
};

test('install fails (old worker keeps serving) when a critical shell entry cannot be precached', async () => {
  const { handlers, ctx } = loadWorker({ fetchImpl: async (u) => (u === 'index.html' ? resp(500) : resp(200)) });
  let p; handlers.install({ waitUntil: (x) => { p = x; } });
  await assert.rejects(p, /critical/);
  assert.ok(!ctx.skipped, 'a failed shell install must not skipWaiting over the previous worker');
});

test('install tolerates a failed non-critical asset and still activates', async () => {
  const { handlers, ctx } = loadWorker({ fetchImpl: async (u) => (u === 'terms.html' ? resp(404) : resp(200)) });
  let p; handlers.install({ waitUntil: (x) => { p = x; } });
  await p;
  assert.ok(ctx.skipped);
});

test('navigation serves the cached shell when the network hangs, via a bounded wait', async () => {
  const shell = resp(200);
  const { handlers, timers } = loadWorker({ fetchImpl: () => new Promise(() => {}), cacheEntries: { './': shell } });
  const ev = nav(handlers, 'https://app.test/');
  assert.equal(await ev.out, shell);
  assert.ok(timers.some((ms) => ms > 0 && ms <= 10000), 'navigation must bound the network wait');
});

test('non-OK and non-basic responses are never cached (pages and static assets)', async () => {
  for (const [url, res] of [['https://app.test/', resp(404)], ['https://app.test/icon-180.png', resp(500)], ['https://app.test/', resp(200, 'opaque')]]) {
    const { handlers, store } = loadWorker({ fetchImpl: async () => res });
    const ev = nav(handlers, url);
    await ev.out; await Promise.all(ev.waits);
    assert.equal(store.size, 0, `${url} (${res.status}/${res.type}) must not be cached`);
  }
});

test('a good network answer wins, and its cache write is attached to the event lifetime', async () => {
  const good = resp(200);
  const { handlers, store } = loadWorker({ fetchImpl: async () => good });
  const ev = nav(handlers, 'https://app.test/privacy.html');
  assert.equal(await ev.out, good);
  await Promise.all(ev.waits);
  assert.ok(ev.waits.length >= 2, 'cache write and network both go through waitUntil');
  assert.equal(store.size, 1);
});

test('registration wrapper warns instead of swallowing failure; SDK init retries on online/visible', () => {
  assert.match(buildPy, /register\("\.\/sw\.js"\)[\s\S]*console\.warn/);
  assert.doesNotMatch(buildPy, /register\("\.\/sw\.js"\)\.catch\(\(\) => \{\}\)/);
  assert.match(app, /function retryBackendSdk\(\)[\s\S]*?bootBackend\(\)/);
  assert.match(app, /addEventListener\("online", retryBackendSdk\)/);
  assert.match(app, /visibilityState === "visible"\) retryBackendSdk\(\)/);
});
