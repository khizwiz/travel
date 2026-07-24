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

export interface StoryPhoto {
  id: string;
  post_id: string | null;
  caption: string | null;
  is_cover: boolean;
  created_at: string;
  /** Coarse (~1 km) position, or null. Never the exact spot — see below. */
  lat: number | null;
  lng: number | null;
  signedUrl: string | null;
  /** Shape kept so the story timeline can group by day without a join. */
  itinerary_days: { day_date: string | null; title: string | null } | null;
}

const PHOTO_LIMIT = 200;
const SIGNED_URL_TTL_S = 3600;

/**
 * The public story feed.
 *
 * Rewritten away from `.select("*, itinerary_days!inner(...)")`. PostgREST
 * relation joins fail silently on this schema (see CLAUDE.md), which here does
 * not throw — it returns rows with no embedded day, so every photo fell into
 * the "0000-00-00" bucket and the timeline collapsed into one nameless "On the
 * road" heading. Plain queries, joined in code.
 *
 * Three other things this endpoint used to get wrong, all of them because it
 * returned the raw row:
 *
 *  - It shipped exact photo coordinates to anonymous visitors. The permission
 *    matrix blurs a visitor's view of where the family is — `getPublicLatest-
 *    Location` rounds to ~1 km and `getRouteTrail` is member-only precisely
 *    because an exact trail exposes every overnight stop. A photo taken at the
 *    accommodation gave away that address exactly. Rounded to match.
 *  - It shipped `storage_path` and `uploaded_by`, which the feed never needs.
 *  - It ignored post visibility entirely, so hiding a post left its photo on
 *    the public feed. `listPublicComments` already gates on this.
 */
export const listPublicDestinationPhotos = createServerFn({ method: "GET" })
  .handler(async (): Promise<StoryPhoto[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: trip } = await supabaseAdmin
      .from("trips").select("id").eq("slug", "eu-tripping-2026").maybeSingle();
    if (!trip) return [];

    const { data: days, error: dErr } = await supabaseAdmin
      .from("itinerary_days")
      .select("id, day_date, title")
      .eq("trip_id", trip.id);
    if (dErr) throw new Error(dErr.message);
    const dayById = new Map((days ?? []).map((d) => [d.id as string, d]));
    if (dayById.size === 0) return [];

    // `select("*")` on purpose. lat/lng come from the photo_geo migration and
    // are absent from the checked-in generated types, so naming them here both
    // fails typecheck and 400s outright if that migration has not reached this
    // database. A star select returns whatever the schema actually has, and
    // the shaping below reads the geo columns only if they came back.
    const { data: rawRows, error } = await supabaseAdmin
      .from("destination_photos")
      .select("*")
      .in("day_id", Array.from(dayById.keys()))
      .order("created_at", { ascending: false })
      .limit(PHOTO_LIMIT);
    if (error) throw new Error(error.message);
    const rows = (rawRows ?? []) as Array<Record<string, unknown>>;
    if (!rows.length) return [];

    // Only photos whose companion post is still public and active. The insert
    // trigger creates them public, so this hides exactly what the owner hid.
    const postIds = rows
      .map((r) => r.post_id)
      .filter((v): v is string => typeof v === "string" && !!v);
    const visible = new Set<string>();
    if (postIds.length) {
      const { data: posts } = await supabaseAdmin
        .from("posts")
        .select("id, visibility, status")
        .in("id", postIds);
      for (const p of posts ?? []) {
        if (p.visibility === "public" && p.status === "active") visible.add(p.id as string);
      }
    }
    const shown = rows.filter(
      (r) => !r.post_id || (typeof r.post_id === "string" && visible.has(r.post_id)),
    );
    if (!shown.length) return [];

    // One batch call, not one per photo. At the 200-photo limit the old loop
    // made 200 sequential storage round-trips inside a single Worker request,
    // which is both slow and a good way to meet the subrequest ceiling.
    const paths = shown.map((r) => r.storage_path as string);
    const { data: signedList } = await supabaseAdmin.storage
      .from("destination-photos")
      .createSignedUrls(paths, SIGNED_URL_TTL_S);
    const urlFor = new Map<string, string | null>();
    for (const s of signedList ?? []) {
      if (s.path) urlFor.set(s.path, s.signedUrl ?? null);
    }

    const coarse = (v: unknown): number | null =>
      v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100;

    return shown.map((r) => {
      const day = dayById.get(r.day_id as string);
      return {
        id: r.id as string,
        post_id: (r.post_id as string) ?? null,
        caption: (r.caption as string) ?? null,
        is_cover: Boolean(r.is_cover),
        created_at: r.created_at as string,
        lat: coarse(r.lat),
        lng: coarse(r.lng),
        signedUrl: urlFor.get(r.storage_path as string) ?? null,
        itinerary_days: day
          ? { day_date: (day.day_date as string) ?? null, title: (day.title as string) ?? null }
          : null,
      };
    });
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
