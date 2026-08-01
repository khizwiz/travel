import { pickCoord } from "@/lib/geo";

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

/** The day's calendar date, or null. */
export async function dayDate(db: any, dayId: string): Promise<string | null> {
  const { data } = await db
    .from("itinerary_days")
    .select("day_date")
    .eq("id", dayId)
    .maybeSingle();
  return ((data as any)?.day_date as string) ?? null;
}
