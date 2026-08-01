import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { coordForDay, coordsForDays, dayDate } from "@/lib/day-coord";

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

    // Photos first, then the days they belong to.
    //
    // The first version of this fix went the other way — days for the slug
    // trip, then photos whose day_id was in that set — and emptied the feed
    // completely. Deriving the allowed set up front makes every unknown
    // (a photo on a day from another trip row, a day that no longer exists)
    // silently delete the photo. Start from the photos that exist and only
    // drop one when there is positive evidence it belongs elsewhere.
    //
    // `select("*")` on purpose. lat/lng come from the photo_geo migration and
    // are absent from the checked-in generated types, so naming them here both
    // fails typecheck and 400s outright if that migration has not reached this
    // database. A star select returns whatever the schema actually has, and
    // the shaping below reads the geo columns only if they came back.
    const { data: rawRows, error } = await supabaseAdmin
      .from("destination_photos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(PHOTO_LIMIT);
    if (error) throw new Error(error.message);
    const allRows = (rawRows ?? []) as Array<Record<string, unknown>>;
    if (!allRows.length) {
      // An empty feed has two very different causes and they need different
      // fixes: nothing was ever uploaded, or the files landed in the bucket
      // but the companion row never inserted. Say which.
      const { data: objects } = await supabaseAdmin.storage
        .from("destination-photos")
        .list("", { limit: 5 });
      console.log(
        `[story] EMPTY rows=0 tripFound=${!!trip} bucketEntries=${objects?.length ?? "err"}`,
      );
      return [];
    }

    const dayIds = Array.from(
      new Set(
        allRows.map((r) => r.day_id).filter((v): v is string => typeof v === "string" && !!v),
      ),
    );
    const { data: days, error: dErr } = dayIds.length
      ? await supabaseAdmin
          .from("itinerary_days")
          .select("id, day_date, title, trip_id")
          .in("id", dayIds)
      : { data: [] as any[], error: null };
    if (dErr) throw new Error(dErr.message);
    const dayById = new Map((days ?? []).map((d: any) => [d.id as string, d]));

    // Exclude a photo only when its day is known AND belongs to another trip.
    // An unknown day keeps the photo, with no date, rather than vanishing it.
    const rows = allRows.filter((r) => {
      const day = dayById.get(r.day_id as string);
      return !day || !trip || day.trip_id === trip.id;
    });
    if (!rows.length) return [];

    // Only photos whose companion post is still public and active. The insert
    // trigger creates them public, so this hides exactly what the owner hid.
    // Fail-open for the same reason as above: hide on positive evidence the
    // post is private or removed, never merely because the lookup came back
    // empty. A failed join must not silently erase the family's photos.
    const postIds = rows
      .map((r) => r.post_id)
      .filter((v): v is string => typeof v === "string" && !!v);
    const hidden = new Set<string>();
    if (postIds.length) {
      const { data: posts, error: pErr } = await supabaseAdmin
        .from("posts")
        .select("id, visibility, status")
        .in("id", postIds);
      if (pErr) console.error("[story] post visibility lookup failed", pErr.message);
      for (const p of posts ?? []) {
        if (p.visibility !== "public" || p.status !== "active") hidden.add(p.id as string);
      }
    }
    const shown = rows.filter(
      (r) => !(typeof r.post_id === "string" && hidden.has(r.post_id)),
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

    // Counts per stage, so an empty feed says which step emptied it instead of
    // being indistinguishable from "no photos have been posted".
    const signed = shown.filter((r) => urlFor.get(r.storage_path as string)).length;
    console.log(
      `[story] photos=${allRows.length} afterTripFilter=${rows.length} ` +
        `afterVisibility=${shown.length} signed=${signed} days=${dayById.size}`,
    );

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
    exifLat: z.number().min(-90).max(90).optional().nullable(),
    exifLng: z.number().min(-180).max(180).optional().nullable(),
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

    // Where the photo was taken, best source first.
    //
    //  1. The camera's own EXIF GPS — recorded at the moment of the shot, and
    //     correct however long afterwards the photo is posted.
    //  2. The phone's position now, but only for a photo filed under today.
    //  3. The day's own location, from the stay booked for it.
    //  4. Nothing, and therefore no pin.
    //
    // This used to be (2) unconditionally, so a fortnight of photos uploaded
    // in one sitting all landed on a single point of the map — wherever the
    // phone was at the time of posting.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = new Date().toISOString().slice(0, 10);
    const forDate = await dayDate(supabaseAdmin, data.dayId);
    const exifFix =
      data.exifLat != null && data.exifLng != null
        ? { lat: data.exifLat, lng: data.exifLng }
        : null;
    const deviceFix =
      data.lat != null && data.lng != null ? { lat: data.lat, lng: data.lng } : null;
    const coord =
      exifFix ??
      (forDate === today && deviceFix ? deviceFix : await coordForDay(supabaseAdmin, data.dayId));

    // Retry without geo if the lat/lng migration hasn't reached this database,
    // so uploads never break on schema drift.
    const withGeo = coord ? { ...base, lat: coord.lat, lng: coord.lng } : base;
    let { data: row, error } = await context.supabase
      .from("destination_photos").insert(withGeo).select("id").single();
    if (error && withGeo !== base && /column/i.test(error.message)) {
      ({ data: row, error } = await context.supabase
        .from("destination_photos").insert(base).select("id").single());
    }
    if (error || !row) throw new Error(error?.message ?? "Insert failed");
    return { id: row.id };
  });

