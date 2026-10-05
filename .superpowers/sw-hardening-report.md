# Service-worker and SDK-boot hardening (review items #16, #11)

## What changed
- `sw.js` (the `CACHE` line is untouched):
  - Install fetches each precache entry, validates it (`res.ok` and same-origin `basic`), then `put`s it. `./` and `index.html` are critical: if either fails, install rejects, so the previous worker and its complete cache keep serving (no `skipWaiting`, no activate-time deletion). Other assets stay best-effort.
  - Navigation stays network-first, but the wait is bounded by `NAV_TIMEOUT_MS` (4s). On timeout it serves the cached page or the `./` shell; a late network answer is still cached. A 5xx response is replaced by a cached page when one exists; 404 passes through.
  - Non-OK or non-basic responses are never cached, for pages and for the static-asset path (shared `cacheable()` helper).
  - Runtime cache writes and the background asset refresh go through `event.waitUntil`.
  - No cross-origin caching was added (Supabase / CDN still bypass the worker).
- `build.py` registration wrapper: the rejection is now `console.warn`ed, and `registration.update()` is called when the page becomes visible again.
- `kupa-sgura.html` (small block after the `bootBackend` boot lines): `retryBackendSdk()` runs on `online` and on visibility return. It is idempotent, has at most one in-flight script request, and is a no-op once a client exists, while the document is still loading, or when offline. If `window.supabase` is missing it re-injects the pinned CDN script. Once the client is built it runs the same `bootBackend()` (auth block refresh + `initAuth`).
- Tests: new `tests/service-worker-runtime.test.cjs` (6 tests) runs `sw.js` in a `vm` with a faked scope, plus static checks for the wrapper and the retry wiring. Suite: 704 pass, 0 fail.

## Not done, and why
- No same-origin or exact-pinned SDK asset (review fix #11): out of scope here, and the SDK would then need a version bump and a SW cache entry. The CDN URL is still `@2`, unpinned.
- No controllerchange reload or update-available UI (review #16 "update detection"): it needs UX decisions and would touch app code that other agents are editing.
- No distinct "SDK loading / failed" diagnostic in the login UI: that is in the auth section owned by other agents.
- `index.html` was not regenerated, `VERSION` was not bumped, and `build.py` was not run (per instructions), so the wrapper change reaches production only after the next release build.

## Could not verify
- Real service-worker behaviour in a browser (iOS PWA lifecycle, actual hang and timeout, install-failure retention of the old worker). The tests use a faked scope only.
- The retry path against a real CDN failure and recovery. It is covered by static assertions only, not executed in a DOM.
- If a `bootBackend()` run with a null client happens first (the `DOMContentLoaded` path), the retry later calls `bootBackend()` again. This is the intended recovery, but repeated `initAuth()` calls were not exercised.
- A first-ever install that fails on a critical entry leaves the page without a worker until the next load retries registration. This is intentional but untested.
