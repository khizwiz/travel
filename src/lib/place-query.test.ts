import { describe, expect, it } from "vitest";
import { placeQuery } from "@/lib/location.functions";

// Day titles carry app vocabulary a gazetteer has never heard of. Getting this
// wrong means a lookup for "Re-routed: Rimini, Italy" finds nothing and the
// day keeps no location — which is precisely why the map could not place
// photos the story page was already labelling correctly.

describe("placeQuery", () => {
  it("strips the re-routed prefix", () => {
    expect(placeQuery("Re-routed: Rimini, Italy")).toBe("Rimini, Italy");
    expect(placeQuery("Rerouted: Verona")).toBe("Verona");
  });

  it("resolves a travel day to where it ended", () => {
    // The evening, and most of the photographs, happen at the destination.
    expect(placeQuery("Budapest → Zagreb")).toBe("Zagreb");
    expect(placeQuery("Istanbul -> Sofia")).toBe("Sofia");
  });

  it("handles both together", () => {
    expect(placeQuery("Re-routed: Budapest → Rimini, Italy")).toBe("Rimini, Italy");
  });

  it("leaves a plain place name alone", () => {
    expect(placeQuery("Berlin")).toBe("Berlin");
    expect(placeQuery("  Lake Garda  ")).toBe("Lake Garda");
  });

  it("returns nothing for days that name no real place", () => {
    expect(placeQuery("Open planning period")).toBeNull();
    expect(placeQuery("Open day")).toBeNull();
    expect(placeQuery("Rest day")).toBeNull();
    expect(placeQuery("")).toBeNull();
    expect(placeQuery("   ")).toBeNull();
  });
});
