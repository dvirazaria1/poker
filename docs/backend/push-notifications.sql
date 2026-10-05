-- =====================================================================
-- push-notifications.sql -- Web Push via a server-side outbox (APPLIED 2026-10-05)
--
-- Plan: docs/superpowers/plans/2026-10-05-push-notifications.md, revised after the adversarial
-- review in .superpowers/codex-plans-review.md (P1-P9). The shape:
--
--   domain write (games / debts / friendships)
--     -> AFTER trigger computes WHO and WHAT, inserts rows into notification_events
--        (inside the same transaction; any failure is swallowed so the domain write never fails)
--     -> app_wake_notifier(): pg_net POST to the `notify` Edge Function with a secret header
--   notify (Edge Function, verify_jwt = false)
--     -> checks the header against the Vault secret (app_notify_secret, service_role only)
--     -> claims pending events (SKIP LOCKED), sends each to the recipient's subscriptions,
--        records sent / retry / failed per event, deletes 404/410 subscriptions
--
-- Why this shape (review findings):
--   P1/P9  no client can create an event or make the function send anything: events are written
--          only by triggers, and the wake call carries no data and needs a secret nobody types --
--          it is generated inside Vault below and read only by the service role.
--   P2     an event is marked sent only after a push service accepted it; retryable failures go
--          back to pending (max 5 attempts); a stuck claim is re-claimable after 2 minutes.
--   P6     every trigger body is wrapped in an exception block: notification trouble can never
--          abort a game, debt or friendship write.
--   P7     content is captured when the event happens; the debt's created and paid notifications
--          share one tag, so on the phone the newer replaces the older.
--   P3     subscription endpoints must be a known push service host; at most 5 per profile.
--   P5     recipients without a live auth.users row are skipped, and their subscriptions removed.
-- =====================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------- subscriptions ----------
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
REVOKE ALL ON push_subscriptions FROM public, anon, authenticated;
GRANT SELECT, DELETE ON push_subscriptions TO service_role;

-- ---------- the outbox ----------
CREATE TABLE IF NOT EXISTS notification_events (
  id            bigserial PRIMARY KEY,
  recipient_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  title         text NOT NULL,
  body          text NOT NULL,
  url           text NOT NULL DEFAULT './',
  tag           text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts      integer NOT NULL DEFAULT 0,
  claimed_at    timestamptz,
  sent_at       timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_events_pending_idx ON notification_events (id) WHERE status IN ('pending', 'sending');
ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notification_events FROM public, anon, authenticated;
GRANT SELECT, UPDATE ON notification_events TO service_role;

-- ---------- the wake secret: generated here, never typed, read only by the service role ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'notify_secret') THEN
    PERFORM vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'notify_secret');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_notify_secret() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notify_secret' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION app_notify_secret() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_notify_secret() TO service_role;

-- Fire-and-forget nudge to the sender. Carries nothing: the function only drains the outbox.
CREATE OR REPLACE FUNCTION app_wake_notifier() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://aztfjlssjbjhxdqsflgn.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', app_notify_secret()),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'app_wake_notifier: %', SQLERRM;
END $$;
REVOKE ALL ON FUNCTION app_wake_notifier() FROM public, anon, authenticated;

