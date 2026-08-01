import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { readExifMeta } from "@/lib/exif-gps";
import { reverseGeocodeCore } from "@/lib/location.functions";
import { coordsForDays, reconcileCoord } from "@/lib/day-coord";
import { assertTripOwner } from "@/lib/trip-owner.server";

/**
 * Put the photos already in the bucket onto the map, where they were taken.
 *
 * Everything uploaded before the app read EXIF carries either the position of
 * the phone that posted it or nothing at all. The originals still hold their
 * metadata, so it can be recovered — but only by opening the files, which is
 * why this is a deliberate owner-run pass rather than something the feed does.
 *
 * Two economies make that affordable inside a Worker:
 *
 *  - only the first slice of each file is fetched, over a signed URL with a
 *    Range header. EXIF sits at the front of both JPEG and HEIC, so a whole
 *    photo never needs to come down; and
 *  - it works in batches and reports what is left, so a large feed is several
 *    quick passes instead of one request that runs out of memory or time.
 *
 * Each coordinate found is also reverse-geocoded, which warms the shared
 * `revgeo:` cache. That is what lets the story feed label a marker "Rimini"
 * without a network lookup per photo per page load.
 */

const BUCKET = "destination-photos";
/** EXIF lives at the head of the file; no reason to pull down a 12 MB photo. */
const HEAD_BYTES = 512 * 1024;
const DEFAULT_BATCH = 12;

export interface BackfillResult {
  scanned: number;
  located: number;
  named: number;
  fellBackToDay: number;
  /** Photos moved onto the day their capture date says they belong to. */
  refiled?: number;
  remaining: number;
  message: string;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Fetch just the head of a stored object via a short-lived signed URL. */
async function readHead(db: any, path: string): Promise<Blob | null> {
  const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(path, 120);
  if (!signed?.signedUrl) return null;
  try {
    const res = await fetch(signed.signedUrl, {
      headers: { Range: `bytes=0-${HEAD_BYTES - 1}` },
    });
    // 206 is the ranged reply; 200 means the server ignored Range and sent it
    // all, which is still usable, just less frugal.
    if (!res.ok && res.status !== 206) return null;
    return await res.blob();
  } catch (e) {
    console.error("[photo-geo] head fetch failed", path, e);
    return null;
  }
}

export const backfillPhotoGeo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        batch: z.number().int().min(1).max(25).optional(),
        /**
         * How many already-processed photos to skip. Needed because a full
         * re-read leaves no "done" marker on a row, so without a cursor the
         * caller would loop over the same first batch forever.
         */
        offset: z.number().int().min(0).optional(),
        /** Skip photos that already carry any position. Off by default. */
        onlyMissing: z.boolean().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<BackfillResult> => {
    const db = await admin();
    const { data: trip } = await db
      .from("trips").select("id, owner_id").eq("slug", "eu-tripping-2026").maybeSingle();
    if (!trip) throw new Error("No trip found");
    await assertTripOwner(db, context.userId, (trip as any).id as string);

    const { data: days } = await db
      .from("itinerary_days").select("id, day_date").eq("trip_id", trip.id);
    const dayIds = (days ?? []).map((d: any) => d.id as string);
    const dayIdByDate = new Map(
      (days ?? []).map((d: any) => [d.day_date as string, d.id as string]),
    );
    if (!dayIds.length) {
      return { scanned: 0, located: 0, named: 0, fellBackToDay: 0, remaining: 0, message: "No itinerary days." };
    }

    // `select("*")` for the same schema-drift reason as the feed: lat/lng
    // arrived in a later migration and are absent from the generated types.
    const { data: rawPhotos, error } = await db
      .from("destination_photos")
      .select("*")
      .in("day_id", dayIds)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const photos = (rawPhotos ?? []) as Array<Record<string, unknown>>;

    // Default to re-reading everything, not only the blanks.
    //
    // "Has a coordinate" is not the same as "has the right coordinate": every
    // photo uploaded before this existed carries the position of the phone
    // that posted it, which is a value, so a blanks-only pass skipped exactly
    // the photos that needed fixing and reported there was nothing to do.
    const pending = photos.filter((p) => (data.onlyMissing ? p.lat == null || p.lng == null : true));
    const offset = data.offset ?? 0;
    const batch = pending.slice(offset, offset + (data.batch ?? DEFAULT_BATCH));
    if (!batch.length) {
      return {
        scanned: 0, located: 0, named: 0, fellBackToDay: 0, remaining: 0,
        message: pending.length
          ? "Finished — every photo has been checked."
          : "No photos to read.",
      };
    }

    // Every day's location, so a photo can be checked against the journey as a
    // whole rather than against whichever day it happens to be filed under.
    const allDayCoords = await coordsForDays(db, dayIds);
    const tripPoints = Array.from(allDayCoords.values());

    let located = 0;
    let named = 0;
    let fellBackToDay = 0;
    let refiled = 0;

    for (const p of batch) {
      const path = p.storage_path as string;
      const head = await readHead(db, path);
      const meta = head ? await readExifMeta(head) : { gps: null, takenOn: null };

      // File the photo on the day it was actually taken. Uploading a fortnight
      // of pictures in one go puts them all on whichever day the picker was
      // showing; the capture date is what the owner actually meant.
      let dayId = p.day_id as string;
      if (meta.takenOn) {
        const correctDay = dayIdByDate.get(meta.takenOn);
        if (correctDay && correctDay !== dayId) {
          const { error: mvErr } = await db
            .from("destination_photos")
            .update({ day_id: correctDay })
            .eq("id", p.id as string);
          if (!mvErr) {
            dayId = correctDay;
            refiled++;
          }
        }
      }

      const { coord, source } = reconcileCoord(
        meta.gps,
        allDayCoords.get(dayId) ?? null,
        tripPoints,
      );
      if (source === "photo") located++;
      else if (source === "day" || source === "photo-off-trip") fellBackToDay++;

      if (!coord) continue;

      const { error: upErr } = await db
        .from("destination_photos")
        .update({ lat: coord.lat, lng: coord.lng })
        .eq("id", p.id as string);
      if (upErr) {
        if (/column/i.test(upErr.message)) {
          return {
            scanned: batch.length, located, named, fellBackToDay, remaining: 0,
            message: "This database has no photo location columns yet.",
          };
        }
        throw new Error(upErr.message);
      }

      // Warm the place-name cache for the marker label.
      const place = await reverseGeocodeCore(coord.lat, coord.lng);
      if (place?.label) named++;
    }

    const remaining = Math.max(0, pending.length - (offset + batch.length));
    return {
      scanned: batch.length,
      located,
      named,
      fellBackToDay,
      remaining,
      refiled,
      message:
        `Read ${batch.length} photo${batch.length === 1 ? "" : "s"}: ` +
        `${located} placed from the camera's own data` +
        (fellBackToDay ? `, ${fellBackToDay} from their day` : "") +
        (refiled ? `, ${refiled} moved to the day they were taken` : "") +
        (remaining ? `. ${remaining} still to go.` : "."),
    };
  });
