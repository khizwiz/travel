import { describe, it, expect } from "vitest";
import { can, capabilitiesFor, routeCapability, CAPABILITIES, type Capability } from "./permissions";

/**
 * These lock down the matrix the owner signed off on. They are cheap, but they
 * are the thing that catches a capability being quietly downgraded later —
 * which is exactly how the original leaks happened.
 */

describe("permission matrix", () => {
  it("gives logged-out visitors the trip story and nothing operational", () => {
    expect(can("public", "trip.view")).toBe(true);
    expect(can("public", "location.viewPublic")).toBe(true);

    // The three reported leaks.
    expect(can("public", "fuel.searchStations")).toBe(false);
    expect(can("public", "suggestions.city")).toBe(false);
    expect(can("public", "suggestions.nearbyAi")).toBe(false);

    // And the rest of the operational surface.
    expect(can("public", "fuel.viewStatus")).toBe(false);
    expect(can("public", "location.viewPrecise")).toBe(false);
    expect(can("public", "ask.use")).toBe(false);
    expect(can("public", "cost.use")).toBe(false);
    expect(can("public", "documents.use")).toBe(false);
  });

  it("gives members everything except owner administration", () => {
    expect(can("member", "fuel.searchStations")).toBe(true);
    expect(can("member", "suggestions.city")).toBe(true);
    expect(can("member", "documents.use")).toBe(true);
    expect(can("member", "bookings.upload")).toBe(true);
    expect(can("member", "itinerary.edit")).toBe(true);

    expect(can("member", "travellers.manage")).toBe(false);
    expect(can("member", "settings.manage")).toBe(false);
    expect(can("member", "export.run")).toBe(false);
  });

  it("gives the owner everything", () => {
    const all = Object.keys(CAPABILITIES) as Capability[];
    for (const c of all) expect(can("owner", c)).toBe(true);
  });

  it("keeps roles strictly nested: public ⊂ member ⊂ owner", () => {
    const pub = capabilitiesFor("public");
    const mem = capabilitiesFor("member");
    const own = capabilitiesFor("owner");
    expect(mem).toEqual(expect.arrayContaining(pub));
    expect(own).toEqual(expect.arrayContaining(mem));
    expect(own.length).toBeGreaterThan(mem.length);
    expect(mem.length).toBeGreaterThan(pub.length);
  });

  it("gates the owner-only routes", () => {
    for (const path of ["/travellers", "/settings", "/export"]) {
      const cap = routeCapability(path);
      expect(cap).toBeDefined();
      expect(can("member", cap!)).toBe(false);
      expect(can("owner", cap!)).toBe(true);
    }
  });

  it("leaves no route ungated by accident", () => {
    // Every nav destination must map to a capability; a missing entry would
    // silently render the link for everyone.
    for (const path of [
      "/",
      "/itinerary",
      "/story",
      "/map",
      "/vehicle",
      "/achievements",
      "/ask",
      "/cost",
      "/checklist",
      "/bookings",
      "/documents",
      "/travellers",
      "/settings",
    ]) {
      expect(routeCapability(path), `route ${path} has no capability`).toBeDefined();
    }
  });
});
