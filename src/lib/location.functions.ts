import { createServerFn } from "@tanstack/react-start";
import { requireCapability } from "@/integrations/supabase/permission-middleware";
import { z } from "zod";
import { drawablePath, getTrail, learnDetourFactor, resolveTripId } from "@/lib/location.service";

/**
 * Turning real coordinates into real place names, and the recorded GPS trail
 * into a line that follows roads.
 *
 * Both were previously faked from the itinerary: "where you are" was the
 * nearest of ~28 hardcoded cities, and "the route so far" was straight lines
 * drawn between those cities. Neither consulted the device or the recorded
 * trail, so the app confidently reported a city you had driven past hours ago.
 *
 * Both providers here are keyless OSM services. Per CLAUDE.md, anything hit
 * from a Cloudflare egress IP needs an identifying User-Agent, jitter, and an
 * app_config cache — these are shared community servers and will rate-limit a
 * burst from a datacentre range.
 */

const UA = { "User-Agent": "khizapp-travel/1.0 (family road-trip app)" };

const GEOCODE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // places don't move
const MATCH_TTL_MS = 60 * 60 * 1000; // the trail grows as you drive

async function cacheRead<T>(key: string, ttlMs: number): Promise<T | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("app_config")
      .select("value, updated_at")
      .eq("key", key)
      .maybeSingle();
    if (!row) return null;
    if (Date.now() - new Date(row.updated_at).getTime() > ttlMs) return null;
    return ((row.value as Record<string, unknown>)?.v as T) ?? null;
  } catch (e) {
    console.error("[location] cache read failed", e);
    return null;
  }
}

async function cacheWrite(key: string, value: unknown): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("app_config")
      .upsert(
        { key, value: { v: value } as never, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
  } catch (e) {
    console.error("[location] cache write failed", e);
  }
}

/** Small random delay so concurrent devices don't hit OSM in lockstep. */
function jitter(): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * 400)));
}

