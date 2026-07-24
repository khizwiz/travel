import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireCapability } from "@/integrations/supabase/permission-middleware";
import { z } from "zod";
import { haversineKm } from "@/lib/geo";
import { VEHICLE } from "@/lib/trip-data";

// ── Fuel tracking, derived from the ACTUAL GPS route ──────────────────────────
// The old card accumulated km in one device's localStorage, only while the Fuel
// page was open — detours to visited towns were missed and nothing was shared.
// This computes the driven distance from the recorded location_points trail on
// the server (so every detour counts, once), stores fills centrally, and learns
// the vehicle's real l/100km from the litres actually put in over that distance.

const DEFAULT_L_PER_100 = 9;      // diesel L200 rough baseline until we measure
const MAX_ACCURACY_M = 500;       // drop very fuzzy fixes
const MIN_STEP_KM = 0.02;         // ignore GPS jitter while parked
const MAX_SPEED_KMH = 160;        // steps implying faster than this = bad fix
const MIN_SEGMENT_KM = 15;        // a tank must cover this far to trust its l/100
const STATUS_TTL_MS = 30_000;     // cache the computed status briefly
const CONSUMPTION_FLOOR = 4;      // clamp learned l/100 to a sane band
const CONSUMPTION_CEIL = 25;
const DEFAULT_SLUG = "eu-tripping-2026";

export interface Fill {
  ts: string;
  litres: number | null; // null = "tank full" logged without entering litres
}

