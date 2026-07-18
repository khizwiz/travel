import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

function vapidSubject(): string {
  return `mailto:${process.env.OWNER_EMAIL ?? "owner@example.com"}`;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

async function loadOrCreateVapid(): Promise<VapidKeys> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row } = await supabaseAdmin
    .from("app_config")
    .select("value")
    .eq("key", "vapid_keys")
    .maybeSingle();
  const raw = row?.value as unknown as Partial<VapidKeys> | undefined;
  if (raw?.publicKey && raw?.privateKey) {
    return { publicKey: raw.publicKey, privateKey: raw.privateKey };
  }
  // Generate fresh VAPID keys.
  const webpush = (await import("web-push")).default;
  const keys = webpush.generateVAPIDKeys();
  await supabaseAdmin
    .from("app_config")
    .upsert({ key: "vapid_keys", value: keys as unknown as Record<string, string>, updated_at: new Date().toISOString() });
  return keys;
}

/** Public — anyone can read the public key (needed to subscribe). */
export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  const keys = await loadOrCreateVapid();
  return { publicKey: keys.publicKey };
});

const subInput = z.object({
  endpoint: z.string().url().max(2048),
  p256dh: z.string().min(10).max(512),
  authKey: z.string().min(10).max(512),
  label: z.string().trim().max(120).optional(),
});

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => subInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: context.userId,
          endpoint: data.endpoint,
          p256dh: data.p256dh,
          auth_key: data.authKey,
          label: data.label ?? null,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ endpoint: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", data.endpoint)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMyPushSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("push_subscriptions")
      .select("id, endpoint, label, created_at, last_used_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const sendInput = z.object({
  title: z.string().trim().min(1).max(80).default("Tripping"),
  body: z.string().trim().min(1).max(300),
  url: z.string().trim().max(500).optional(),
});

/** Owner-only: send a push to every device this user has registered. */
export const sendTestPushToMe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sendInput.parse(d))
  .handler(async ({ data, context }) => {
    const keys = await loadOrCreateVapid();
    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails(vapidSubject(), keys.publicKey, keys.privateKey);

    const { data: subs, error } = await context.supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth_key")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    if (!subs || subs.length === 0) {
      return { sent: 0, errors: ["No devices registered for this user yet."] };
    }

    const payload = JSON.stringify({
      title: data.title,
      body: data.body,
      url: data.url ?? "/",
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let sent = 0;
    const errors: string[] = [];
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
          payload,
        );
        sent += 1;
        await supabaseAdmin
          .from("push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", s.id);
      } catch (e) {
        const err = e as { statusCode?: number; message?: string };
        errors.push(`${err.statusCode ?? "?"} ${err.message ?? "send failed"}`);
        // 404/410 = subscription gone, purge it.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabaseAdmin.from("push_subscriptions").delete().eq("id", s.id);
        }
      }
    }
    return { sent, errors };
  });
