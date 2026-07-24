import { describe, expect, it } from "vitest";
import { drawablePath, kmAt, learnDetourFactor, walkTrail, type RawFix } from "@/lib/location.service";

// One walker now feeds both the fuel gauge and the map line, so the rules it
// applies to a fix are worth pinning down: they decide the odometer.

const T0 = Date.parse("2026-07-01T08:00:00.000Z");

function fix(minutes: number, lat: number, lng: number, accuracy_m: number | null = 10): RawFix {
  return { lat, lng, ts: new Date(T0 + minutes * 60_000).toISOString(), accuracy_m };
}

// ~0.009 degrees of latitude is almost exactly 1 km.
const KM = 0.008993;

describe("walkTrail", () => {
  it("sums consecutive legs, so a detour is counted in full", () => {
    // Straight north 2 km, then back south 2 km: the crow flies nowhere, but
    // the truck drove 4 km. This is the case beeline distance always got wrong.
    const trail = walkTrail([
      fix(0, 45, 10),
      fix(2, 45 + 2 * KM, 10),
      fix(4, 45, 10),
    ]);
    expect(trail.totalKm).toBeCloseTo(4, 1);
    expect(trail.points).toHaveLength(3);
  });

  it("drops fixes too fuzzy to be a position", () => {
    const trail = walkTrail([fix(0, 45, 10), fix(2, 45 + 2 * KM, 10, 900)]);
    expect(trail.totalKm).toBe(0);
    expect(trail.rawCount).toBe(2);
  });

  it("ignores parked jitter but keeps the anchor, so slow real movement still counts", () => {
    // Six 10 m wobbles never move the anchor. If each were compared with its
    // neighbour instead, a genuine slow crawl would be filtered away entirely.
    const wobble = KM * 0.01;
    const trail = walkTrail([
      fix(0, 45, 10),
      fix(1, 45 + wobble, 10),
      fix(2, 45 + 2 * wobble, 10),
      fix(3, 45 + 3 * wobble, 10),
      fix(4, 45 + 1 * KM, 10),
    ]);
    expect(trail.totalKm).toBeCloseTo(1, 1);
  });

  it("does not count a teleport as driving, and marks it as a break", () => {
    // 500 km in one minute is a bad fix, not a drive.
    const trail = walkTrail([fix(0, 45, 10), fix(1, 50, 10), fix(3, 50 + KM, 10)]);
    expect(trail.totalKm).toBeCloseTo(1, 1);
    const breaks = trail.points.filter((p) => p.isBreak);
    expect(breaks).toHaveLength(1);
    // The jump is believed as a position but never drawn as a road.
    expect(drawablePath(trail)).toHaveLength(2);
  });

  it("reports cumulative distance at a moment in time", () => {
    const trail = walkTrail([
      fix(0, 45, 10),
      fix(10, 45 + 3 * KM, 10),
      fix(20, 45 + 8 * KM, 10),
    ]);
    expect(kmAt(trail.marks, T0 + 10 * 60_000)).toBeCloseTo(3, 1);
    expect(kmAt(trail.marks, T0 + 20 * 60_000)).toBeCloseTo(8, 1);
    // Before the trip started, nothing has been driven.
    expect(kmAt(trail.marks, T0 - 60_000)).toBe(0);
  });
});

describe("learnDetourFactor", () => {
  it("stays null until there is enough driving to mean anything", () => {
    expect(learnDetourFactor(walkTrail([fix(0, 45, 10), fix(5, 45 + KM, 10)]))).toBeNull();
  });

  it("measures how much further the road runs than the straight line", () => {
    // Two days, each a 20 km dog-leg east then north: driven 40 km, crow ~28.3.
    const raw: RawFix[] = [];
    for (let day = 0; day < 2; day++) {
      const base = day * 24 * 60;
      raw.push(fix(base, 45, 10));
      raw.push(fix(base + 60, 45, 10 + 20 * KM * Math.SQRT2));
      raw.push(fix(base + 120, 45 + 20 * KM, 10 + 20 * KM * Math.SQRT2));
    }
    const factor = learnDetourFactor(walkTrail(raw));
    expect(factor).not.toBeNull();
    expect(factor!).toBeGreaterThan(1.1);
    expect(factor!).toBeLessThan(1.6);
  });
});