export interface FuelStatus {
  hasData: boolean;
  totalKm: number;         // whole-trip distance from the GPS trail
  sinceKm: number;         // driven since the last fill (or trip start)
  tankPct: number;         // estimated % left in the tank
  estSinceL: number;       // estimated litres burned since last fill
  learnedLPer100: number;  // consumption used for estimates
  measured: boolean;       // true once learned from a real fill
  totalTankedL: number;    // sum of litres actually put in
  totalEstUsedL: number;   // whole-trip estimated litres
  fills: number;
  lastFillTs: string | null;
  lastFillLitres: number | null;
  pointsCounted: number;
  lastTs: string | null;
  tankLitres: number;
  lowPct: number;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function resolveTrip(tripId?: string): Promise<{ id: string; owner_id: string } | null> {
  const db = await admin();
  const q = db.from("trips").select("id, owner_id");
  const { data } = tripId
    ? await q.eq("id", tripId).maybeSingle()
    : await q.eq("slug", DEFAULT_SLUG).maybeSingle();
  return (data as any) ?? null;
}

async function fetchLog(tripId: string): Promise<Fill[]> {
  const db = await admin();
  const { data } = await db
    .from("app_config")
    .select("value")
    .eq("key", `fuel-log:${tripId}`)
    .maybeSingle();
  const arr = (data?.value as any)?.fills;
  return Array.isArray(arr) ? (arr as Fill[]) : [];
}

async function writeLog(tripId: string, fills: Fill[]): Promise<void> {
  const db = await admin();
  await db.from("app_config").upsert({
    key: `fuel-log:${tripId}`,
    value: { fills } as any,
    updated_at: new Date().toISOString(),
  });
}

async function readStatusCache(tripId: string): Promise<FuelStatus | null> {
  try {
    const db = await admin();
    const { data } = await db
      .from("app_config")
      .select("value, updated_at")
      .eq("key", `fuel-status:${tripId}`)
      .maybeSingle();
    if (!data) return null;
    if (Date.now() - new Date(data.updated_at).getTime() > STATUS_TTL_MS) return null;
    return ((data.value as any)?.status as FuelStatus) ?? null;
  } catch {
    return null;
  }
}

async function writeStatusCache(tripId: string, status: FuelStatus): Promise<void> {
  try {
    const db = await admin();
    await db.from("app_config").upsert({
      key: `fuel-status:${tripId}`,
      value: { status } as any,
      updated_at: new Date().toISOString(),
    });
  } catch {
    /* cache is best-effort */
  }
}

interface Timeline {
  totalKm: number;
  marks: { ts: number; km: number }[]; // cumulative km at each accepted fix
  points: number;
  lastTs: string | null;
}

// Sum the real driven distance from the ordered GPS trail. Detours are included
// because every accepted fix adds its leg; jitter, teleports and fuzzy fixes are
// filtered so a parked phone or a bad cell fix doesn't inflate the odometer.
async function computeTimeline(tripId: string): Promise<Timeline> {
  const db = await admin();
  const pageSize = 1000;
  const raw: any[] = [];
  for (let page = 0; page < 60; page++) {
    const from = page * pageSize;
    const { data, error } = await db
      .from("location_points")
      .select("lat, lng, ts, accuracy_m")
      .eq("trip_id", tripId)
      .order("ts", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    raw.push(...data);
    if (data.length < pageSize) break;
  }

  let total = 0;
  const marks: { ts: number; km: number }[] = [];
  let anchor: { lat: number; lng: number; t: number } | null = null;
  let lastTs: string | null = null;

  for (const p of raw) {
    const acc = p.accuracy_m;
    if (acc != null && Number(acc) > MAX_ACCURACY_M) continue;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    const t = new Date(p.ts).getTime();
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(t)) continue;
    lastTs = p.ts;
    if (!anchor) {
      anchor = { lat, lng, t };
      marks.push({ ts: t, km: 0 });
      continue;
    }
    const step = haversineKm({ lat: anchor.lat, lng: anchor.lng }, { lat, lng });
    if (step < MIN_STEP_KM) continue; // jitter: keep the anchor, wait for real movement
    const dtH = (t - anchor.t) / 3_600_000;
    if (dtH > 0 && step / dtH > MAX_SPEED_KMH) {
      anchor = { lat, lng, t }; // teleport / bad fix: reset without adding the leg
      continue;
    }
    total += step;
    marks.push({ ts: t, km: total });
    anchor = { lat, lng, t };
  }
  return { totalKm: total, marks, points: raw.length, lastTs };
}

function kmAt(marks: { ts: number; km: number }[], tsMs: number): number {
  let km = 0;
  for (const m of marks) {
    if (m.ts <= tsMs) km = m.km;
    else break;
  }
  return km;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

async function buildStatus(tripId: string): Promise<FuelStatus> {
  const [tl, fills] = await Promise.all([computeTimeline(tripId), fetchLog(tripId)]);
  const sorted = fills
    .filter((f) => f && typeof f.ts === "string")
    .sort((a, b) => a.ts.localeCompare(b.ts));

  // Learn real consumption: each fill's litres cover the distance since the
  // previous fill (or trip start). Weight by distance so long tanks matter more.
  let learnLitres = 0;
  let learnKm = 0;
  let prevOdo = 0;
  const perFill = sorted.map((f) => {
    const odo = kmAt(tl.marks, new Date(f.ts).getTime());
    const segKm = Math.max(0, odo - prevOdo);
    if (f.litres != null && f.litres > 0 && segKm >= MIN_SEGMENT_KM) {
      learnLitres += f.litres;
      learnKm += segKm;
    }
    prevOdo = odo;
    return { ...f, odo };
  });

  const measured = learnKm > 0;
  let learned = measured ? (learnLitres / learnKm) * 100 : DEFAULT_L_PER_100;
  learned = Math.min(CONSUMPTION_CEIL, Math.max(CONSUMPTION_FLOOR, learned));

  const lastOdo = perFill.length ? perFill[perFill.length - 1].odo : 0;
  const sinceKm = Math.max(0, tl.totalKm - lastOdo);
  const estSince = (sinceKm * learned) / 100;
  const tankPct = Math.max(
    0,
    Math.min(100, Math.round(100 - (estSince / VEHICLE.tankLitres) * 100)),
  );
  const totalTankedL = sorted.reduce((s, f) => s + (f.litres ?? 0), 0);
  const totalEstUsedL = (tl.totalKm * learned) / 100;
  const last = perFill.length ? perFill[perFill.length - 1] : null;

  return {
    hasData: tl.points > 0,
    totalKm: r1(tl.totalKm),
    sinceKm: r1(sinceKm),
    tankPct,
    estSinceL: r1(estSince),
    learnedLPer100: r1(learned),
    measured,
    totalTankedL: r1(totalTankedL),
    totalEstUsedL: r1(totalEstUsedL),
    fills: sorted.length,
    lastFillTs: last?.ts ?? null,
    lastFillLitres: last?.litres ?? null,
    pointsCounted: tl.points,
    lastTs: tl.lastTs,
    tankLitres: VEHICLE.tankLitres,
    lowPct: VEHICLE.lowFuelWarnPct,
  };
}

const tripInput = z.object({ tripId: z.string().uuid().optional() });

// Members only. Was a public read: although it emits no raw coordinates, tank
// level and learned l/100km are live operational detail about where the family
// is and how far they can get, which is not a visitor's business.
export const getFuelStatus = createServerFn({ method: "GET" })
  .middleware([requireCapability("fuel.viewStatus")])
  .inputValidator((d: unknown) => tripInput.parse(d ?? {}))
  .handler(async ({ data }): Promise<FuelStatus | null> => {
    const trip = await resolveTrip(data.tripId);
    if (!trip) return null;
    const cached = await readStatusCache(trip.id);
    if (cached) return cached;
    const status = await buildStatus(trip.id);
    await writeStatusCache(trip.id, status);
    return status;
  });

const fillInput = z.object({
  tripId: z.string().uuid().optional(),
  litres: z.number().min(0).max(500).nullable().optional(),
});

// Owner (driver) logs a full tank. Litres optional: if given we learn the real
// l/100 for the tank just burned; if omitted it still resets the gauge.
export const recordFuelFill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => fillInput.parse(d))
  .handler(async ({ data, context }): Promise<FuelStatus> => {
    const trip = await resolveTrip(data.tripId);
    if (!trip) throw new Error("No trip found");
    if (trip.owner_id !== context.userId) throw new Error("Only the trip owner can log fuel");
    const fills = await fetchLog(trip.id);
    fills.push({
      ts: new Date().toISOString(),
      litres: data.litres != null && data.litres > 0 ? data.litres : null,
    });
    await writeLog(trip.id, fills);
    const status = await buildStatus(trip.id);
    await writeStatusCache(trip.id, status);
    return status;
  });

// Owner: undo the most recent fill (mis-tap or wrong litres).
export const undoLastFill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => tripInput.parse(d))
  .handler(async ({ data, context }): Promise<FuelStatus> => {
    const trip = await resolveTrip(data.tripId);
    if (!trip) throw new Error("No trip found");
    if (trip.owner_id !== context.userId) throw new Error("Only the trip owner can edit fuel");
    const fills = await fetchLog(trip.id);
    fills.pop();
    await writeLog(trip.id, fills);
    const status = await buildStatus(trip.id);
    await writeStatusCache(trip.id, status);
    return status;
  });
