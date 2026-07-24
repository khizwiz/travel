import { haversineKm } from "@/lib/geo";

/**
 * The one place that turns recorded GPS fixes into distance and into a line.
 *
 * Before this, four modules answered "how far have we gone?" and disagreed:
 *  - `geo.ts` measured straight lines between ~19 hardcoded city centres,
 *  - `trip-data.ts` kept a verbatim copy of that table and that maths,
 *  - `fuel.functions.ts` walked the real `location_points` trail,
 *  - `location.functions.ts` cleaned the same trail again, with its own
 *    haversine and a slightly different rule for bad fixes.
 *
 * Only the third one was measuring the road actually driven. That walker is
 * the engine kept here; the others now call it instead of re-deriving it.
 *
 * Server-side only — it reads `location_points` with the service-role client.
 * The pure maths lives in `geo.ts` so client components can still use it.
 */

/** Fix-quality rules. One set of numbers, so features cannot drift apart. */
export const TRAIL = {
  /** Fixes fuzzier than this are cell-tower guesses, not positions. */
  MAX_ACCURACY_M: 500,
  /** Below this a "move" is a parked phone's GPS wandering. */
  MIN_STEP_KM: 0.02,
  /** Implied speed above this means a bad fix, not a fast truck. */
  MAX_SPEED_KMH: 160,
} as const;

const PAGE_SIZE = 1000;
const MAX_PAGES = 60;

export interface RawFix {
  lat: number;
  lng: number;
  ts: string;
  accuracy_m: number | null;
}

/** An accepted fix, with the cumulative driven distance at that moment. */
export interface TrailPoint {
  lat: number;
  lng: number;
  /** Epoch ms. */
  t: number;
  /** Cumulative km driven up to and including this fix. */
  km: number;
  /**
   * True when the previous fix implied an impossible speed, so this point
   * starts a fresh segment: the leg into it was NOT counted as driving, and
   * drawing a line to it would draw a jump that never happened.
   */
  isBreak: boolean;
}

