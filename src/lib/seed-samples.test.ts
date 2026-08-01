import { describe, expect, it } from "vitest";
import { selectVisitedDays, type SeedDay } from "@/lib/seed-samples";

// Which days get a sample photo is a rule with teeth: seeding a future day
// publishes a photograph of somewhere the trip has not reached, and the public
// map deliberately hides upcoming stops.

const day = (id: string, day_date: string, title?: string | null): SeedDay => ({
  id,
  day_date,
  title,
});

const TODAY = "2026-07-29";

describe("selectVisitedDays", () => {
  it("never chooses a day in the future", () => {
    const days = [
      day("a", "2026-07-27", "Sofia"),
      day("b", "2026-07-29", "Belgrade"),
      day("c", "2026-07-30", "Budapest"),
      day("d", "2026-08-04", "Verona"),
    ];
    const { chosen } = selectVisitedDays(days, TODAY, 10);
    expect(chosen.map((d) => d.title)).toEqual(["Sofia", "Belgrade"]);
  });

  it("counts today itself as reached", () => {
    const { chosen } = selectVisitedDays([day("a", TODAY, "Belgrade")], TODAY, 10);
    expect(chosen).toHaveLength(1);
  });

  it("gives a multi-night stay one photo, not one per night", () => {
    const days = [
      day("a", "2026-07-25", "Rome"),
      day("b", "2026-07-26", "Rome"),
      day("c", "2026-07-27", "Rome"),
      day("d", "2026-07-28", "Pescara"),
    ];
    const { chosen } = selectVisitedDays(days, TODAY, 10);
    expect(chosen.map((d) => d.title)).toEqual(["Rome", "Pescara"]);
    // The earliest day of the stay is the one kept.
    expect(chosen[0].id).toBe("a");
  });

  it("treats untitled days as distinct rather than collapsing them", () => {
    const days = [day("a", "2026-07-25", null), day("b", "2026-07-26", null)];
    expect(selectVisitedDays(days, TODAY, 10).chosen).toHaveLength(2);
  });

  it("spreads across the whole journey when capped, and reports the remainder", () => {
    const days = Array.from({ length: 10 }, (_, i) =>
      day(`d${i}`, `2026-07-${String(10 + i).padStart(2, "0")}`, `City ${i}`),
    );
    const { chosen, dropped } = selectVisitedDays(days, TODAY, 4);
    expect(chosen).toHaveLength(4);
    expect(dropped).toBe(6);
    // Not merely the first four: the last pick comes from late in the trip.
    expect(chosen[0].title).toBe("City 0");
    expect(chosen[3].title).toBe("City 7");
    // Strictly increasing, so the timeline still reads in order.
    const dates = chosen.map((d) => d.day_date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("returns nothing before the trip starts", () => {
    const days = [day("a", "2026-08-01", "Istanbul")];
    expect(selectVisitedDays(days, TODAY, 6)).toEqual({ chosen: [], dropped: 0 });
  });
});
