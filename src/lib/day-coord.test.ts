import { describe, expect, it } from "vitest";
import { reconcileCoord } from "@/lib/day-coord";

// A photo's own coordinates are the best evidence — right up until they are
// evidence about somewhere the trip never went, which is what happens when
// pictures are sorted at home. Getting this balance wrong either scatters the
// map with the wrong countries or throws away real positions.

const BUDAPEST = { lat: 47.4979, lng: 19.0402 };
const WARSAW = { lat: 52.2297, lng: 21.0118 };
const NEAR_BUDAPEST = { lat: 47.6, lng: 19.2 }; // a roadside stop
const VIENNA = { lat: 48.2082, lng: 16.3738 }; // ~215 km, same driving day

describe("reconcileCoord", () => {
  it("believes the photo when it agrees with the day", () => {
    const r = reconcileCoord(NEAR_BUDAPEST, BUDAPEST);
    expect(r.source).toBe("photo");
    expect(r.coord).toEqual(NEAR_BUDAPEST);
  });

  it("still believes the photo across a long driving day", () => {
    // A day covers a drive; both ends are legitimately far apart.
    expect(reconcileCoord(VIENNA, BUDAPEST).source).toBe("photo");
  });

  it("prefers the day when the photo is somewhere the trip was not", () => {
    // Sorting trip photos at home in Warsaw: valid coordinates, wrong country.
    const r = reconcileCoord(WARSAW, BUDAPEST);
    expect(r.source).toBe("photo-far");
    expect(r.coord).toEqual(BUDAPEST);
  });

  it("uses the day when the photo has no location", () => {
    const r = reconcileCoord(null, BUDAPEST);
    expect(r.source).toBe("day");
    expect(r.coord).toEqual(BUDAPEST);
  });

  it("uses the photo when the day's location is unknown", () => {
    const r = reconcileCoord(WARSAW, null);
    expect(r.source).toBe("photo");
    expect(r.coord).toEqual(WARSAW);
  });

  it("gives no pin rather than a guess when neither is known", () => {
    expect(reconcileCoord(null, null)).toEqual({ coord: null, source: "none" });
  });
});
