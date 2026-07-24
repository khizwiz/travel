/**
 * The one place that decides who may see and do what.
 *
 * Before this file, gating was invented three times over — `useAuth().isOwner`,
 * `useAdminAuth().isAdmin`, and per-component judgement calls — with server
 * functions each deciding their own auth. That is why fixing one screen kept
 * missing the others: the same feature was gated differently on every surface
 * it appeared on, and several surfaces weren't gated at all.
 *
 * Everything now derives from the matrix below: the navigation, the components,
 * and the server middleware. RLS mirrors it in SQL (see
 * `supabase/manual/2026-07-24-permission-matrix.sql`), because the client can
 * only ever hide things — the database is what actually refuses.
 *
 * Roles are deliberately only three, and each is a superset of the last:
 *
 *   public  — no session at all.
 *   member  — any authenticated user. Includes the crew/second admin password,
 *             which signs in as a real Supabase user like everyone else.
 *   owner   — the single account whose email matches OWNER_EMAIL.
 *
 * Role is derived from the Supabase JWT and nothing else. The admin token in
 * localStorage is a UI convenience; localStorage is writable by the user, so it
 * must never be the thing that grants access.
 */

export type Role = "public" | "member" | "owner";

/** Ordered by privilege — every check is "is the user's rank at least X". */
const RANK: Record<Role, number> = { public: 0, member: 1, owner: 2 };

export type Capability =
  // --- visible to everyone, including logged-out visitors ---
  | "trip.view" // itinerary, story feed, map route, achievements, home
  | "location.viewPublic" // deliberately blurred trail
  // --- any signed-in traveller ---
  | "location.viewPrecise"
  | "location.share" // record GPS points from this device
  | "suggestions.city"
  | "suggestions.nearbyAi"
  | "fuel.viewStatus"
  | "fuel.searchStations"
  | "fuel.recordFill"
  | "ask.use"
  | "cost.use"
  | "story.post"
  | "checklist.use"
  | "itinerary.edit"
  | "vehicle.admin"
  | "bookings.upload"
  | "documents.use"
  // --- owner only ---
  | "travellers.manage"
  | "settings.manage"
  | "export.run";

/**
 * Minimum role each capability requires. This table *is* the permission matrix
 * the owner signed off on; change behaviour by changing it here, never by
 * adding a role check somewhere else.
 */
export const CAPABILITIES: Record<Capability, Role> = {
  "trip.view": "public",
  "location.viewPublic": "public",

  "location.viewPrecise": "member",
  "location.share": "member",
  "suggestions.city": "member",
  "suggestions.nearbyAi": "member",
  "fuel.viewStatus": "member",
  "fuel.searchStations": "member",
  "fuel.recordFill": "member",
  "ask.use": "member",
  "cost.use": "member",
  "story.post": "member",
  "checklist.use": "member",
  "itinerary.edit": "member",
  "vehicle.admin": "member",
  "bookings.upload": "member",
  "documents.use": "member",

  "travellers.manage": "owner",
  "settings.manage": "owner",
  "export.run": "owner",
};

/** Does this role meet the bar for this capability? */
export function can(role: Role, capability: Capability): boolean {
  return RANK[role] >= RANK[CAPABILITIES[capability]];
}

/** Every capability a role has — handy for tests and for the audit report. */
export function capabilitiesFor(role: Role): Capability[] {
  return (Object.keys(CAPABILITIES) as Capability[]).filter((c) => can(role, c));
}

/**
 * Which route each page needs. Used by the nav to decide what to render and by
 * the route guards, so a hidden link and a typed-in URL agree.
 */
export const ROUTE_CAPABILITY: Record<string, Capability> = {
  "/": "trip.view",
  "/itinerary": "trip.view",
  "/story": "trip.view",
  "/map": "trip.view",
  "/vehicle": "trip.view",
  "/achievements": "trip.view",
  "/ask": "ask.use",
  "/cost": "cost.use",
  "/checklist": "checklist.use",
  "/bookings": "bookings.upload",
  "/documents": "documents.use",
  "/planning": "itinerary.edit",
  "/travellers": "travellers.manage",
  "/settings": "settings.manage",
  "/export": "export.run",
};

export function routeCapability(path: string): Capability | undefined {
  return ROUTE_CAPABILITY[path];
}
