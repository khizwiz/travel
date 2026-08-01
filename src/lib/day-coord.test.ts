import { describe, expect, it } from "vitest";
import { reconcileCoord } from "@/lib/day-coord";

// The camera's coordinates are the only real evidence of where a photo was
// taken, and they must be checked against the TRIP, never against the single
// day the photo happens to be filed under. Photos get uploaded in bulk and
// land on whichever day the picker was showing, so comparing them with that
// day would drag genuinely-located pictures back to the wrong city.

const ISTANBUL = { lat: 41.0082, lng: 28.9784 };
const BUDAPEST = { lat: 47.4979, lng: 19.0402 };
const RIMINI = { lat: 44.0678, lng: 12.5695 };
const BERLIN = { lat: 52.52, lng: 13.405 };
const TRIP = [ISTANBUL, BUDAPEST, RIMINI, BERLIN];

// Where the developer works, far from every stop on the journey.
const WARSAW = { lat: 52.2297, lng: 21.0118 };

describe("reconcileCoord", () => {
  it("keeps a photo's own location even when it is filed under the wrong day", () => {
    // Taken in Rimini, uploaded in bulk onto a Budapest day: the whole reason
    // this compares against the trip rather than the day.
    const r = reconcileCoord(RIMINI, BUDAPEST, TRIP);
    expect(r.source).toBe("photo");
    expect(r.coord).toEqual(RIMINI);
  });

  it("accepts a roadside photo taken between two stops", () => {
    // Zagreb: about 300 km from both Budapest and Rimini, and squarely on the
    // drive between them. Known trip points are sparse — only days with a
    // booked stay have coordinates — so the gaps are genuinely this wide.
    const onTheDriveToRimini = { lat: 45.8, lng: 15.9 };
    expect(reconcileCoord(onTheDriveToRimini, BUDAPEST, TRIP).source).toBe("photo");
  });

  it("falls back to the day for a photo taken nowhere near the journey", () => {
    const r = reconcileCoord(WARSAW, BUDAPEST, TRIP);
    expect(r.source).toBe("photo-off-trip");
    expect(r.coord).toEqual(BUDAPEST);
  });

  it("uses the day when the photo carries no location", () => {
    const r = reconcileCoord(null, BUDAPEST, TRIP);
    expect(r.source).toBe("day");
    expect(r.coord).toEqual(BUDAPEST);
  });

  it("trusts the photo when there is nothing to check it against", () => {
    expect(reconcileCoord(WARSAW, null, TRIP)).toEqual({ coord: WARSAW, source: "photo" });
    expect(reconcileCoord(WARSAW, BUDAPEST, []).source).toBe("photo");
  });

  it("gives no pin rather than a guess when nothing is known", () => {
    expect(reconcileCoord(null, null, TRIP)).toEqual({ coord: null, source: "none" });
  });
});
