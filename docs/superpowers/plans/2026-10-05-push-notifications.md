# Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone that installed the app and turned notifications on is told, even when the app is closed: a table opened in one of my groups; a game closed and I owe / am owed money; my debt was marked paid; someone sent me a friend request.

**Architecture:** Standard Web Push (VAPID). The client subscribes through its service worker and stores the subscription via a SECURITY DEFINER RPC. Postgres AFTER triggers call one Supabase Edge Function (`notify`) through `pg_net` with only `{kind, id}`; the function re-reads the row with the service role, decides recipients from the database (never from the caller), de-duplicates per event+recipient, and sends with `npm:web-push`. Expired subscriptions (404/410) are deleted.

**Tech Stack:** Supabase Postgres (`pg_net`), Supabase Edge Functions (Deno, `npm:web-push@3`, `npm:@supabase/supabase-js@2`), service worker `push`/`notificationclick`, PushManager in the client.

## Global Constraints

- Secrets: the VAPID **private** key and nothing else secret is ever written in the repo, in SQL, or typed by Claude. The owner pastes it into Supabase → Edge Functions → Secrets. `SUPABASE_SERVICE_ROLE_KEY` is provided to the function by Supabase automatically.
- The publishable (anon) key in the trigger is public by design (it already ships in `index.html`).
- No new localStorage keys: the client learns its state from `Notification.permission` and `pushManager.getSubscription()`.
- `sw.js` is hand-maintained (only its CACHE line is build-generated).
- Production SQL and the function deploy run only with the owner's explicit approval in chat.
- Hebrew copy; notifications show only what the recipient could already see in the app.

## Failure modes found while planning, and how the plan resolves each

