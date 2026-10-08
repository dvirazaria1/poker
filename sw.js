const CACHE = "kupa-v122";

// The full app shell: everything needed for a cold install / offline first load. Every entry here
// must exist on disk and actually ship in the Vercel deploy (see .vercelignore) — this file is not
// build-generated, so keeping the two in sync is a manual, tested contract (tests/service-worker.test.cjs).
const PRECACHE_URLS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "privacy.html",
  "terms.html",
];

// Manifest + icons are immutable per version (a version bump gets a brand-new CACHE name below), so
// they're safe to serve cache-first; everything else in PRECACHE_URLS is a page and stays network-first.
const STATIC_ASSETS = new Set(["manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"]);

// Without these two entries the worker has no offline shell at all, so an install that could not
// store them must FAIL (the previous worker and its complete cache keep serving) instead of
// activating and deleting the old cache. Everything else in PRECACHE_URLS is best-effort.
const CRITICAL_URLS = ["./", "index.html"];

// How long a network-first navigation may hang before the cached shell is served instead. When the
// network answers in time it still wins, so a fresh deploy lands as before.
const NAV_TIMEOUT_MS = 4000;

// Only a real, same-origin 200-class response is worth keeping: a 404/500 page or an opaque/cors
// response cached here would be served back as the "app" next time the network is down.
function cacheable(res) {
  return !!res && res.ok && res.type === "basic";
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => {
      // addAll() is all-or-nothing: one missing/404 entry aborts the whole install and leaves the
      // app with zero offline cache. Add each entry independently so a single miss stays a single miss —
      // but c.add() itself would accept a 404, so fetch and validate each response first.
      const add = (url) =>
        fetch(url).then((res) => {
          if (!cacheable(res)) throw new Error("precache failed: " + url + " (" + res.status + ")");
          return c.put(url, res);
        });
      return Promise.allSettled(PRECACHE_URLS.map(add)).then((results) => {
        const critical = results.filter((r, i) => CRITICAL_URLS.includes(PRECACHE_URLS[i]));
        if (critical.some((r) => r.status !== "fulfilled")) throw new Error("critical app shell failed to precache");
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      // CACHE gets a new name every version (build.py), so any other cache — including a stale
      // precache from a previous version — is dropped here and can't survive the bump.
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return; // never intercept/cache mutations
  const url = new URL(e.request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return; // skip chrome-extension: and other non-http schemes
  // Cross-origin: the Supabase API/auth calls (*.supabase.co), the jsDelivr supabase-js CDN
  // script, and Google Fonts. Never cache any of it here — stale auth or stale game data would be
  // a correctness bug at a live table, and opaque cross-origin responses can't be inspected anyway.
  if (url.origin !== self.location.origin) return;

  const isStaticAsset = STATIC_ASSETS.has(url.pathname.replace(/^\//, ""));
  // Runtime cache writes are tied to the event lifetime so the worker isn't terminated mid-write.
  const store = (res) => {
    if (!cacheable(res)) return;
    const clone = res.clone();
    e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {}));
  };

  if (isStaticAsset) {
    // Cache-first with a background refresh: instant response, cache quietly updated for next time.
    const network = fetch(e.request)
      .then((res) => { store(res); return res; })
      .catch(() => caches.match(e.request));
    // The refresh keeps running after a cache hit, so keep the worker alive until it settles.
    e.waitUntil(network.catch(() => {}));
    e.respondWith(caches.match(e.request).then((cached) => cached || network));
    return;
  }

  // Network-first for pages/navigations (so updates land as soon as they're deployed — deliberate),
  // with a cache fallback offline; "./" is the last-resort shell if this exact request was never cached.
  // The network gets NAV_TIMEOUT_MS: a hanging connection (captive portal, dead wifi) would otherwise
  // never reach the fallback. A late answer is still cached for next time.
  const fallback = () => caches.match(e.request).then((r) => r || caches.match("./"));
  const network = fetch(e.request).then((res) => {
    store(res);
    // A server error (5xx) isn't a page to show if we hold a good cached one; a 404 passes through as-is.
    return res.status >= 500 ? fallback().then((r) => r || res) : res;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  e.waitUntil(network.catch(() => {}));
  e.respondWith(
    Promise.race([network, timeout])
      .then((res) => res || fallback().then((r) => r || network))
      .catch(fallback)
  );
});

// Web Push (docs/superpowers/plans/2026-10-05-push-notifications.md). The payload is what the
// notify Edge Function sent: { title, body, url, tag }. A shared tag (e.g. one debt's "you owe"
// and its later "paid") lets the newer notification replace the older one on the device.
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(data.title || "סוגרים קופה", {
    body: data.body || "",
    tag: data.tag || undefined,
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: { url: data.url || "./" },
  }));
});

// Tapping a notification brings the app forward (an open window first, a new one otherwise).
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if ("focus" in client) return client.focus();
    }
    return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
  }));
});
