// notify -- drains the notification outbox (docs/backend/push-notifications.sql).
//
// Deployed with verify_jwt = false: it is never called by a client, only by app_wake_notifier()
// through pg_net, which sends the Vault secret in `x-notify-secret`. A request without that secret
// is refused. The request body is ignored -- the only thing a call can do is send what the
// database triggers already queued (review finding P1).
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets), set by the owner:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. "mailto:owner@example.com")
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

type NotificationEvent = {
  id: number; recipient_id: string; kind: string; title: string; body: string; url: string; tag: string | null; attempts: number;
};

let cachedSecret: string | null = null;
async function notifySecret(): Promise<string | null> {
  if (cachedSecret) return cachedSecret;
  const { data, error } = await supabase.rpc("app_notify_secret");
  if (error || !data) return null;
  cachedSecret = String(data);
  return cachedSecret;
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function deliver(event: NotificationEvent) {
  const { data: subs, error } = await supabase
    .from("push_subscriptions").select("endpoint, p256dh, auth").eq("profile_id", event.recipient_id);
  if (error) return { status: "pending", error: "subscriptions: " + error.message };
  if (!subs || !subs.length) return { status: "skipped", error: "no subscriptions" };
  const payload = JSON.stringify({ title: event.title, body: event.body, url: event.url || "./", tag: event.tag || undefined });
  let accepted = 0;
  let retryable = 0;
  let lastError = "";
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600 });
      accepted++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode ?? 0;
      lastError = code + " " + String((err as Error).message || err).slice(0, 200);
      if (code === 404 || code === 410) {
        // The browser threw this subscription away: forget it (review finding N5).
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      } else if (code === 0 || code === 429 || code >= 500) {
        retryable++;
      }
    }
  }
  if (accepted) return { status: "sent", error: null };
  if (retryable && event.attempts < 5) return { status: "pending", error: lastError };
  return { status: "failed", error: lastError || "no subscription accepted" };
}

Deno.serve(async (req) => {
  const secret = await notifySecret();
  const given = req.headers.get("x-notify-secret") ?? "";
  if (!secret || !sameSecret(given, secret)) return new Response("forbidden", { status: 403 });

  let total = 0;
  for (let round = 0; round < 5; round++) {
    const { data: events, error } = await supabase.rpc("app_claim_notification_events", { p_limit: 50 });
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    if (!events || !events.length) break;
    let retryLater = false;
    for (const event of events as NotificationEvent[]) {
      const result = await deliver(event);
      if (result.status === "pending") retryLater = true;
      await supabase.from("notification_events").update({
        status: result.status,
        last_error: result.error,
        sent_at: result.status === "sent" ? new Date().toISOString() : null,
      }).eq("id", event.id);
      total++;
    }
    // A retryable failure waits for the next wake instead of burning its attempts in this run.
    if (retryLater) break;
  }
  return Response.json({ ok: true, processed: total });
});
