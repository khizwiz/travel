import { haversineKm, pickCoord } from "@/lib/geo";

/**
 * Where a given itinerary day was, in coordinates.
 *
 * Photos are pinned by *day*, not by where the phone happens to be when they
 * are uploaded. That distinction is the whole point: a fortnight of photos
 * posted from home would otherwise all land on one spot, because the uploader
 * stamped each one with the current live GPS fix.
 *
 * Order of trust: the stay booked for that day carries real coordinates; the
 * day's title is free text like "Re-routed: Rimini, Italy" that the small
 * hardcoded city table usually cannot match. Failing both, null — no pin at
 * all, which is honest, rather than a default that puts the photo in the wrong
 * country.
 */
export interface Coord {
  lat: number;
  lng: number;
}

function usable(lat: unknown, lng: unknown): Coord | null {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a === 0 && b === 0) return null;
  return { lat: a, lng: b };
}

/** Coordinates for many days at once, keyed by day id. */
export async function coordsForDays(db: any, dayIds: string[]): Promise<Map<string, Coord>> {
  const out = new Map<string, Coord>();
  if (!dayIds.length) return out;

  const { data: stays } = await db
    .from("accommodations")
    .select("day_id, lat, lng")
    .in("day_id", dayIds);
  for (const s of stays ?? []) {
    const c = usable((s as any).lat, (s as any).lng);
    if (c) out.set((s as any).day_id as string, c);
  }

  // Fall back to the day's title for anything the stays did not cover.
  const missing = dayIds.filter((id) => !out.has(id));
  if (missing.length) {
    const { data: days } = await db
      .from("itinerary_days")
      .select("id, title")
      .in("id", missing);

    // Look the name up properly rather than only checking it against the
    // nineteen cities the app happens to know. The story page has always shown
    // which town each photo belongs to; this is what finally lets the map
    // agree with it. Results are cached per place, so a trip's worth of days
    // costs a handful of lookups once.
    const { geocodePlaceCore } = await import("@/lib/location.functions");
    for (const d of days ?? []) {
      const title = String((d as any).title ?? "");
      const local = pickCoord(title);
      if (local) {
        out.set((d as any).id as string, local);
        continue;
      }
      const found = await geocodePlaceCore(title);
      if (found) out.set((d as any).id as string, found);
    }
  }

  return out;
}

/** Coordinates for a single day, or null if the day's location is unknown. */
export async function coordForDay(db: any, dayId: string): Promise<Coord | null> {
  return (await coordsForDays(db, [dayId])).get(dayId) ?? null;
}

/**
 * How far from ANY known point of the trip a photo may sit and still count as
 * having been taken on it.
 *
 * Deliberately generous. Only some days have coordinates at all — they come
 * from booked stays — so the known points are sparse and the real gaps between
 * them are large: Zagreb is around 300 km from both Budapest and Rimini, and a
 * photo taken on that drive is entirely genuine. This is meant to catch a
 * picture from another country, not to police the route, so it errs towards
 * believing the camera.
 */
const ON_TRIP_KM = 400;

export type CoordSource = "photo" | "day" | "photo-off-trip" | "none";

/**
 * Decide where a photo belongs.
 *
 * The camera's own coordinates win, and they are checked against the trip as a
 * whole — never against the single day the photo happens to be filed under.
 * That distinction matters more than it looks: photos get uploaded in bulk and
 * land on whatever day the picker was showing, so a picture genuinely taken in
 * Rimini can sit under a Budapest day. Comparing it with that day would put it
 * back in Budapest and throw away the one piece of true evidence there is.
 *
 * The day is a fallback for photos with no metadata, and a correction only for
 * photos taken nowhere near the journey at all — sorting pictures at home
 * produces valid coordinates for a country the trip never entered.
 */
export function reconcileCoord(
  exif: Coord | null,
  day: Coord | null,
  tripPoints: Coord[] = [],
): { coord: Coord | null; source: CoordSource } {
  if (!exif && !day) return { coord: null, source: "none" };
  if (!exif) return { coord: day, source: "day" };
  if (!tripPoints.length) return { coord: exif, source: "photo" };

  const onTrip = tripPoints.some((p) => haversineKm(exif, p) <= ON_TRIP_KM);
  if (onTrip) return { coord: exif, source: "photo" };
  return day
    ? { coord: day, source: "photo-off-trip" }
    : { coord: exif, source: "photo" };
}

/** The day's calendar date, or null. */
export async function dayDate(db: any, dayId: string): Promise<string | null> {
  const { data } = await db
    .from("itinerary_days")
    .select("day_date")
    .eq("id", dayId)
    .maybeSingle();
  return ((data as any)?.day_date as string) ?? null;
}