-- One event for one recipient, never for the person whose own action caused it.
CREATE OR REPLACE FUNCTION app_enqueue_notification(p_recipient uuid, p_kind text, p_title text, p_body text, p_tag text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_recipient IS NULL OR p_recipient = app_current_profile_id() THEN RETURN; END IF;
  INSERT INTO notification_events (recipient_id, kind, title, body, tag)
  VALUES (p_recipient, p_kind, left(p_title, 120), left(p_body, 240), p_tag);
END $$;
REVOKE ALL ON FUNCTION app_enqueue_notification(uuid, text, text, text, text) FROM public, anon, authenticated;

-- ---------- triggers ----------
CREATE OR REPLACE FUNCTION app_notify_game_opened() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_group text; v_creator text; r record;
BEGIN
  BEGIN
    SELECT name INTO v_group FROM groups WHERE id = NEW.group_id;
    SELECT display_name INTO v_creator FROM profiles WHERE id = NEW.created_by;
    FOR r IN SELECT DISTINCT profile_id FROM group_members
             WHERE group_id = NEW.group_id AND status = 'active' AND profile_id IS NOT NULL AND profile_id <> NEW.created_by
    LOOP
      PERFORM app_enqueue_notification(r.profile_id, 'game_opened', 'נפתח שולחן ב' || coalesce(v_group, 'קבוצה'),
        coalesce(v_creator, 'מישהו') || ' פתח משחק', 'game-' || NEW.id);
    END LOOP;
    PERFORM app_wake_notifier();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_notify_game_opened: %', SQLERRM;
  END;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app_notify_debt_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM app_enqueue_notification(NEW.debtor_profile_id, 'debt_created', 'נשאר חוב מהערב',
      'אתה חייב ₪' || NEW.amount || ' ל' || NEW.creditor_name, 'debt-' || NEW.id);
    PERFORM app_enqueue_notification(NEW.creditor_profile_id, 'debt_created', 'מגיע לך כסף',
      NEW.debtor_name || ' חייב לך ₪' || NEW.amount, 'debt-' || NEW.id);
    PERFORM app_wake_notifier();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_notify_debt_created: %', SQLERRM;
  END;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app_notify_debt_paid() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM app_enqueue_notification(NEW.debtor_profile_id, 'debt_paid', 'החוב סגור',
      NEW.creditor_name || ' סימן שקיבל ₪' || NEW.amount, 'debt-' || NEW.id);
    PERFORM app_wake_notifier();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_notify_debt_paid: %', SQLERRM;
  END;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app_notify_friend_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_name text;
BEGIN
  BEGIN
    SELECT display_name INTO v_name FROM profiles WHERE id = NEW.requester_profile_id;
    PERFORM app_enqueue_notification(NEW.addressee_profile_id, 'friend_request', 'בקשת חברות',
      coalesce(v_name, 'מישהו') || ' רוצה להיות חבר שלך', 'friend-' || NEW.id);
    PERFORM app_wake_notifier();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_notify_friend_request: %', SQLERRM;
  END;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION app_notify_game_opened() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION app_notify_debt_created() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION app_notify_debt_paid() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION app_notify_friend_request() FROM public, anon, authenticated;

-- A group table opened for real: active, and not an old game's history shell (those arrive as
-- 'settlement') nor a table started long ago and only now synced.
DROP TRIGGER IF EXISTS notify_game_opened ON games;
CREATE TRIGGER notify_game_opened AFTER INSERT ON games FOR EACH ROW
  WHEN (NEW.phase = 'active' AND NEW.group_id IS NOT NULL
        AND (NEW.started_at IS NULL OR NEW.started_at > now() - interval '6 hours'))
  EXECUTE FUNCTION app_notify_game_opened();
DROP TRIGGER IF EXISTS notify_debt_created ON debts;
CREATE TRIGGER notify_debt_created AFTER INSERT ON debts FOR EACH ROW
  WHEN (NEW.status = 'open')
  EXECUTE FUNCTION app_notify_debt_created();
DROP TRIGGER IF EXISTS notify_debt_paid ON debts;
CREATE TRIGGER notify_debt_paid AFTER UPDATE OF status ON debts FOR EACH ROW
  WHEN (OLD.status = 'open' AND NEW.status = 'paid')
  EXECUTE FUNCTION app_notify_debt_paid();
DROP TRIGGER IF EXISTS notify_friend_request ON friendships;
CREATE TRIGGER notify_friend_request AFTER INSERT ON friendships FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION app_notify_friend_request();

