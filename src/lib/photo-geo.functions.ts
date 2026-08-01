import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { readExifMeta } from "@/lib/exif-gps";
import { reverseGeocodeCore } from "@/lib/location.functions";
import { coordsForDays, reconcileCoord } from "@/lib/day-coord";
import { assertTripOwner } from "@/lib/trip-owner.server";
import { aiModel, aiUrl, lovableAiHeaders } from "@/lib/ai-gateway.server";

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
  /** Photos with no GPS whose place the model recognised from the picture. */
  identified?: number;
  remaining: number;
  message: string;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Ask the model to recognise which of the trip's stops a photo was taken in.
 *
 * Only for photos carrying no GPS at all — location switched off, or stripped
 * by whatever exported them. The answer is constrained to places the trip
 * actually visited and the model is told it may decline, because a confident
 * guess at a city nobody went to is worse than no pin. It sees the photo by
 * signed URL, so nothing has to be downloaded into the Worker to ask.
 */
async function identifyPlaceBySight(
  imageUrl: string,
  candidates: string[],
  dayHint: string | null,
): Promise<string | null> {
  const key =
    process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY || process.env.LOVABLE_API_KEY;
  if (!key || candidates.length === 0) return null;
  try {
    const res = await fetch(aiUrl(), {
      method: "POST",
      headers: lovableAiHeaders(),
      body: JSON.stringify({
        model: aiModel(),
        messages: [
          {
            role: "system",
            content:
              "You identify where a travel photograph was taken. You are given the " +
              "only places it could be. Reply with exactly one of them, or the single " +
              "word UNKNOWN. Answer UNKNOWN unless the picture shows something you " +
              "actually recognise — architecture, signage, landscape, a landmark. " +
              "Never guess from atmosphere alone.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `Places: ${candidates.join(" | ")}.` +
                  (dayHint ? ` The photo is filed under ${dayHint}, which may be wrong.` : "") +
                  " Which is it? Reply with one name from the list, or UNKNOWN.",
              },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        temperature: 0,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const answer = String(json?.choices?.[0]?.message?.content ?? "").trim();
    if (!answer || /unknown/i.test(answer)) return null;
    // Only accept an answer that is actually one of the offered places.
    const match = candidates.find(
      (c) => c.toLowerCase() === answer.toLowerCase() ||
        answer.toLowerCase().includes(c.toLowerCase()),
    );
    return match ?? null;
  } catch (e) {
    console.error("[photo-geo] visual identification failed", e);
    return null;
  }
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
        /** Ignore recorded progress and read every photo again. */
        force: z.boolean().optional(),
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

    // Which photos have already been through this.
    //
    // Not "does it have a coordinate" — every photo uploaded before this
    // existed carries the position of the phone that posted it, which is a
    // value, so that test skipped exactly the ones needing repair. Progress is
    // kept in app_config instead: no schema change, and it makes the pass
    // resumable and safe to trigger automatically without re-downloading the
    // whole feed each time.
    const progressKey = `photo-geo:${trip.id}`;
    const { data: progressRow } = await db
      .from("app_config").select("value").eq("key", progressKey).maybeSingle();
    const done: Set<string> = new Set(
      data.force ? [] : (((progressRow as any)?.value?.done as string[]) ?? []),
    );

    const pending = photos.filter((p) => !done.has(p.id as string));
    // Progress is recorded, so each call simply takes the next unread batch —
    // no cursor for the caller to keep, and nothing re-read on a retry.
    const batch = pending.slice(0, data.batch ?? DEFAULT_BATCH);
    if (!batch.length) {
      return {
        scanned: 0, located: 0, named: 0, fellBackToDay: 0, remaining: 0,
        message: photos.length
          ? "Every photo has been read."
          : "No photos to read.",
      };
    }

    // Every day's location, so a photo can be checked against the journey as a
    // whole rather than against whichever day it happens to be filed under.
    const allDayCoords = await coordsForDays(db, dayIds);
    const tripPoints = Array.from(allDayCoords.values());

    // The named stops the trip made, for recognising a photo by sight.
    const titleByDayId = new Map(
      (days ?? []).map((d: any) => [d.id as string, (d.title as string) ?? ""]),
    );
    const placeCoords = new Map<string, { lat: number; lng: number }>();
    for (const [id, coord] of allDayCoords) {
      const title = String(titleByDayId.get(id) ?? "").trim();
      if (title && !placeCoords.has(title)) placeCoords.set(title, coord);
    }

    let located = 0;
    let named = 0;
    let fellBackToDay = 0;
    let refiled = 0;
    let identified = 0;

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

      // No coordinates in the file: ask the model to recognise the place from
      // the picture itself, against the list of stops the trip actually made.
      let recognised: { lat: number; lng: number } | null = null;
      if (!meta.gps) {
        const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(path, 300);
        if (signed?.signedUrl) {
          const name = await identifyPlaceBySight(
            signed.signedUrl,
            Array.from(placeCoords.keys()),
            titleByDayId.get(dayId) ?? null,
          );
          if (name) {
            recognised = placeCoords.get(name) ?? null;
            if (recognised) identified++;
          }
        }
      }

      const { coord, source } = reconcileCoord(
        meta.gps ?? recognised,
        allDayCoords.get(dayId) ?? null,
        // A recognised place is one of the trip's own stops, so it needs no
        // checking against the corridor — and checking it would be circular.
        meta.gps ? tripPoints : [],
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

    // Record the batch as read, whatever the outcome — a photo with no usable
    // metadata is still a photo we have looked at, and retrying it forever
    // would stall the pass on the first unreadable file.
    for (const p of batch) done.add(p.id as string);
    await db.from("app_config").upsert(
      {
        key: progressKey,
        value: { done: Array.from(done) } as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );

    const remaining = Math.max(0, pending.length - batch.length);
    return {
      scanned: batch.length,
      located,
      named,
      fellBackToDay,
      remaining,
      refiled,
      identified,
      message:
        `Read ${batch.length} photo${batch.length === 1 ? "" : "s"}: ` +
        `${located} placed from the camera's own data` +
        (identified ? `, ${identified} recognised from the picture` : "") +
        (fellBackToDay ? `, ${fellBackToDay} from their day` : "") +
        (refiled ? `, ${refiled} moved to the day they were taken` : "") +
        (remaining ? `. ${remaining} still to go.` : "."),
    };
  });
