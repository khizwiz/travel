import { describe, expect, it } from "vitest";
import { differsFromPlan, type PlanOverride } from "@/hooks/use-plan-overrides";
import { ITINERARY } from "@/lib/trip-data";

// Every itinerary day now exists as a database row, because the plan is copied
// there so photos and bookings have something to attach to. So a row can no
// longer mean "this day was changed" — get this wrong and all 41 days are
// labelled "Re-routed" against themselves.

const first = ITINERARY[0];

/** A row exactly as the scaffold writes it from the plan. */
const asStored = (d: typeof first): PlanOverride => ({
  day_date: d.date,
  title: !d.to || d.from === d.to ? d.from : `${d.from} → ${d.to}`,
  summary: null,
  distance_km: d.distanceKm ?? null,
  duration_min: d.durationMin ?? null,
  from: d.from,
  to: d.to ?? null,
  transport: d.transport ?? null,
  day_kind: d.kind ?? "destination",
});

describe("differsFromPlan", () => {
  it("does not treat a faithful copy of the plan as a re-route", () => {
    expect(differsFromPlan(asStored(first))).toBe(false);
  });

  it("ignores every day the scaffold copies across", () => {
    const flagged = ITINERARY.filter((d) => differsFromPlan(asStored(d)));
    expect(flagged.map((d) => d.date)).toEqual([]);
  });

  it("spots a changed destination", () => {
    expect(differsFromPlan({ ...asStored(first), to: "Plovdiv" })).toBe(true);
  });

  it("spots a changed transport mode or distance", () => {
    expect(differsFromPlan({ ...asStored(first), transport: "ferry" })).toBe(true);
    expect(differsFromPlan({ ...asStored(first), distance_km: 999 })).toBe(true);
  });

  it("counts a day the plan never had as a genuine addition", () => {
    expect(differsFromPlan({ ...asStored(first), day_date: "2020-07-23" })).toBe(true);
  });

  it("is not fooled by case or padding", () => {
    expect(differsFromPlan({ ...asStored(first), to: `  ${first.to?.toUpperCase()} ` })).toBe(
      false,
    );
  });

  it("treats a field the row leaves null as unchanged, not as a difference", () => {
    expect(
      differsFromPlan({ ...asStored(first), to: null, transport: null, distance_km: null }),
    ).toBe(false);
  });
});