/**
 * Re-pin existing photos to the day they belong to.
 *
 * Everything uploaded before the fix above carries the uploading phone's
 * position rather than the day's, which is why a whole trip's photos can sit
 * on one point of the map. This recomputes each pin from its day. Photos on
 * today's day are left alone — their device fix is the better answer.
 */
export const repinDestinationPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tripId: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ context }): Promise<{ repinned: number; cleared: number; message: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: trip } = await supabaseAdmin
      .from("trips").select("id, owner_id").eq("slug", "eu-tripping-2026").maybeSingle();
    if (!trip) throw new Error("No trip found");
    if ((trip as any).owner_id !== context.userId) {
      throw new Error("Only the trip owner can do this");
    }

    const { data: days } = await supabaseAdmin
      .from("itinerary_days").select("id, day_date").eq("trip_id", trip.id);
    const dateOf = new Map((days ?? []).map((d: any) => [d.id as string, d.day_date as string]));
    if (!dateOf.size) return { repinned: 0, cleared: 0, message: "No itinerary days." };

    const { data: photos } = await supabaseAdmin
      .from("destination_photos")
      .select("id, day_id")
      .in("day_id", Array.from(dateOf.keys()));
    if (!photos?.length) return { repinned: 0, cleared: 0, message: "No photos to re-pin." };

    const today = new Date().toISOString().slice(0, 10);
    const targets = photos.filter((p: any) => dateOf.get(p.day_id as string) !== today);
    const coords = await coordsForDays(
      supabaseAdmin,
      Array.from(new Set(targets.map((p: any) => p.day_id as string))),
    );

    let repinned = 0;
    let cleared = 0;
    for (const p of targets) {
      const c = coords.get((p as any).day_id as string) ?? null;
      const { error } = await supabaseAdmin
        .from("destination_photos")
        .update(c ? { lat: c.lat, lng: c.lng } : { lat: null, lng: null })
        .eq("id", (p as any).id as string);
      if (error) {
        if (/column/i.test(error.message)) {
          return { repinned, cleared, message: "This database has no photo location columns yet." };
        }
        throw new Error(error.message);
      }
      if (c) repinned++;
      else cleared++;
    }

    return {
      repinned,
      cleared,
      message:
        `Re-pinned ${repinned} photo${repinned === 1 ? "" : "s"} to their day` +
        (cleared ? `, cleared ${cleared} with no known location` : "") + ".",
    };
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
