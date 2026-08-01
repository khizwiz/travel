import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { aiModel, aiUrl, lovableAiHeaders } from "./ai-gateway.server";
import { assertTripOwner } from "@/lib/trip-owner.server";

const TRIP_SLUG = "eu-tripping-2026";

async function getOwnedTripId(supabase: any, userId: string) {
  const { data: trip } = await supabase
    .from("trips").select("id, owner_id").eq("slug", TRIP_SLUG).maybeSingle();
  if (!trip) throw new Error("Trip not found");
  // See trip-owner.server.ts — this is what stopped the owner re-planning a
  // day from the itinerary.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await assertTripOwner(supabaseAdmin, userId, trip.id as string);
  return trip.id as string;
}

// Public read: returns any owner-saved reroute rows overlaid onto the seeded itinerary.
export const listPublicPlanOverrides = createServerFn({ method: "GET" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: trip } = await supabaseAdmin
      .from("trips").select("id").eq("slug", TRIP_SLUG).maybeSingle();
    if (!trip) return [];
    const { data, error } = await supabaseAdmin
      .from("itinerary_days")
      .select("day_date, title, summary_public, distance_km, duration_min, leg, day_kind")
      .eq("trip_id", trip.id)
      .order("day_date", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      day_date: r.day_date as string,
      title: r.title as string | null,
      summary: r.summary_public as string | null,
      distance_km: r.distance_km as number | null,
      duration_min: r.duration_min as number | null,
      from: (r.leg?.from ?? null) as string | null,
      to: (r.leg?.to ?? null) as string | null,
      transport: (r.leg?.transport ?? null) as string | null,
      day_kind: r.day_kind as string | null,
    }));
  });

const SuggestInput = z.object({
  dayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currentFrom: z.string().trim().max(120),
  originalTo: z.string().trim().max(120).optional().nullable(),
  freeText: z.string().trim().max(500).optional().nullable(),
  nextFixedStop: z.string().trim().max(120).optional().nullable(),
});

const SYSTEM = `You are the re-route helper for a European road-trip journal.
The driver may want to swap today's destination on the fly.
Return STRICTLY a JSON object of the shape:
{"options":[{"to":"City, Country","transport":"drive|rest","distanceKm":number,"durationMin":number,"why":"short reason (max 90 chars)"}]}
Give 2-3 options, mixing: stay put / short detour / push further. Be realistic about driving distance and time in Europe. No prose outside JSON.`;

export const suggestReroute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SuggestInput.parse(d))
  .handler(async ({ data, context }) => {
    await getOwnedTripId(context.supabase, context.userId);
    const userMsg = [
      `Date: ${data.dayDate}`,
      `Currently in: ${data.currentFrom}`,
      data.originalTo ? `Originally planned to: ${data.originalTo}` : null,
      data.nextFixedStop ? `Next fixed stop on the calendar: ${data.nextFixedStop}` : null,
      data.freeText ? `Driver says: "${data.freeText}"` : `Driver has not said where they want to go — suggest 3 sensible options.`,
    ].filter(Boolean).join("\n");
    try {
      const r = await fetch(aiUrl(), {
        method: "POST",
        headers: lovableAiHeaders(),
        body: JSON.stringify({
          model: aiModel(),
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userMsg },
          ],
          temperature: 0.5,
          response_format: { type: "json_object" },
        }),
      });
      if (r.status === 429) return { error: "Rate limited — try again in a moment." };
      if (r.status === 402) return { error: "AI credits exhausted." };
      if (!r.ok) return { error: `AI error (${r.status})` };
      const j: any = await r.json();
      const raw = j.choices?.[0]?.message?.content?.trim() ?? "{}";
      let parsed: any = {};
      try { parsed = JSON.parse(raw); } catch { parsed = {}; }
      const options = Array.isArray(parsed.options) ? parsed.options.slice(0, 3) : [];
      return { options } as {
        options: { to: string; transport: string; distanceKm: number; durationMin: number; why: string }[];
      };
    } catch (e: any) {
      return { error: e?.message ?? "Suggestion failed" };
    }
  });

const ApplyInput = z.object({
  dayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  from: z.string().trim().min(1).max(120),
  to: z.string().trim().min(1).max(120),
  transport: z.enum(["drive", "flight", "ferry", "mixed", "rest"]).default("drive"),
  distanceKm: z.number().nonnegative().nullable().optional(),
  durationMin: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const applyReroute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ApplyInput.parse(d))
  .handler(async ({ data, context }) => {
    const tripId = await getOwnedTripId(context.supabase, context.userId);
    const payload: any = {
      trip_id: tripId,
      day_date: data.dayDate,
      title: `Re-routed: ${data.to}`,
      summary_public: data.notes ?? null,
      distance_km: data.distanceKm ?? null,
      duration_min: data.durationMin ?? null,
      leg: { from: data.from, to: data.to, transport: data.transport },
      day_kind: data.transport === "rest" ? "rest" : "destination",
    };
    const { data: existing } = await context.supabase
      .from("itinerary_days").select("id")
      .eq("trip_id", tripId).eq("day_date", data.dayDate).maybeSingle();
    if (existing?.id) {
      const { error } = await context.supabase
        .from("itinerary_days").update(payload).eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: existing.id };
    }
    const { data: row, error } = await context.supabase
      .from("itinerary_days").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

export const clearReroute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ dayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const tripId = await getOwnedTripId(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("itinerary_days").delete()
      .eq("trip_id", tripId).eq("day_date", data.dayDate);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
