import { createFileRoute } from "@tanstack/react-router";
import { aiModel, aiUrl, lovableAiHeaders } from "@/lib/ai-gateway.server";

/**
 * Daily AI-issued badge cron endpoint.
 *
 * pg_cron POSTs here once a day. We pick the current itinerary day, ask
 * Lovable AI to invent a small, playful badge for the moment, insert it
 * into `public.badges`, and award it to the trip owner via `user_badges`.
 * Idempotent per (trip, ISO date) — if today's badge already exists we
 * return `skipped`.
 */
export const Route = createFileRoute("/api/public/hooks/daily-badge")({
  server: {
    handlers: {
      GET: () => new Response("ok"),
      POST: async ({ request }: { request: Request }) => {
        // If CRON_SECRET is configured, callers must present it — the endpoint
        // burns AI credits per call and is otherwise open.
        const secret = process.env.CRON_SECRET;
        if (secret && request.headers.get("x-cron-secret") !== secret) {
          return new Response("forbidden", { status: 403 });
        }
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: trip } = await supabaseAdmin
            .from("trips")
            .select("id, owner_id, slug, starts_on, ends_on")
            .eq("slug", "eu-tripping-2026")
            .maybeSingle();
          if (!trip?.owner_id) return json({ ok: false, reason: "no-trip" }, 200);

          const today = new Date().toISOString().slice(0, 10);
          const dailyCode = `daily-${today}`;

          const { data: existing } = await supabaseAdmin
            .from("badges").select("id").eq("code", dailyCode).maybeSingle();
          if (existing?.id) return json({ ok: true, skipped: true, code: dailyCode });

          const { data: day } = await supabaseAdmin
            .from("itinerary_days")
            .select("title, leg, day_date, day_kind")
            .eq("trip_id", trip.id)
            .eq("day_date", today)
            .maybeSingle();

          const context = day
            ? `Today ${today}: ${day.title ?? ""} (${JSON.stringify(day.leg ?? {})}).`
            : `Today ${today}: no active itinerary day.`;

          const key =
            process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY || process.env.LOVABLE_API_KEY;
          let name = "Another day on the road";
          let description = "Kept the wheels turning.";
          let icon = "🏅";
          if (key) {
            try {
              const r = await fetch(aiUrl(), {
                method: "POST",
                headers: lovableAiHeaders(),
                body: JSON.stringify({
                  model: aiModel(),
                  messages: [
                    { role: "system", content:
                      "Invent a tiny playful travel badge for a road-trip journal. Return JSON only: {name, description, icon}. Name 3–5 words, description 1 short sentence, icon a single emoji." },
                    { role: "user", content: context },
                  ],
                  response_format: { type: "json_object" },
                  temperature: 0.9,
                }),
              });
              if (r.ok) {
                const j: any = await r.json();
                const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
                if (parsed.name) name = String(parsed.name).slice(0, 60);
                if (parsed.description) description = String(parsed.description).slice(0, 160);
                if (parsed.icon) icon = String(parsed.icon).slice(0, 4);
              }
            } catch (e) {
              console.error("[daily-badge] AI failed", e);
            }
          }

          const { data: badge, error: bErr } = await supabaseAdmin
            .from("badges")
            .insert({ code: dailyCode, name, description, icon })
            .select("id").single();
          if (bErr) return json({ ok: false, error: bErr.message }, 500);

          await supabaseAdmin.from("user_badges").insert({
            user_id: trip.owner_id, trip_id: trip.id, badge_id: badge.id,
          });
          return json({ ok: true, code: dailyCode, name, icon });
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