export interface Trail {
  /** Real driven distance, detours included, jitter and teleports excluded. */
  totalKm: number;
  /** Accepted fixes in time order. */
  points: TrailPoint[];
  /** Cumulative km at each accepted fix — for "how far by time T" lookups. */
  marks: Array<{ ts: number; km: number }>;
  /** How many rows came back from the database before cleaning. */
  rawCount: number;
  /** Timestamp of the last usable fix. */
  lastTs: string | null;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * The trip everything defaults to.
 *
 * Fuel resolved this by slug and the map by oldest-created, which would pick
 * different trips the moment a second trip exists. Slug first, oldest as a
 * fallback, so both former behaviours still land on the same row.
 */
export async function resolveTripId(tripId?: string): Promise<string | null> {
  if (tripId) return tripId;
  const db = await admin();
  const { data: bySlug } = await db
    .from("trips")
    .select("id")
    .eq("slug", "eu-tripping-2026")
    .maybeSingle();
  if (bySlug?.id) return bySlug.id as string;
  const { data: oldest } = await db
    .from("trips")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (oldest?.id as string) ?? null;
}

/** Read the whole trail in pages — PostgREST caps a single response. */
export async function loadTrailFixes(tripId: string): Promise<RawFix[]> {
  const db = await admin();
  const raw: RawFix[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await db
      .from("location_points")
      .select("lat, lng, ts, accuracy_m")
      .eq("trip_id", tripId)
      .order("ts", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    raw.push(...(data as RawFix[]));
    if (data.length < PAGE_SIZE) break;
  }
  return raw;
}

/**
 * Walk the ordered trail and sum the distance actually driven.
 *
 * Every accepted fix contributes its leg, so a detour to a town off the plan
 * counts once and in full — which is the whole reason this exists. Three
 * things are rejected: fixes too fuzzy to mean anything, sub-20 m wobble from
 * a parked phone (the anchor is kept, so slow real movement still accumulates
 * rather than being filtered away a metre at a time), and legs implying more
 * than 160 km/h, which reset the anchor without being counted.
 */
export function walkTrail(raw: RawFix[]): Trail {
  let total = 0;
  const points: TrailPoint[] = [];
  const marks: Array<{ ts: number; km: number }> = [];
  let anchor: { lat: number; lng: number; t: number } | null = null;
  let lastTs: string | null = null;

  for (const p of raw) {
    if (p.accuracy_m != null && Number(p.accuracy_m) > TRAIL.MAX_ACCURACY_M) continue;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    const t = new Date(p.ts).getTime();
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(t)) continue;
    lastTs = p.ts;

    if (!anchor) {
      anchor = { lat, lng, t };
      marks.push({ ts: t, km: 0 });
      points.push({ lat, lng, t, km: 0, isBreak: false });
      continue;
    }

    const step = haversineKm({ lat: anchor.lat, lng: anchor.lng }, { lat, lng });
    if (step < TRAIL.MIN_STEP_KM) continue; // jitter: hold the anchor

    const dtH = (t - anchor.t) / 3_600_000;
    if (dtH > 0 && step / dtH > TRAIL.MAX_SPEED_KMH) {
      // Teleport or bad fix: believe the new position, but do not claim the
      // truck drove there. The leg is dropped and the point starts a segment.
      anchor = { lat, lng, t };
      points.push({ lat, lng, t, km: total, isBreak: true });
      continue;
    }

    total += step;
    marks.push({ ts: t, km: total });
    points.push({ lat, lng, t, km: total, isBreak: false });
    anchor = { lat, lng, t };
  }

  return { totalKm: total, points, marks, rawCount: raw.length, lastTs };
}

/** Load and walk in one call — what most callers want. */
export async function getTrail(tripId: string): Promise<Trail> {
  return walkTrail(await loadTrailFixes(tripId));
}

/** Driven km as of a moment in time. */
export function kmAt(marks: Array<{ ts: number; km: number }>, tsMs: number): number {
  let km = 0;
  for (const m of marks) {
    if (m.ts <= tsMs) km = m.km;
    else break;
  }
  return km;
}

/**
 * The line to draw: accepted fixes with the discontinuities removed.
 *
 * A break point is a position we believe but a leg we do not, so joining it to
 * its neighbours would draw a road nobody took.
 */
export function drawablePath(trail: Trail): Array<{ lat: number; lng: number }> {
  return trail.points.filter((p) => !p.isBreak).map((p) => ({ lat: p.lat, lng: p.lng }));
}

// ── How much further you really drive than the crow flies ────────────────────

const DETOUR_MIN_DAY_KM = 15; // a day shorter than this is noise, not a route
const DETOUR_MIN_DAYS = 2;
const DETOUR_FLOOR = 1.0; // roads are never shorter than the straight line
const DETOUR_CEIL = 2.5;

/**
 * Learn this trip's real ratio of road distance to straight-line distance.
 *
 * Per calendar day: how far the truck actually drove, against how far its
 * first and last fix of that day are apart as the crow flies. Ferries, hairpin
 * passes and detours all push this up, and it is measured from this trip's own
 * trail rather than assumed — the same self-calibrating trick the fuel card
 * uses to learn real L/100 km.
 *
 * Returns null until there is enough driving to mean anything.
 */
export function learnDetourFactor(trail: Trail): number | null {
  const byDay = new Map<string, TrailPoint[]>();
  for (const p of trail.points) {
    const day = new Date(p.t).toISOString().slice(0, 10);
    const list = byDay.get(day);
    if (list) list.push(p);
    else byDay.set(day, [p]);
  }

  let drivenKm = 0;
  let crowKm = 0;
  let days = 0;
  for (const pts of byDay.values()) {
    if (pts.length < 2) continue;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const crow = haversineKm(first, last);
    if (crow < DETOUR_MIN_DAY_KM) continue; // parked, or a loop back to the start
    const driven = last.km - first.km;
    if (driven < crow) continue; // can only happen across a break; ignore
    drivenKm += driven;
    crowKm += crow;
    days++;
  }

  if (days < DETOUR_MIN_DAYS || crowKm <= 0) return null;
  return Math.min(DETOUR_CEIL, Math.max(DETOUR_FLOOR, drivenKm / crowKm));
}