-- ---------- client RPCs ----------
-- Saving re-assigns the endpoint to whoever is signed in now (the device is the identity of a
-- subscription; a second account on the same phone takes it over). Only real push services.
CREATE OR REPLACE FUNCTION app_save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile uuid := app_current_profile_id(); v_host text;
BEGIN
  IF v_profile IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '28000'; END IF;
  v_host := lower(substring(p_endpoint from '^https://([^/:?#]+)/'));
  IF v_host IS NULL OR length(p_endpoint) > 1000 OR NOT (
       v_host = 'fcm.googleapis.com' OR v_host = 'web.push.apple.com' OR v_host LIKE '%.push.apple.com'
    OR v_host = 'updates.push.services.mozilla.com' OR v_host LIKE '%.notify.windows.com') THEN
    RAISE EXCEPTION 'unsupported push endpoint' USING ERRCODE = '22023';
  END IF;
  IF p_p256dh !~ '^[A-Za-z0-9_-]{80,100}$' OR p_auth !~ '^[A-Za-z0-9_-]{16,30}$' THEN
    RAISE EXCEPTION 'bad subscription keys' USING ERRCODE = '22023';
  END IF;
  INSERT INTO push_subscriptions (endpoint, profile_id, p256dh, auth, user_agent)
  VALUES (p_endpoint, v_profile, p_p256dh, p_auth, left(p_user_agent, 300))
  ON CONFLICT (endpoint) DO UPDATE SET profile_id = EXCLUDED.profile_id, p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, updated_at = now();
  -- At most five devices per account: the oldest go first.
  DELETE FROM push_subscriptions WHERE profile_id = v_profile AND endpoint IN (
    SELECT endpoint FROM push_subscriptions WHERE profile_id = v_profile ORDER BY updated_at DESC OFFSET 5);
END $$;

CREATE OR REPLACE FUNCTION app_delete_push_subscription(p_endpoint text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM push_subscriptions WHERE endpoint = p_endpoint AND profile_id = app_current_profile_id();
$$;

-- "Send me a test" -- through the same outbox and wake, so it proves the whole pipeline.
-- At most one per minute per account.
CREATE OR REPLACE FUNCTION app_send_test_notification()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile uuid := app_current_profile_id();
BEGIN
  IF v_profile IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '28000'; END IF;
  IF EXISTS (SELECT 1 FROM notification_events WHERE recipient_id = v_profile AND kind = 'test'
             AND created_at > now() - interval '1 minute') THEN
    RAISE EXCEPTION 'one test a minute' USING ERRCODE = '22023';
  END IF;
  INSERT INTO notification_events (recipient_id, kind, title, body, tag)
  VALUES (v_profile, 'test', 'סוגרים קופה', 'התראות עובדות 🎉', 'test');
  PERFORM app_wake_notifier();
END $$;

REVOKE ALL ON FUNCTION app_save_push_subscription(text, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION app_delete_push_subscription(text) FROM public, anon;
REVOKE ALL ON FUNCTION app_send_test_notification() FROM public, anon;
GRANT EXECUTE ON FUNCTION app_save_push_subscription(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_delete_push_subscription(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_send_test_notification() TO authenticated;

-- ---------- the sender's claim (service_role only) ----------
-- Pending events, plus any claim older than 2 minutes (a sender that died mid-run). Recipients
-- whose auth account is gone (app_delete_my_account keeps the scrubbed profile) are skipped and
-- their subscriptions removed.
CREATE OR REPLACE FUNCTION app_claim_notification_events(p_limit integer)
RETURNS SETOF notification_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM push_subscriptions s WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.profile_id);
  UPDATE notification_events e SET status = 'skipped', last_error = 'no live account'
    WHERE e.status IN ('pending', 'sending') AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = e.recipient_id);
  RETURN QUERY
  UPDATE notification_events e SET status = 'sending', claimed_at = now(), attempts = e.attempts + 1
  WHERE e.id IN (
    SELECT id FROM notification_events
    WHERE (status = 'pending' OR (status = 'sending' AND claimed_at < now() - interval '2 minutes'))
      AND attempts < 5
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(p_limit, 100)))
  RETURNING e.*;
END $$;
REVOKE ALL ON FUNCTION app_claim_notification_events(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_claim_notification_events(integer) TO service_role;

COMMIT;

-- Check (read-only): expect the three tables/functions to exist and no grants to anon.
-- SELECT has_function_privilege('anon', 'app_send_test_notification()', 'EXECUTE') AS anon_test,
--        has_function_privilege('authenticated', 'app_claim_notification_events(integer)', 'EXECUTE') AS user_claim;
