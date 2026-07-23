/**
 * Declarative description of what an owner-initiated export copies, what it
 * must never copy, and how the importer should put it back.
 *
 * Two rules this file exists to enforce:
 *
 * 1. Rows are read with `select("*")` and filtered through `redact` — never an
 *    allowlist of columns. `src/integrations/supabase/types.ts` is generated and
 *    is already stale (it has no `trip_members.starter_password`, which exists
 *    in the database), so a column allowlist would silently drop real data.
 *
 * 2. Anything not listed here is not exported. New tables are opted in
 *    deliberately, because the default has to be "don't leak it".
 *
 * Only ids that come from `auth.users` differ between two Supabase projects.
 * Every other primary key is an independent uuid in a separate database, so the
 * importer copies those verbatim and foreign keys stay valid for free. That is
 * why `userColumns` is the only remapping the importer performs.
 */

export type ExportPolicy =
  /** Exported whenever the table is not explicitly deselected. */
  | "default"
  /** Large or derived; exported only when the owner ticks it. */
  | "opt-in"
  /** Never exported. `note` says why. */
  | "never";

export type TableSpec = {
  table: string;
  policy: ExportPolicy;
  /** Required for `opt-in` and `never`: the reason, so this stays auditable. */
  note?: string;
  /** Columns holding an `auth.users` id. The importer remaps these by email. */
  userColumns?: string[];
  /** Stable sort key for range pagination. */
  orderBy?: string;
  /** Conflict target for the importer's idempotent upsert. */
  conflict?: string;
  /** Stripped from every row before the dump leaves the server. */
  redact?: string[];
  /**
   * Drop the primary key on import and let the sequence assign a new one.
   * Only for identity/bigint keys that nothing references.
   */
  regenerateId?: boolean;
};

/**
 * Dependency order. The importer walks this array front to back, so a table
 * must appear after everything it references.
 */
