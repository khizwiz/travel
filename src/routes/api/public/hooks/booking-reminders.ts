import { createFileRoute } from "@tanstack/react-router";

/**
 * Booking reminder cron endpoint (runs daily around 09:00 local via pg_cron).
 * Sends a browser push to every registered push_subscription for bookings
 * whose start time falls in the next 24 hours, and for accommodations
 * whose check-in is tomorrow.
 */
export const Route = createFileRoute("/api/public/hooks/booking-reminders")({
  server: {
    handlers: {
      GET: () => new Response("ok"),
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Load VAPID keys from app_config
          const { data: vapidRow } = await supabaseAdmin
            .from("app_config").select("value").eq("key", "vapid_keys").maybeSingle();
          const keys = vapidRow?.value as unknown as { publicKey?: string; privateKey?: string } | null;
          if (!keys?.publicKey || !keys?.privateKey) {
            return json({ ok: false, reason: "no-vapid" }, 200);
          }

          const now = new Date();
          const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          const tomorrowIso = in24h.toISOString().slice(0, 10);

          const { data: bookings } = await supabaseAdmin
            .from("bookings")
            .select("id, kind, provider, reference, starts_at, notes")
            .gte("starts_at", now.toISOString())
            .lte("starts_at", in24h.toISOString());

          const { data: accs } = await supabaseAdmin
            .from("accommodations")
            .select("id, name, area_public, check_in")
            .gte("check_in", `${tomorrowIso}T00:00:00Z`)
            .lt("check_in", `${tomorrowIso}T23:59:59Z`);

          type Reminder = { title: string; body: string; url: string };
          const reminders: Reminder[] = [];
          for (const b of bookings ?? []) {
            const when = new Date(b.starts_at as string);
            reminders.push({
              title: `Tomorrow: ${b.provider ?? b.kind ?? "Booking"}`,
              body: `${b.kind?.toUpperCase() ?? "Trip"} Â· ${when.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}${b.reference ? ` Â· ref ${b.reference}` : ""}`,
              url: "/bookings",
            });
          }
          for (const a of accs ?? []) {
            reminders.push({
              title: `Check-in tomorrow: ${a.name ?? "Hotel"}`,
              body: a.area_public ?? "Check-in reminder",
              url: "/itinerary",
            });
          }
          if (reminders.length === 0) return json({ ok: true, sent: 0, note: "no upcoming" });

          const { data: subs } = await supabaseAdmin
            .from("push_subscriptions")
            .select("id, endpoint, p256dh, auth_key");
          if (!subs || subs.length === 0) return json({ ok: true, sent: 0, note: "no subs" });

          const webpush = (await import("web-push")).default;
          webpush.setVapidDetails("mailto:owner@example.com", keys.publicKey, keys.privateKey);

          let sent = 0;
          const errors: string[] = [];
          for (const s of subs) {
            for (const r of reminders) {
              try {
                await webpush.sendNotification(
                  { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
                  JSON.stringify(r),
                );
                sent += 1;
              } catch (e) {
                const err = e as { statusCode?: number; message?: string };
                errors.push(`${err.statusCode ?? "?"} ${err.message ?? ""}`);
                if (err.statusCode === 404 || err.statusCode === 410) {
                  await supabaseAdmin.from("push_subscriptions").delete().eq("id", s.id);
                }
              }
            }
          }
          return json({ ok: true, sent, reminders: reminders.length, errors: errors.slice(0, 5) });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return json({ ok: false, error: msg }, 500);
        }
      },
    },
  },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
