import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getDefaultTrip } from "@/lib/access.functions";

const pointInput = z.object({
  tripId: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100000).optional(),
  speedKmh: z.number().min(0).max(400).optional(),
  headingDeg: z.number().min(0).max(360).optional(),
  altitudeM: z.number().optional(),
  ts: z.string().optional(),
  isParked: z.boolean().optional(),
});

export const recordLocationPoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => pointInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Only the trip owner's device lays down the trail.
    //
    // The trail is the app's record of where the truck actually went — it
    // feeds driven distance, the fuel gauge and the route on the map. Anyone
    // else signed in, on a phone in another country, would write points that
    // read as impossible jumps and corrupt all three. The documented tracker
    // is the owner's phone, so enforce exactly that rather than accepting a
    // fix from every member who happens to have location switched on.
    const { data: trip } = await supabase
      .from("trips").select("owner_id").eq("id", data.tripId).maybeSingle();
    if (!trip || trip.owner_id !== userId) {
      // Not an error the caller should act on — their device simply is not the
      // tracker. Silently accept so a member's app does not sit retrying.
      return { ok: true, recorded: false };
    }

    const { error } = await supabase.from("location_points").insert({
      trip_id: data.tripId,
      user_id: userId,
      lat: data.lat,
      lng: data.lng,
      accuracy_m: data.accuracyM ?? null,
      speed_kph: data.speedKmh ?? null,
      ts: data.ts ?? new Date().toISOString(),
      is_parked: data.isParked ?? false,
    });
    if (error) throw new Error(error.message);
    return { ok: true, recorded: true };
  });

// Owner-only: wipe recent trail points (bad fixes, e.g. a laptop's IP-derived
// city-centre guess). The next real GPS fix repopulates the position.
export const clearRecentLocationPoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ tripId: z.string().uuid(), hours: z.number().min(1).max(168).default(24) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: trip } = await supabase
      .from("trips").select("owner_id").eq("id", data.tripId).single();
    if (!trip || trip.owner_id !== userId) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cutoff = new Date(Date.now() - data.hours * 3600_000).toISOString();
    const { error, count } = await supabaseAdmin
      .from("location_points")
      .delete({ count: "exact" })
      .eq("trip_id", data.tripId)
      .gte("ts", cutoff);
    if (error) throw new Error(error.message);
    return { deleted: count ?? 0 };
  });

export const getLatestLocation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tripId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("location_points")
      .select("lat, lng, ts, accuracy_m, speed_kph")
      .eq("trip_id", data.tripId)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();
    return row;
  });

// Re-export so a single import on tracking page is enough
export { getDefaultTrip };

// Public: coarse-rounded (~1km) latest location for the default trip.
// Reads via admin client to bypass RLS, but only exposes rounded coordinates.
export const getPublicLatestLocation = createServerFn({ method: "GET" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: trip } = await supabaseAdmin
      .from("trips")
      .select("id, public_tracking_enabled")
      .eq("slug", "eu-tripping-2026")
      .maybeSingle();
    if (!trip || !trip.public_tracking_enabled) return null;
    const { data: row } = await supabaseAdmin
      .from("location_points")
      .select("lat, lng, ts")
      .eq("trip_id", trip.id)
      .eq("is_parked", false)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!row) return null;
    return {
      lat: Math.round(row.lat * 100) / 100,
      lng: Math.round(row.lng * 100) / 100,
      ts: row.ts,
    };
  });
