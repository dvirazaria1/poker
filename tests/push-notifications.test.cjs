// Web Push via a server-side outbox (docs/backend/push-notifications.sql,
// supabase/functions/notify/index.ts, sw.js, the settings row in kupa-sgura.html).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const sql = fs.readFileSync("docs/backend/push-notifications.sql", "utf8");
const fnSrc = fs.readFileSync("supabase/functions/notify/index.ts", "utf8");
const sw = fs.readFileSync("sw.js", "utf8");
const html = fs.readFileSync("kupa-sgura.html", "utf8");
const vercelignore = fs.readFileSync(".vercelignore", "utf8");

test("no client can create an event or claim the outbox; the wake secret is generated inside Vault (P1/P9)", () => {
  assert.match(sql, /REVOKE ALL ON notification_events FROM public, anon, authenticated;/);
  assert.match(sql, /REVOKE ALL ON push_subscriptions FROM public, anon, authenticated;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION app_claim_notification_events\(integer\) FROM public, anon, authenticated;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION app_notify_secret\(\) FROM public, anon, authenticated;/);
  assert.match(sql, /vault\.create_secret\(/);
  assert.doesNotMatch(sql, /x-notify-secret', '[^']+'/, "the secret is never written as a literal");
});

test("the sender refuses any request without the Vault secret and never reads recipients from the body", () => {
  assert.match(fnSrc, /if \(!secret \|\| !sameSecret\(given, secret\)\) return new Response\("forbidden", \{ status: 403 \}\);/);
  assert.doesNotMatch(fnSrc, /req\.json\(\)/);
  assert.match(fnSrc, /code === 404 \|\| code === 410/);
  assert.match(fnSrc, /if \(accepted\) return \{ status: "sent"/, "sent only after a push service accepted it (P2)");
});

test("a notification problem can never abort the domain write (P6)", () => {
  for (const name of ["app_notify_game_opened", "app_notify_debt_created", "app_notify_debt_paid", "app_notify_friend_request"]) {
    const start = sql.indexOf("CREATE OR REPLACE FUNCTION " + name + "()");
    const body = sql.slice(start, sql.indexOf("END $$;", start));
    assert.match(body, /EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/, name);
  }
  assert.match(sql, /WHEN \(NEW\.phase = 'active' AND NEW\.group_id IS NOT NULL\s+AND \(NEW\.started_at IS NULL OR NEW\.started_at > now\(\) - interval '6 hours'\)\)/);
  assert.match(sql, /WHEN \(OLD\.status = 'open' AND NEW\.status = 'paid'\)/);
});

test("only real push services, at most five devices, and a minute between tests (P3)", () => {
  assert.match(sql, /v_host = 'fcm\.googleapis\.com' OR v_host = 'web\.push\.apple\.com'/);
  assert.match(sql, /OFFSET 5/);
  assert.match(sql, /interval '1 minute'/);
});

test("the service worker shows pushes and focuses the app on tap; the function source never ships", () => {
  assert.match(sw, /self\.addEventListener\("push"/);
  assert.match(sw, /self\.addEventListener\("notificationclick"/);
  assert.match(vercelignore, /^supabase\/$/m);
});

test("the client asks permission only from the tap, and drops the subscription when the session ends (P4)", () => {
  const enable = html.slice(html.indexOf("  async function enablePushNotifications()"), html.indexOf("  async function disablePushNotifications()"));
  assert.match(enable, /await Notification\.requestPermission\(\)/);
  assert.match(html, /document\.getElementById\("setPushBtn"\)\.addEventListener\("click", enablePushNotifications\);/);
  const exit = html.slice(html.indexOf("  function exitCloudMode() {"), html.indexOf("  function exitCloudMode() {") + 1600);
  assert.match(exit, /disablePushNotifications\(\);/);
  assert.match(html, /function enterCloudMode\(\) \{[\s\S]{0,200}reconcilePushOwnership\(\);/);
});
