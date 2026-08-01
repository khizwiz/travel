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
    for (const d of days ?? []) {
      const c = pickCoord(String((d as any).title ?? ""));
      if (c) out.set((d as any).id as string, c);
    }
  }

  return out;
}

/** Coordinates for a single day, or null if the day's location is unknown. */
export async function coordForDay(db: any, dayId: string): Promise<Coord | null> {
  return (await coordsForDays(db, [dayId])).get(dayId) ?? null;
}

/**
 * How far a photo may sit from its day's known location and still be believed.
 *
 * A day covers a drive, so the two ends can be hundreds of kilometres apart;
 * this has to be loose enough not to reject a genuine roadside photo, and
 * tight enough to catch a picture that plainly was not taken on that leg.
 */
const PLAUSIBLE_KM = 250;

export type CoordSource = "photo" | "day" | "photo-far" | "none";

/**
 * Decide where a photo belongs, cross-checking its own metadata against the
 * day it was filed under.
 *
 * Metadata wins when the two agree, because the camera knows best. When they
 * disagree wildly the day wins — a photo taken at home while sorting through
 * the trip carries perfectly valid coordinates for the wrong country, and
 * pinning it there scatters the map with places the trip never went. The day
 * is the thing the owner deliberately chose.
 */
export function reconcileCoord(
  exif: Coord | null,
  day: Coord | null,
): { coord: Coord | null; source: CoordSource } {
  if (!exif && !day) return { coord: null, source: "none" };
  if (!exif) return { coord: day, source: "day" };
  if (!day) return { coord: exif, source: "photo" };
  const apart = haversineKm(exif, day);
  return apart <= PLAUSIBLE_KM
    ? { coord: exif, source: "photo" }
    : { coord: day, source: "photo-far" };
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
