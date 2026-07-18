import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// List all itinerary days for the default trip so admins can pick one when
// posting a photo to the Story feed.
export const listOwnerTripDays = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: trip } = await context.supabase
      .from("trips").select("id").eq("slug", "eu-tripping-2026").maybeSingle();
    if (!trip) return [];
    const { data, error } = await context.supabase
      .from("itinerary_days")
      .select("id, day_date, title")
      .eq("trip_id", trip.id)
      .order("day_date", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listDestinationPhotos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tripId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("destination_photos")
      .select("id, day_id, storage_path, caption, is_cover, created_at, itinerary_days!inner(trip_id, day_date, title)")
      .eq("itinerary_days.trip_id", data.tripId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    // Sign each URL (60min)
    const out: any[] = [];
    for (const r of rows ?? []) {
      const { data: signed } = await context.supabase.storage
        .from("destination-photos").createSignedUrl(r.storage_path, 3600);
      out.push({ ...r, signedUrl: signed?.signedUrl ?? null });
    }
    return out;
  });

// Public read of destination photos for the default trip. Anyone can view.
export const listPublicDestinationPhotos = createServerFn({ method: "GET" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: trip } = await supabaseAdmin
      .from("trips").select("id").eq("slug", "eu-tripping-2026").maybeSingle();
    if (!trip) return [];
    const { data: rows, error } = await supabaseAdmin
      .from("destination_photos")
      .select("*, itinerary_days!inner(trip_id, day_date, title)")
      .eq("itinerary_days.trip_id", trip.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const out: any[] = [];
    for (const r of rows ?? []) {
      const { data: signed } = await supabaseAdmin.storage
        .from("destination-photos").createSignedUrl(r.storage_path, 3600);
      out.push({ ...r, signedUrl: signed?.signedUrl ?? null });
    }
    return out;
  });

export const createDestinationPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    dayId: z.string().uuid(),
    storagePath: z.string().min(1).max(500),
    caption: z.string().trim().max(300).optional().nullable(),
    isCover: z.boolean().optional(),
    lat: z.number().min(-90).max(90).optional().nullable(),
    lng: z.number().min(-180).max(180).optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.isCover) {
      await context.supabase.from("destination_photos")
        .update({ is_cover: false }).eq("day_id", data.dayId);
    }
    const base = {
      day_id: data.dayId,
      storage_path: data.storagePath,
      caption: data.caption ?? null,
      is_cover: data.isCover ?? false,
      uploaded_by: context.userId,
    };
    // Include GPS if provided; retry without it if the lat/lng migration
    // hasn't been applied yet so uploads never break on schema drift.
    const withGeo = data.lat != null && data.lng != null
      ? { ...base, lat: data.lat, lng: data.lng }
      : base;
    let { data: row, error } = await context.supabase
      .from("destination_photos").insert(withGeo).select("id").single();
    if (error && withGeo !== base && /column/i.test(error.message)) {
      ({ data: row, error } = await context.supabase
        .from("destination_photos").insert(base).select("id").single());
    }
    if (error || !row) throw new Error(error?.message ?? "Insert failed");
    return { id: row.id };
  });

export const deleteDestinationPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("destination_photos").select("storage_path").eq("id", data.id).maybeSingle();
    if (row?.storage_path) {
      await context.supabase.storage.from("destination-photos").remove([row.storage_path]);
    }
    const { error } = await context.supabase.from("destination_photos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
