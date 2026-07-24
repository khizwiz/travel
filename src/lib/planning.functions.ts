import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function ensureOwner(supabase: any, userId: string, tripId: string) {
  const { data: trip } = await supabase
    .from("trips").select("owner_id").eq("id", tripId).single();
  if (!trip || trip.owner_id !== userId) throw new Error("Forbidden");
}

// List itinerary_days within a date range (owner).
export const listPlanDays = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    tripId: z.string().uuid(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("itinerary_days")
      .select(`
        id, day_date, title, summary_public, summary_private,
        distance_km, duration_min, leg, day_kind,
        accommodations ( id, name, area_public, address_private, check_in, check_out, booking_ref, cost, currency, notes, missing, lat, lng )
      `)
      .eq("trip_id", data.tripId)
      .gte("day_date", data.from)
      .lte("day_date", data.to)
      .order("day_date", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// Public list of saved accommodations for the default trip. Returns only public-safe fields.
export const listPublicAccommodations = createServerFn({ method: "GET" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: trip } = await supabaseAdmin
      .from("trips").select("id").eq("slug", "eu-tripping-2026").maybeSingle();
    if (!trip) return [];
    // PUBLIC endpoint: never expose booking references, prices, or private
    // notes — RLS deliberately restricts those to trip members.
    //
    // Plain queries joined in code: the embedded `itinerary_days!inner(...)`
    // this replaced fails silently on this schema (CLAUDE.md), so the filter
    // did not filter and `r.itinerary_days` came back undefined — every stay
    // rendered with a null date.
    const { data: days, error: dErr } = await supabaseAdmin
      .from("itinerary_days")
      .select("id, day_date")
      .eq("trip_id", trip.id);
    if (dErr) throw new Error(dErr.message);
    const dayById = new Map((days ?? []).map((d) => [d.id as string, d]));
    if (dayById.size === 0) return [];

    const { data, error } = await supabaseAdmin
      .from("accommodations")
      .select("id, name, area_public, check_in, check_out, day_id")
      .in("day_id", Array.from(dayById.keys()));
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      day_date: dayById.get(r.day_id)?.day_date ?? null,
      name: r.name,
      area_public: r.area_public,
      check_in: r.check_in,
      check_out: r.check_out,
      booking_ref: null,
      cost: null,
      currency: null,
      notes: null,
    }));
  });

const UpsertDayInput = z.object({
  tripId: z.string().uuid(),
  dayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().max(160).optional().nullable(),
  summaryPublic: z.string().trim().max(1000).optional().nullable(),
  summaryPrivate: z.string().trim().max(2000).optional().nullable(),
  distanceKm: z.number().nonnegative().nullable().optional(),
  durationMin: z.number().int().nonnegative().nullable().optional(),
  fromLabel: z.string().trim().max(120).optional().nullable(),
  toLabel: z.string().trim().max(120).optional().nullable(),
  transport: z.enum(["drive", "flight", "ferry", "mixed", "rest"]).optional().nullable(),
  dayKind: z.enum(["destination", "rest", "open", "empty"]).optional().nullable(),
});

export const upsertPlanDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpsertDayInput.parse(d))
  .handler(async ({ data, context }) => {
    await ensureOwner(context.supabase, context.userId, data.tripId);
    const leg = {
      from: data.fromLabel ?? null,
      to: data.toLabel ?? null,
      transport: data.transport ?? null,
    };
    const { data: existing } = await context.supabase
      .from("itinerary_days").select("id")
      .eq("trip_id", data.tripId).eq("day_date", data.dayDate).maybeSingle();
    const payload: any = {
      trip_id: data.tripId,
      day_date: data.dayDate,
      title: data.title ?? null,
      summary_public: data.summaryPublic ?? null,
      summary_private: data.summaryPrivate ?? null,
      distance_km: data.distanceKm ?? null,
      duration_min: data.durationMin ?? null,
      leg,
      day_kind: data.dayKind ?? "destination",
    };
    if (existing?.id) {
      const { error } = await context.supabase.from("itinerary_days").update(payload).eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { id: existing.id };
    }
    const { data: row, error } = await context.supabase
      .from("itinerary_days").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

const UpsertAccomInput = z.object({
  tripId: z.string().uuid(),
  dayId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  areaPublic: z.string().trim().max(200).optional().nullable(),
  addressPrivate: z.string().trim().max(500).optional().nullable(),
  checkIn: z.string().optional().nullable(),
  checkOut: z.string().optional().nullable(),
  bookingRef: z.string().trim().max(120).optional().nullable(),
  cost: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().max(8).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const upsertAccommodation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpsertAccomInput.parse(d))
  .handler(async ({ data, context }) => {
    await ensureOwner(context.supabase, context.userId, data.tripId);
    const { data: existing } = await context.supabase
      .from("accommodations").select("id").eq("day_id", data.dayId).maybeSingle();
    const payload: any = {
      day_id: data.dayId,
      name: data.name,
      area_public: data.areaPublic ?? null,
      address_private: data.addressPrivate ?? null,
      check_in: data.checkIn ?? null,
      check_out: data.checkOut ?? null,
      booking_ref: data.bookingRef ?? null,
      cost: data.cost ?? null,
      currency: data.currency ?? "EUR",
      notes: data.notes ?? null,
      missing: false,
    };
    if (existing?.id) {
      const { error } = await context.supabase.from("accommodations").update(payload).eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { id: existing.id };
    }
    const { data: row, error } = await context.supabase
      .from("accommodations").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deletePlanDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tripId: z.string().uuid(), id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await ensureOwner(context.supabase, context.userId, data.tripId);
    const { error } = await context.supabase.from("itinerary_days").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
