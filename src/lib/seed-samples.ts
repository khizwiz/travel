import { buildSamplePng } from "@/lib/sample-image";
import { pickCoord } from "@/lib/geo";

/**
 * Seeding and un-seeding the sample story photos.
 *
 * Plain functions taking a service-role client, so both callers share one
 * implementation: the owner-only buttons on the Story page, and the
 * secret-gated bootstrap hook that can run without a signed-in browser.
 */

/** Marks a storage object and its row as ours, for a clean removal later. */
export const SAMPLE_MARKER = "sample-";
export const SAMPLE_BUCKET = "destination-photos";
/**
 * Enough to cover every place reached so far on a trip of this length, with
 * headroom. Each sample is an upload plus an insert inside one Worker request,
 * so this is not unbounded — it is a ceiling, and the seeder says so when it
 * has to leave places out.
 */
export const MAX_SAMPLES = 14;

export interface SeedResult {
  created: number;
  skipped: number;
  days: string[];
  message: string;
}

export interface SeedDay {
  id: string;
  day_date: string;
  title?: string | null;
}

/**
 * Which days get a sample photo: the places already reached, one per place.
 *
 * Kept separate and pure because the rule matters more than it looks. An
 * earlier version spread samples evenly across the whole itinerary, which put
 * photographs on days that have not happened yet. That reads as nonsense on
 * the feed, and it quietly undoes a deliberate rule elsewhere: the map shows
 * visitors only the route already covered, never where the trip is heading, so
 * a photo pinned on a future city gives away exactly what that rule protects.
 *
 * De-duplicated by place, so a three-night stay gets one photo rather than the
 * same view three times. When there are more places than `want`, the spread is
 * even across the journey so far instead of only its first few stops.
 */
export function selectVisitedDays<T extends SeedDay>(
  allDays: T[],
  todayISO: string,
  want: number,
): { chosen: T[]; dropped: number } {
  const past = allDays.filter(
    (d) => typeof d.day_date === "string" && d.day_date <= todayISO,
  );
  if (!past.length) return { chosen: [], dropped: 0 };

  const byPlace = new Map<string, T>();
  for (const d of past) {
    const key = String(d.title ?? d.day_date).trim().toLowerCase();
    if (!byPlace.has(key)) byPlace.set(key, d);
  }
  const places = Array.from(byPlace.values());
  if (places.length <= want) return { chosen: places, dropped: 0 };

  const step = places.length / want;
  const trimmed: T[] = [];
  for (let i = 0; i < want; i++) trimmed.push(places[Math.floor(i * step)]);
  return { chosen: trimmed, dropped: places.length - trimmed.length };
}