| # | Failure mode | Resolution |
|---|---|---|
| N1 | Anyone holding the public anon key can call `notify` and spam. | The function takes only `{kind, id}`, re-reads the row, derives recipients itself, and records `(event_key, profile_id)` in `notification_log` with a primary key — each real event notifies each person at most once. A forged call can at most re-request an event already sent (no-op). |
| N2 | The history upload of old games (open shell → close) would announce "a table opened" for games from last month. | `game_opened` fires only for `phase = 'active'` inserts whose `started_at` is within 6 hours; the shell path inserts `phase = 'settlement'`. |
| N3 | A notification about my own action. | The actor is excluded: game creator for `game_opened`, creditor (who marks paid) for `debt_paid`, requester for `friend_request`. |
| N4 | Account switch on one phone: the subscription still belongs to the old account. | `app_save_push_subscription` upserts by `endpoint` and reassigns `profile_id` (SECURITY DEFINER, endpoint is the device's identity); sign-out calls `app_delete_push_subscription(endpoint)` before the session ends. |
| N5 | Expired / revoked subscriptions accumulate and every send fails. | 404/410 from the push service → delete that subscription row. |
| N6 | iOS: `PushManager` exists only in an installed (home-screen) PWA on iOS 16.4+, and the permission prompt must come from a tap. | The settings row checks `'PushManager' in window` and standalone; outside it, it explains "זמין כשהאפליקציה מותקנת במסך הבית". The prompt is only requested inside the tap handler. |
| N7 | `pg_net` call failing must never fail the user's write. | `pg_net` is asynchronous (queued after commit); the trigger only enqueues. |
| N8 | `npm:web-push` relies on Node crypto in Deno. | Task 3 verifies with the in-app "שלח התראת ניסיון" before any trigger is enabled; fallback is `jsr:@negrel/webpush` (same VAPID keys). |
| N9 | Guest debtors/creditors have no profile → no recipient. | Only `*_profile_id` recipients are notified; guests are skipped by construction. |
| N10 | Lock-screen privacy (amounts visible). | Same information the recipient sees in the app; owner accepted by asking for the feature. Text is short. |
| N11 | A user with notifications on in two browsers gets two. | Correct: one per subscribed device. |

---

### Task 1: Database — subscriptions, log, RPCs (SQL file, applied with approval)

**Files:** Create `docs/backend/push-notifications.sql`; test `tests/push-notifications.test.cjs` (source assertions on the SQL file: RLS enabled, no anon grants, triggers' WHEN clauses).

```sql
BEGIN;
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint    text PRIMARY KEY,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_profile_idx ON push_subscriptions (profile_id);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON push_subscriptions FROM public, anon, authenticated;   -- only the RPCs and the function touch it

CREATE TABLE IF NOT EXISTS notification_log (
  event_key  text NOT NULL,
  profile_id uuid NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_key, profile_id)
);
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notification_log FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION app_save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_profile uuid := app_current_profile_id();
BEGIN
  IF v_profile IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '28000'; END IF;
  IF p_endpoint !~ '^https://' OR length(p_endpoint) > 1000 THEN RAISE EXCEPTION 'bad endpoint' USING ERRCODE = '22023'; END IF;
  INSERT INTO push_subscriptions (endpoint, profile_id, p256dh, auth, user_agent)
  VALUES (p_endpoint, v_profile, p_p256dh, p_auth, left(p_user_agent, 300))
  ON CONFLICT (endpoint) DO UPDATE SET profile_id = EXCLUDED.profile_id, p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, updated_at = now();
END $$;
CREATE OR REPLACE FUNCTION app_delete_push_subscription(p_endpoint text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM push_subscriptions WHERE endpoint = p_endpoint AND profile_id = app_current_profile_id();
$$;
REVOKE ALL ON FUNCTION app_save_push_subscription(text, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION app_delete_push_subscription(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION app_save_push_subscription(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_delete_push_subscription(text) TO authenticated;
COMMIT;
```

### Task 2: Edge Function `notify` (deployed from the dashboard, owner sets the VAPID secret)

**Files:** Create `supabase/functions/notify/index.ts` (kept in repo for review; deployed by pasting into the dashboard editor; excluded from Vercel by `.vercelignore`). Test: `tests/push-notifications.test.cjs` asserts the function never reads recipients from the request body and handles 404/410.

Behavior:
- `POST {kind, id}`; kinds: `game_opened`, `debt_created`, `debt_paid`, `friend_request`, `test`.
- `test`: requires the caller's own JWT (`Authorization: Bearer <access token>`), resolves the user via `supabase.auth.getUser(token)`, sends one "התראת ניסיון" to that user's subscriptions only.
- Others: read the row by id with the service role; build `{recipients[], title, body, url, eventKey}`:
  - `game_opened` (games): skip unless `phase='active'` and `started_at > now()-6h` and `group_id` set; recipients = active `group_members.profile_id` of the group minus `created_by`; title "נפתח שולחן ב{group}", body "{creator display_name} פתח משחק", url "/".
  - `debt_created` (debts): debtor_profile_id → "חייב ₪{amount} ל{creditor_name}"; creditor_profile_id → "{debtor_name} חייב לך ₪{amount}"; eventKey `debt:{id}:created`.
  - `debt_paid` (debts): skip unless `status='paid'`; debtor_profile_id (if ≠ paid_by_profile_id) → "{creditor_name} סימן שקיבל ₪{amount}".
  - `friend_request` (friendships): skip unless `status='pending'`; addressee → "בקשת חברות מ{requester display_name}".
- For each recipient: `INSERT INTO notification_log (event_key, profile_id) ... ON CONFLICT DO NOTHING RETURNING` — send only when a row was inserted (N1).
- Send to every subscription of the recipient with `webpush.sendNotification(sub, JSON.stringify({title, body, url, tag: eventKey}), {TTL: 3600})`; on `statusCode` 404/410 delete the subscription (N5).

### Task 3: Client — subscribe, settings row, service worker handlers, test notification

**Files:** `kupa-sgura.html` (settings overlay row "התראות", `VAPID_PUBLIC_KEY` const, `enablePushNotifications()`, `disablePushNotifications()`, `refreshPushRow()`, sign-out hook), `sw.js` (`push`, `notificationclick`), tests `tests/push-notifications.test.cjs` + `tests/service-worker.test.cjs`.

- `enablePushNotifications()` (only from the button's click): check support (N6) → `Notification.requestPermission()` → `navigator.serviceWorker.ready` → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) })` → `supabase.rpc("app_save_push_subscription", {...})` → row shows "פעיל" + "שלח התראת ניסיון".
- Test button: `fetch(FUNCTIONS_URL + "/notify", { method: "POST", headers: { Authorization: "Bearer " + session.access_token, apikey, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "test" }) })`.
- `signOutAccount`: before ending the session, `app_delete_push_subscription(endpoint)` and `subscription.unsubscribe()` (N4).
- `sw.js`:
  ```js
  self.addEventListener("push", (e) => {
    let data = {};
    try { data = e.data ? e.data.json() : {}; } catch (err) {}
    e.waitUntil(self.registration.showNotification(data.title || "סוגרים קופה", {
      body: data.body || "", tag: data.tag, icon: "icon-192.png", badge: "icon-192.png", data: { url: data.url || "./" },
    }));
  });
  self.addEventListener("notificationclick", (e) => {
    e.notification.close();
    const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
    e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) { c.navigate && c.navigate(url).catch(() => {}); return c.focus(); }
      return self.clients.openWindow(url);
    }));
  });
  ```
- Verification gate (N8): owner installs, turns on, taps the test button, receives it. Only then Task 4.

### Task 4: Triggers (SQL file, applied with approval after Task 3 is verified)

**Files:** Create `docs/backend/push-triggers.sql`.

```sql
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE OR REPLACE FUNCTION app_notify_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://aztfjlssjbjhxdqsflgn.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'apikey', '<publishable key, same as index.html>', 'Authorization', 'Bearer <publishable key>'),
    body := jsonb_build_object('kind', TG_ARGV[0], 'id', NEW.id),
    timeout_milliseconds := 5000);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_game_opened ON games;
CREATE TRIGGER notify_game_opened AFTER INSERT ON games FOR EACH ROW
  WHEN (NEW.phase = 'active' AND NEW.group_id IS NOT NULL) EXECUTE FUNCTION app_notify_event('game_opened');
DROP TRIGGER IF EXISTS notify_debt_created ON debts;
CREATE TRIGGER notify_debt_created AFTER INSERT ON debts FOR EACH ROW EXECUTE FUNCTION app_notify_event('debt_created');
DROP TRIGGER IF EXISTS notify_debt_paid ON debts;
CREATE TRIGGER notify_debt_paid AFTER UPDATE OF status ON debts FOR EACH ROW
  WHEN (OLD.status = 'open' AND NEW.status = 'paid') EXECUTE FUNCTION app_notify_event('debt_paid');
DROP TRIGGER IF EXISTS notify_friend_request ON friendships;
CREATE TRIGGER notify_friend_request AFTER INSERT ON friendships FOR EACH ROW
  WHEN (NEW.status = 'pending') EXECUTE FUNCTION app_notify_event('friend_request');
REVOKE ALL ON FUNCTION app_notify_event() FROM public, anon, authenticated;
```

Verification: open a group game on phone A → phone B (notifications on, app closed) is notified; close a game with a debt → both parties notified; creditor marks paid → debtor notified.
