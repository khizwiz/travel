import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ITINERARY } from "@/lib/trip-data";

/**
 * Owner-only, idempotent bootstrap for a FRESH database: creates whatever is
 * missing so the app works end-to-end — the default trip row, itinerary days
 * seeded from the static plan, and the destination-photos storage bucket.
 * Safe to call repeatedly; it only fills gaps and never overwrites data.
 */
export const ensureTripScaffold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Only the app owner may scaffold.
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles").select("role")
      .eq("user_id", userId).eq("role", "owner").maybeSingle();
    if (!roleRow) throw new Error("Owner only");

    const summary = { tripCreated: false, daysInserted: 0, bucketsCreated: [] as string[] };

    // 1. Default trip row. public_slug matters: every anon RLS policy
    // (public feed, comments, photos) requires it to be NOT NULL.
    let { data: trip } = await supabaseAdmin
      .from("trips").select("id, public_slug").eq("slug", "eu-tripping-2026").maybeSingle();
    if (!trip) {
      const { data: created, error } = await supabaseAdmin
        .from("trips")
        .insert({
          name: "Tripping — Istanbul and back",
          slug: "eu-tripping-2026",
          public_slug: "eu-tripping",
          owner_id: userId,
          starts_on: ITINERARY[0]?.date ?? "2026-07-18",
          ends_on: ITINERARY[ITINERARY.length - 1]?.date ?? "2026-08-27",
          public_tracking_enabled: true,
        })
        .select("id, public_slug")
        .single();
      if (error) throw new Error(error.message);
      trip = created;
      summary.tripCreated = true;
    } else if (!trip.public_slug) {
      await supabaseAdmin.from("trips").update({ public_slug: "eu-tripping" }).eq("id", trip.id);
    }

    // 2. Itinerary days — insert only missing dates, from the static plan.
    const { data: existingDays } = await supabaseAdmin
      .from("itinerary_days").select("day_date").eq("trip_id", trip.id);
    const have = new Set((existingDays ?? []).map((d) => d.day_date));
    const missing = ITINERARY.filter((d) => !have.has(d.date)).map((d) => ({
      trip_id: trip!.id,
      day_date: d.date,
      title: !d.to || d.from === d.to ? d.from : `${d.from} → ${d.to}`,
      day_kind: (d.kind === "rest" || d.kind === "open" || d.kind === "empty"
        ? d.kind
        : "destination") as "destination" | "rest" | "open" | "empty",
      distance_km: d.distanceKm ?? null,
      duration_min: d.durationMin ?? null,
      leg: { from: d.from, to: d.to, transport: d.transport },
    }));
    if (missing.length > 0) {
      const { error } = await supabaseAdmin.from("itinerary_days").insert(missing);
      if (error) throw new Error(error.message);
      summary.daysInserted = missing.length;
    }

    // 3. Storage buckets the app uploads into (all private; access via
    // signed URLs / RLS policies that already exist in the migrations).
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const haveBuckets = new Set((buckets ?? []).map((b) => b.name));
    for (const name of ["destination-photos", "documents", "receipts"]) {
      if (haveBuckets.has(name)) continue;
      const { error } = await supabaseAdmin.storage.createBucket(name, { public: false });
      if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
      summary.bucketsCreated.push(name);
    }

    return summary;
  });