export async function seedSamples(
  db: any,
  tripId: string,
  actorId: string | null,
  want = MAX_SAMPLES,
): Promise<SeedResult> {
  const { data: allDays, error: dErr } = await db
    .from("itinerary_days")
    .select("id, day_date, title")
    .eq("trip_id", tripId)
    .order("day_date", { ascending: true });
  if (dErr) throw new Error(dErr.message);
  if (!allDays?.length) {
    return { created: 0, skipped: 0, days: [], message: "No itinerary days to attach photos to." };
  }

  // Clamp to the trip's own window as well as to today. A bad booking import
  // can leave an itinerary day years outside the trip (a misread year on a
  // hotel confirmation put one in 2020), and "before today" happily includes
  // 2020 — which is how a sample photo turned up under a 2020 heading.
  const { data: tripRow } = await db
    .from("trips")
    .select("starts_on, ends_on")
    .eq("id", tripId)
    .maybeSingle();
  const startsOn = (tripRow as any)?.starts_on as string | undefined;
  const today = new Date().toISOString().slice(0, 10);
  const inWindow = startsOn
    ? allDays.filter((d: any) => typeof d.day_date === "string" && d.day_date >= startsOn)
    : allDays;

  const { chosen, dropped } = selectVisitedDays(inWindow, today, want);
  if (!chosen.length) {
    return {
      created: 0,
      skipped: 0,
      days: [],
      message: "The trip has not started yet — nowhere to add photos of.",
    };
  }

  // Clear out any samples sitting on days that no longer qualify — chiefly the
  // future-dated ones an earlier run created — so a single tap corrects them
  // rather than leaving the wrong photos behind alongside the right ones.
  const keepIds = new Set(chosen.map((d: any) => d.id as string));
  const staleDayIds = allDays
    .map((d: any) => d.id as string)
    .filter((id: string) => !keepIds.has(id));
  let pruned = 0;
  if (staleDayIds.length) {
    const { data: staleRows } = await db
      .from("destination_photos")
      .select("id, storage_path, post_id")
      .in("day_id", staleDayIds);
    const stale = (staleRows ?? []).filter((r: any) =>
      String(r.storage_path ?? "").includes(SAMPLE_MARKER),
    );
    if (stale.length) {
      await db.storage
        .from(SAMPLE_BUCKET)
        .remove(stale.map((r: any) => r.storage_path as string));
      await db
        .from("destination_photos")
        .delete()
        .in("id", stale.map((r: any) => r.id as string));
      const postIds = stale
        .map((r: any) => r.post_id)
        .filter((v: unknown): v is string => typeof v === "string" && !!v);
      if (postIds.length) await db.from("posts").delete().in("id", postIds);
      pruned = stale.length;
    }
  }

  // Never double-seed: one sample per day at most.
  const { data: already } = await db
    .from("destination_photos")
    .select("day_id, storage_path")
    .in("day_id", chosen.map((d) => d.id));
  const seededDays = new Set(
    (already ?? [])
      .filter((r: any) => String(r.storage_path ?? "").includes(SAMPLE_MARKER))
      .map((r: any) => r.day_id as string),
  );

  // Real coordinates per day, from the stay booked for it.
  const { data: stays } = await db
    .from("accommodations")
    .select("day_id, lat, lng")
    .in("day_id", chosen.map((d: any) => d.id));
  const coordFor = new Map<string, { lat: number; lng: number }>();
  for (const s of stays ?? []) {
    const lat = Number((s as any).lat);
    const lng = Number((s as any).lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      coordFor.set((s as any).day_id as string, { lat, lng });
    }
  }

  let created = 0;
  let skipped = 0;
  const touched: string[] = [];

  for (let i = 0; i < chosen.length; i++) {
    const day = chosen[i];
    if (seededDays.has(day.id)) {
      skipped++;
      continue;
    }

    const png = buildSamplePng(i);
    const path = `${day.id}/${SAMPLE_MARKER}${i}.png`;
    const { error: upErr } = await db.storage
      .from(SAMPLE_BUCKET)
      .upload(path, png, { contentType: "image/png", upsert: true, cacheControl: "3600" });
    if (upErr) throw new Error(`Upload failed for ${path}: ${upErr.message}`);

    // Pin it where the day actually was, or nowhere.
    //
    // The day's own accommodation carries real coordinates; the title is a
    // free-text label like "Re-routed: Rimini, Italy" and the hardcoded city
    // table only knows nineteen names, so matching on it silently misses most
    // real stops. It used to fall back to Istanbul, which does not just lose a
    // pin — it puts the photo in the wrong country. No coordinates now means
    // no marker, which is honest.
    const label: string = day.title ?? "";
    const coord = coordFor.get(day.id as string) ?? pickCoord(label);
    const jitter = (n: number) => n + ((i % 3) - 1) * 0.02;

    const base: Record<string, unknown> = {
      day_id: day.id,
      storage_path: path,
      caption: `Sample photo — ${label || day.day_date}. Remove these once real photos are posted.`,
      is_cover: false,
    };
    if (actorId) base.uploaded_by = actorId;
    const withGeo = coord
      ? { ...base, lat: jitter(coord.lat), lng: jitter(coord.lng) }
      : base;

    // Same schema-drift guard the real uploader uses: lat/lng arrived in a
    // later migration that may not have reached every database.
    let { error } = await db.from("destination_photos").insert(withGeo);
    if (error && /column/i.test(error.message)) {
      ({ error } = await db.from("destination_photos").insert(base));
    }
    if (error) throw new Error(`Insert failed for ${path}: ${error.message}`);

    created++;
    touched.push(label || day.day_date);
  }

  const bits: string[] = [];
  if (created > 0) bits.push(`Added ${created} sample photo${created === 1 ? "" : "s"}`);
  if (skipped) bits.push(`${skipped} already there`);
  if (pruned) bits.push(`removed ${pruned} from days not yet reached`);
  if (dropped) bits.push(`${dropped} more place${dropped === 1 ? "" : "s"} not shown (cap ${want})`);

  return {
    created,
    skipped,
    days: touched,
    message: bits.length
      ? `${bits.join(", ")}.`
      : "Samples were already in place — nothing to add.",
  };
}

export async function removeSamples(
  db: any,
  tripId: string,
): Promise<{ removed: number; message: string }> {
  const { data: days } = await db.from("itinerary_days").select("id").eq("trip_id", tripId);
  const dayIds = (days ?? []).map((d: any) => d.id as string);
  if (!dayIds.length) return { removed: 0, message: "Nothing to remove." };

  const { data: rows } = await db
    .from("destination_photos")
    .select("id, storage_path, post_id")
    .in("day_id", dayIds);
  const samples = (rows ?? []).filter((r: any) =>
    String(r.storage_path ?? "").includes(SAMPLE_MARKER),
  );
  if (!samples.length) return { removed: 0, message: "No sample photos to remove." };

  // Storage first: a leftover row with no file renders as a broken card,
  // whereas a leftover file with no row is invisible and harmless.
  const paths = samples.map((r: any) => r.storage_path as string);
  const { error: rmErr } = await db.storage.from(SAMPLE_BUCKET).remove(paths);
  if (rmErr) console.error("[seed] storage remove failed", rmErr.message);

  const ids = samples.map((r: any) => r.id as string);
  const { error } = await db.from("destination_photos").delete().in("id", ids);
  if (error) throw new Error(error.message);

  // Take the companion posts with them. The insert trigger creates one post
  // per photo, and the FK is ON DELETE SET NULL, so deleting only the photo
  // strands a post that still carries its caption and can still be commented
  // on — invisible on the feed but present in the data.
  const postIds = samples
    .map((r: any) => r.post_id)
    .filter((v: unknown): v is string => typeof v === "string" && !!v);
  if (postIds.length) {
    const { error: pErr } = await db.from("posts").delete().in("id", postIds);
    if (pErr) console.error("[seed] companion post cleanup failed", pErr.message);
  }

  return {
    removed: ids.length,
    message: `Removed ${ids.length} sample photo${ids.length === 1 ? "" : "s"}.`,
  };
}