export const EXPORT_TABLES: TableSpec[] = [
  // ---- identity ----------------------------------------------------------
  {
    table: "profiles",
    policy: "default",
    userColumns: ["id"],
    orderBy: "id",
    conflict: "id",
    // `email` is deliberately kept: it is the key the importer remaps ids by.
  },
  {
    table: "user_roles",
    policy: "default",
    userColumns: ["user_id"],
    orderBy: "id",
    conflict: "id",
  },
  {
    table: "role_bootstrap",
    policy: "default",
    orderBy: "email",
    conflict: "email",
  },
  { table: "badges", policy: "default", orderBy: "id", conflict: "id" },

  // ---- trip core ---------------------------------------------------------
  {
    table: "trips",
    policy: "default",
    userColumns: ["owner_id"],
    orderBy: "id",
    conflict: "id",
  },
  {
    table: "trip_members",
    policy: "default",
    userColumns: ["user_id"],
    orderBy: "id",
    conflict: "id",
    // App-generated starter password. Regenerable, and a JSON file on a laptop
    // is a wider blast radius than the owner-only screen it was meant for.
    redact: ["starter_password"],
  },
  { table: "cost_payers", policy: "default", orderBy: "id", conflict: "id" },
  { table: "emergency_contacts", policy: "default", orderBy: "id", conflict: "id" },

  // ---- itinerary ---------------------------------------------------------
  { table: "itinerary_days", policy: "default", orderBy: "id", conflict: "id" },
  {
    table: "day_travellers",
    policy: "default",
    userColumns: ["user_id"],
    orderBy: "id",
    conflict: "id",
  },
  { table: "accommodations", policy: "default", orderBy: "id", conflict: "id" },
  { table: "transport_legs", policy: "default", orderBy: "id", conflict: "id" },

  // ---- costs -------------------------------------------------------------
  {
    table: "trip_costs",
    policy: "default",
    userColumns: ["created_by", "paid_by", "approved_by"],
    orderBy: "id",
    conflict: "id",
  },
  {
    table: "trip_cost_splits",
    policy: "default",
    userColumns: ["participant_user_id"],
    orderBy: "id",
    conflict: "id",
  },

  // ---- documents & bookings ---------------------------------------------
  {
    table: "documents",
    policy: "default",
    userColumns: ["owner_id"],
    orderBy: "id",
    conflict: "id",
  },
  { table: "bookings", policy: "default", orderBy: "id", conflict: "id" },
  {
    table: "booking_uploads",
    policy: "default",
    userColumns: ["uploaded_by", "approved_by"],
    orderBy: "id",
    conflict: "id",
  },

  // ---- vehicle -----------------------------------------------------------
  { table: "vehicle_profiles", policy: "default", orderBy: "id", conflict: "id" },
  { table: "maintenance_items", policy: "default", orderBy: "id", conflict: "id" },
  { table: "maintenance_logs", policy: "default", orderBy: "id", conflict: "id" },
  {
    table: "vehicle_check_ins",
    policy: "default",
    userColumns: ["by_user"],
    orderBy: "id",
    conflict: "id",
  },
  {
    table: "fuel_logs",
    policy: "default",
    userColumns: ["by_user"],
    orderBy: "id",
    conflict: "id",
  },

  // ---- story -------------------------------------------------------------
  {
    table: "posts",
    policy: "default",
    userColumns: ["author_id"],
    orderBy: "id",
    conflict: "id",
  },
  { table: "post_media", policy: "default", orderBy: "id", conflict: "id" },
  {
    table: "destination_photos",
    policy: "default",
    userColumns: ["uploaded_by"],
    orderBy: "id",
    conflict: "id",
  },
  {
    table: "comments",
    policy: "default",
    userColumns: ["author_id"],
    orderBy: "id",
    conflict: "id",
  },
  {
    table: "reactions",
    policy: "default",
    userColumns: ["user_id"],
    orderBy: "id",
    conflict: "id",
  },
  {
    table: "recommendations",
    policy: "default",
    userColumns: ["author_id"],
    orderBy: "id",
    conflict: "id",
  },

  // ---- gamification ------------------------------------------------------
  { table: "missions", policy: "default", orderBy: "id", conflict: "id" },
  {
    table: "mission_completions",
    policy: "default",
    userColumns: ["user_id"],
    orderBy: "id",
    conflict: "id",
  },
  {
    table: "side_quests",
    policy: "default",
    userColumns: ["created_by"],
    orderBy: "id",
    conflict: "id",
  },
  {
    table: "user_badges",
    policy: "default",
    userColumns: ["user_id"],
    orderBy: "id",
    conflict: "id",
  },
  {
    table: "individual_scores",
    policy: "default",
    userColumns: ["user_id"],
    orderBy: "trip_id",
    conflict: "trip_id,user_id",
  },
  { table: "group_scores", policy: "default", orderBy: "trip_id", conflict: "trip_id" },

  // ---- invitations & notifications --------------------------------------
  {
    table: "passenger_invitations",
    policy: "default",
    userColumns: ["created_by", "accepted_user_id"],
    orderBy: "id",
    conflict: "id",
    // Bearer material for the invite links. The invite is re-issuable; the hash
    // is not worth carrying around in a file.
    redact: ["token_hash"],
  },
  {
    table: "notification_preferences",
    policy: "default",
    userColumns: ["user_id"],
    orderBy: "user_id",
    conflict: "user_id",
  },
  {
    table: "notifications",
    policy: "opt-in",
    note: "Delivery log rather than trip content; grows without bound.",
    userColumns: ["user_id"],
    orderBy: "id",
    conflict: "id",
  },

  // ---- GPS ---------------------------------------------------------------
  {
    table: "location_points",
    policy: "opt-in",
    note:
      "The raw GPS trail. Far the largest table and the one that can blow the " +
      "Worker's response/CPU budget, so it is off unless asked for. Fuel usage " +
      "is derived from it, so a full restore needs it.",
    userColumns: ["user_id"],
    orderBy: "id",
    conflict: "id",
    // bigint identity, nothing references it — let the sequence re-assign.
    regenerateId: true,
  },
  {
    table: "public_location_points",
    policy: "opt-in",
    note: "Blurred projection of location_points; regenerated by sanitise_locations().",
    orderBy: "id",
    conflict: "id",
    regenerateId: true,
  },

  // ---- weather -----------------------------------------------------------
  {
    table: "weather_snapshots",
    policy: "opt-in",
    note: "Re-fetchable from the weather API; kept only for historical fidelity.",
    orderBy: "id",
    conflict: "id",
  },

  // ---- never -------------------------------------------------------------
  {
    table: "app_config",
    policy: "never",
    note:
      "Holds `vapid_keys` — a live private key — next to real trip data. " +
      "Exported through APP_CONFIG_KEY_PREFIXES instead, never as a whole table.",
  },
  {
    table: "push_subscriptions",
    policy: "never",
    note:
      "Browser endpoints plus auth keys, bound to this deployment's VAPID pair. " +
      "Secret, and meaningless in another project — devices must re-subscribe.",
  },
  {
    table: "cost_share_snapshots",
    policy: "never",
    note: "Short-lived public share tokens with an expiry. Re-issued on demand.",
  },
  {
    table: "access_audit_log",
    policy: "never",
    note: "Operational log, and it stores IP addresses.",
  },
  {
    table: "block_list",
    policy: "never",
    note: "Moderation state keyed by visitor tokens from this deployment.",
  },
  {
    table: "content_reports",
    policy: "never",
    note: "Moderation state keyed by visitor tokens from this deployment.",
  },
  {
    table: "rate_limit_buckets",
    policy: "never",
    note: "Ephemeral counters, worthless seconds after they are written.",
  },
  {
    table: "translations",
    policy: "never",
    note: "Rebuildable translation cache.",
  },
  {
    table: "profiles_public",
    policy: "never",
    note: "A view over profiles, not a table.",
  },
];

/**
 * `app_config` is a shared key/value store that mixes real trip data with
 * caches and at least one live secret (`vapid_keys`). Only keys matching one of
 * these prefixes are exported; anything unrecognised is dropped, so a new cache
 * key added later fails closed.
 */
export const APP_CONFIG_KEY_PREFIXES = [
  "fuel-log:", // fills the owner recorded — real data, not derivable
  "fuel-status:", // learned L/100km calibration
] as const;

/** Buckets walked for the file listing. Metadata only; bodies are never inlined. */
export const STORAGE_BUCKETS = ["documents", "receipts", "destination-photos"] as const;

/** Bumped whenever the shape of the dump changes, so the importer can refuse a mismatch. */
export const EXPORT_FORMAT_VERSION = 1;

export const DEFAULT_TABLES = EXPORT_TABLES.filter((t) => t.policy === "default");
export const OPT_IN_TABLES = EXPORT_TABLES.filter((t) => t.policy === "opt-in");
export const EXCLUDED_TABLES = EXPORT_TABLES.filter((t) => t.policy === "never");

export function findTable(name: string): TableSpec | undefined {
  return EXPORT_TABLES.find((t) => t.table === name);
}

/** Tables the owner is allowed to ask for, in import-dependency order. */
export function selectableTables(): TableSpec[] {
  return EXPORT_TABLES.filter((t) => t.policy !== "never");
}