async function fetchWithRetry(url: string, tries = 3): Promise<Response | null> {
  for (let i = 0; i < tries; i++) {
    await jitter();
    try {
      const res = await fetch(url, { headers: { ...UA, Accept: "application/json" } });
      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get("retry-after") ?? 0);
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : 800 * 2 ** i;
        if (i < tries - 1) {
          await new Promise((r) => setTimeout(r, Math.min(waitMs, 5000)));
          continue;
        }
        return null;
      }
      return res;
    } catch (e) {
      if (i === tries - 1) {
        console.error("[location] fetch failed", url, e);
        return null;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reverse geocoding — what place is this, actually?
// ---------------------------------------------------------------------------

export interface PlaceName {
  /** Best short label: town/village/city, falling back to county or state. */
  label: string;
  /** Country name, when known. */
  country?: string;
  /** Whether this came from the network or a coarse local fallback. */
  source: "osm" | "fallback";
}

const reverseInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/**
 * Where the device actually is, by name.
 *
 * Coordinates are rounded to ~1 km before they become a cache key, which both
 * keeps the cache useful while driving and avoids writing an exact position
 * into app_config as a key.
 */
export const reverseGeocode = createServerFn({ method: "GET" })
  .middleware([requireCapability("location.viewPrecise")])
  .inputValidator((d: unknown) => reverseInput.parse(d))
  .handler(async ({ data }): Promise<PlaceName | null> => {
    const rLat = Math.round(data.lat * 100) / 100;
    const rLng = Math.round(data.lng * 100) / 100;
    const key = `revgeo:${rLat},${rLng}`;

    const cached = await cacheRead<PlaceName>(key, GEOCODE_TTL_MS);
    if (cached) return cached;

    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&addressdetails=1` +
      `&lat=${encodeURIComponent(rLat)}&lon=${encodeURIComponent(rLng)}`;
    const res = await fetchWithRetry(url);
    if (!res?.ok) return null;

    try {
      const json = (await res.json()) as {
        address?: Record<string, string>;
        name?: string;
      };
      const a = json.address ?? {};
      const label =
        a.city ??
        a.town ??
        a.village ??
        a.municipality ??
        a.county ??
        a.state ??
        json.name ??
        "";
      if (!label) return null;
      const place: PlaceName = { label, country: a.country, source: "osm" };
      await cacheWrite(key, place);
      return place;
    } catch (e) {
      console.error("[location] reverse geocode parse failed", e);
      return null;
    }
  });

// ---------------------------------------------------------------------------
// The driven route — the recorded trail, snapped to roads
// ---------------------------------------------------------------------------

export interface RouteTrail {
  /** [lat, lng] pairs following actual roads. */
  path: Array<[number, number]>;
  /** Points that came back from the recorded trail before matching. */
  rawCount: number;
  /** True when OSRM matched the trail; false when this is the raw GPS line. */
  snapped: boolean;
  /**
   * Real driven distance for this trail, in km. Same number the fuel gauge
   * uses — both come from the one walker in location.service.ts.
   */
  drivenKm: number;
}

const trailInput = z.object({
  tripId: z.string().uuid().optional(),
  /** Cap on returned points; the map cannot usefully draw more. */
  maxPoints: z.number().int().min(50).max(4000).optional(),
});

/**
 * The route actually driven, as a road-following polyline.
 *
 * Replaces drawing straight lines between itinerary cities — a "route" that
 * ignored every detour, every real road, and the trail the app was already
 * recording.
 *
 * OSRM's /match limits how many coordinates it will accept, so the cleaned
 * trail is thinned before matching and matched in chunks. If matching fails
 * the raw GPS line is returned with `snapped: false` — a true line through
 * where the truck went beats a fabricated one through where it didn't.
 */
export const getRouteTrail = createServerFn({ method: "GET" })
  // Members, not the public. The matrix gives visitors a blurred position, and
  // an exact driven trail is not blurred: it shows the address the trip left
  // from and every overnight stop. Visitors keep the city-level covered route.
  .middleware([requireCapability("location.viewPrecise")])
  .inputValidator((d: unknown) => trailInput.parse(d ?? {}))
  .handler(async ({ data }): Promise<RouteTrail> => {
    const tripId = await resolveTripId(data.tripId);
    if (!tripId) return { path: [], rawCount: 0, snapped: false, drivenKm: 0 };

    // One walker, shared with the fuel gauge: the same fixes are rejected and
    // the same distance comes out, so the drawn line and the odometer agree.
    const trail = await getTrail(tripId);
    const clean = drawablePath(trail);
    const drivenKm = Math.round(trail.totalKm * 10) / 10;
    if (trail.rawCount === 0) {
      return { path: [], rawCount: 0, snapped: false, drivenKm: 0 };
    }
    if (clean.length < 2) {
      return {
        path: clean.map((p) => [p.lat, p.lng]),
        rawCount: trail.rawCount,
        snapped: false,
        drivenKm,
      };
    }

    // Thin to the requested budget, always keeping the endpoints.
    //
    // These are only the WAYPOINTS handed to the router — OSRM fills in the
    // road geometry between them, so a few hundred is plenty to pin the real
    // path (including detours) without sending a huge request. Feeding it
    // thousands would cost many chunks and return tens of thousands of points
    // that no map can usefully draw.
    const budget = data.maxPoints ?? 300;
    const thinned =
      clean.length <= budget
        ? clean
        : (() => {
            const step = clean.length / budget;
            const out: Array<{ lat: number; lng: number }> = [];
            for (let i = 0; i < budget; i++) out.push(clean[Math.floor(i * step)]);
            out.push(clean[clean.length - 1]);
            return out;
          })();

    const cacheKey = `route-trail:${tripId}:${thinned.length}:${thinned[thinned.length - 1].lat.toFixed(3)},${thinned[thinned.length - 1].lng.toFixed(3)}`;
    const cached = await cacheRead<RouteTrail>(cacheKey, MATCH_TTL_MS);
    if (cached) return cached;

    const snappedPath = await matchToRoads(thinned);
    const result: RouteTrail = snappedPath
      ? { path: decimate(snappedPath, 6000), rawCount: trail.rawCount, snapped: true, drivenKm }
      : {
          path: thinned.map((p) => [p.lat, p.lng]),
          rawCount: trail.rawCount,
          snapped: false,
          drivenKm,
        };

    await cacheWrite(cacheKey, result);
    return result;
  });

// ---------------------------------------------------------------------------
// How far we have actually come
// ---------------------------------------------------------------------------

export interface JourneyStats {
  /** Whole-trip distance actually driven, from the GPS trail. */
  drivenKm: number;
  /** Driven since midnight UTC today. */
  todayKm: number;
  /**
   * How much further the roads run than the straight line, measured on this
   * trip's own trail. Null until there is enough driving to say.
   */
  detourFactor: number | null;
  /** False when nothing has been recorded yet, so the UI can stay quiet. */
  hasData: boolean;
  lastTs: string | null;
}

const STATS_TTL_MS = 60 * 1000;

/**
 * Distance the family has really covered — aggregates only, never coordinates.
 *
 * The app used to answer this from straight lines between hardcoded city
 * centres, which understated a trip whose whole character is detours to towns
 * that were never in the plan. This counts the road.
 */
export const getJourneyStats = createServerFn({ method: "GET" })
  // Member-gated like the fuel gauge: it emits no positions, but "how far they
  // have driven today" is live operational detail about the family.
  .middleware([requireCapability("location.viewPrecise")])
  .inputValidator((d: unknown) =>
    z.object({ tripId: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }): Promise<JourneyStats> => {
    const empty: JourneyStats = {
      drivenKm: 0,
      todayKm: 0,
      detourFactor: null,
      hasData: false,
      lastTs: null,
    };
    const tripId = await resolveTripId(data.tripId);
    if (!tripId) return empty;

    const key = `journey-stats:${tripId}`;
    const cached = await cacheRead<JourneyStats>(key, STATS_TTL_MS);
    if (cached) return cached;

    const trail = await getTrail(tripId);
    if (trail.rawCount === 0 || trail.points.length === 0) return empty;

    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    const startOfDay = midnight.getTime();
    const todayPts = trail.points.filter((p) => p.t >= startOfDay);
    const todayKm =
      todayPts.length >= 2 ? todayPts[todayPts.length - 1].km - todayPts[0].km : 0;

    const stats: JourneyStats = {
      drivenKm: Math.round(trail.totalKm * 10) / 10,
      todayKm: Math.round(todayKm * 10) / 10,
      detourFactor: learnDetourFactor(trail),
      hasData: true,
      lastTs: trail.lastTs,
    };
    await cacheWrite(key, stats);
    return stats;
  });

/**
 * Evenly reduce a polyline to at most `max` points, always keeping both ends.
 * OSRM returns road geometry at roughly 5 m resolution; across a multi-thousand
 * km trip that is far more detail than a screen can show, and shipping it all
 * would make the response the slowest thing on the page.
 */
function decimate(
  path: Array<[number, number]>,
  max: number,
): Array<[number, number]> {
  if (path.length <= max) return path;
  const step = path.length / max;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < max; i++) out.push(path[Math.floor(i * step)]);
  out.push(path[path.length - 1]);
  return out;
}

/**
 * Snap a coordinate list onto the road network via OSRM's /route service.
 *
 * Deliberately NOT /match, which is the textbook map-matching API. The public
 * OSRM server refuses it in both directions this data can go: it answers
 * `NoMatch` for points minutes apart (which is what a 60-second recorder
 * produces — kilometres between fixes), and `TooBig` even for a short dense
 * run. Verified against the live server before choosing this.
 *
 * /route instead asks "what is the driving route through these waypoints",
 * which is well-behaved for sparse input and returns full road geometry.
 *
 * The honest caveat: between two consecutive fixes this returns the route OSRM
 * would pick, not provably the tarmac the truck touched. With fixes every ~60s
 * the gap is 1–2 km and the choice is heavily constrained, so it is a good
 * approximation — and enormously closer to the truth than a straight line
 * between cities hundreds of km apart.
 *
 * Chunked with a shared endpoint so segments join continuously. Returns null if
 * any chunk fails, so the caller falls back to the raw GPS line rather than
 * stitching snapped and unsnapped pieces into something misleading.
 */
async function matchToRoads(
  points: Array<{ lat: number; lng: number }>,
): Promise<Array<[number, number]> | null> {
  const CHUNK = 80; // demo server caps /route waypoints; stay well under
  const out: Array<[number, number]> = [];

  for (let start = 0; start < points.length; start += CHUNK - 1) {
    const chunk = points.slice(start, start + CHUNK);
    if (chunk.length < 2) break;

    const coords = chunk.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    const url =
      `https://router.project-osrm.org/route/v1/driving/${coords}` +
      `?geometries=geojson&overview=full`;
    const res = await fetchWithRetry(url, 2);
    if (!res?.ok) return null;

    try {
      const json = (await res.json()) as {
        code?: string;
        routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }>;
      };
      if (json.code !== "Ok" || !json.routes?.length) return null;
      for (const [lng, lat] of json.routes[0].geometry?.coordinates ?? []) {
        out.push([lat, lng]);
      }
    } catch (e) {
      console.error("[location] route parse failed", e);
      return null;
    }
  }

  return out.length >= 2 ? out : null;
}
