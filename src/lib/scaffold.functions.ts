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

    const summary = { tripCreated: false, daysInserted: 0, bucketCreated: false };

    // 1. Default trip row
    let { data: trip } = await supabaseAdmin
      .from("trips").select("id").eq("slug", "eu-tripping-2026").maybeSingle();
    if (!trip) {
      const { data: created, error } = await supabaseAdmin
        .from("trips")
        .insert({
          name: "Tripping — Istanbul and back",
          slug: "eu-tripping-2026",
          owner_id: userId,
          starts_on: ITINERARY[0]?.date ?? "2026-07-18",
          ends_on: ITINERARY[ITINERARY.length - 1]?.date ?? "2026-08-27",
          public_tracking_enabled: true,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      trip = created;
      summary.tripCreated = true;
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

    // 3. Storage bucket for story photos
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    if (!(buckets ?? []).some((b) => b.name === "destination-photos")) {
      const { error } = await supabaseAdmin.storage.createBucket("destination-photos", {
        public: false,
      });
      if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
      summary.bucketCreated = true;
    }

    return summary;
  });
