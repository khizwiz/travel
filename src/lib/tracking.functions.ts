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
    return { ok: true };
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
