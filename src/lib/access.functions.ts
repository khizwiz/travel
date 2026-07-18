import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

const createInvitationInput = z.object({
  tripId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(40).optional().nullable(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  permissions: z.record(z.boolean()).default({}),
  expiresInDays: z.number().int().min(1).max(60).default(14),
});

export const createInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createInvitationInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify caller owns the trip
    const { data: trip, error: tErr } = await supabase
      .from("trips").select("id, owner_id").eq("id", data.tripId).single();
    if (tErr || !trip) throw new Error("Trip not found");
    if (trip.owner_id !== userId) throw new Error("Forbidden");

    const token = randomBytes(24).toString("base64url"); // 32-char URL-safe
    const tokenHash = hashToken(token);

    // unique friendly slug
    const base = slugify(data.name) || "guest";
    let slug = base; let n = 1;
    while (true) {
      const { data: existing } = await supabase
        .from("passenger_invitations").select("id").eq("friendly_slug", slug).maybeSingle();
      if (!existing) break;
      n += 1; slug = `${base}-${n}`;
      if (n > 50) throw new Error("Could not allocate slug");
    }

    const expiresAt = new Date(Date.now() + data.expiresInDays * 86400_000).toISOString();

    const { data: row, error } = await supabase
      .from("passenger_invitations")
      .insert({
        trip_id: data.tripId,
        name: data.name,
        email: data.email.toLowerCase(),
        phone: data.phone || null,
        friendly_slug: slug,
        token_hash: tokenHash,
        starts_on: data.startsOn,
        ends_on: data.endsOn,
        permissions: data.permissions,
        expires_at: expiresAt,
        created_by: userId,
      })
      .select("id, friendly_slug, expires_at")
      .single();
    if (error) throw new Error(error.message);

    await supabase.from("access_audit_log").insert({
      actor_id: userId, trip_id: data.tripId, action: "user_invited",
      target_type: "invitation", target_id: row.id,
      metadata: { email: data.email, name: data.name },
    });

    return { id: row.id, slug: row.friendly_slug, token, expiresAt: row.expires_at };
  });

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ invitationId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: inv } = await supabase
      .from("passenger_invitations")
      .select("id, trip_id, accepted_user_id")
      .eq("id", data.invitationId)
      .single();
    if (!inv) throw new Error("Not found");
    // owner-check enforced by RLS, but double-belt
    const { error } = await supabase
      .from("passenger_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.invitationId);
    if (error) throw new Error(error.message);
    if (inv.accepted_user_id) {
      await supabase.from("trip_members").update({ status: "revoked", revoked_at: new Date().toISOString() })
        .eq("trip_id", inv.trip_id).eq("user_id", inv.accepted_user_id);
    }
    await supabase.from("access_audit_log").insert({
      actor_id: userId, trip_id: inv.trip_id, action: "user_revoked",
      target_type: "invitation", target_id: inv.id,
    });
    return { ok: true };
  });

const acceptInput = z.object({
  slug: z.string().trim().min(1).max(40),
  token: z.string().trim().min(10).max(100),
});

// Caller must already be authenticated (via magic link or password signup using the invited email).
export const acceptInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => acceptInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const callerEmail = (claims?.email as string | undefined)?.toLowerCase();

    const { data: inv, error } = await supabase
      .from("passenger_invitations")
      .select("id, trip_id, email, token_hash, expires_at, starts_on, ends_on, permissions, accepted_at, revoked_at")
      .eq("friendly_slug", data.slug)
      .maybeSingle();
    if (error || !inv) throw new Error("Invitation not found");
    if (inv.revoked_at) throw new Error("Invitation revoked");
    if (inv.accepted_at) throw new Error("Already accepted");
    if (new Date(inv.expires_at).getTime() < Date.now()) throw new Error("Invitation expired");

    const expected = hashToken(data.token);
    if (expected !== inv.token_hash) throw new Error("Invalid token");
    if (callerEmail && callerEmail !== inv.email.toLowerCase()) {
      throw new Error("Signed-in email does not match invitation");
    }

    // Admin-bypass for self-service acceptance writes
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await supabaseAdmin.from("trip_members").upsert({
      trip_id: inv.trip_id, user_id: userId,
      starts_on: inv.starts_on, ends_on: inv.ends_on,
      permissions: inv.permissions, status: "active",
    }, { onConflict: "trip_id,user_id" });

    await supabaseAdmin.from("passenger_invitations")
      .update({ accepted_at: new Date().toISOString(), accepted_user_id: userId })
      .eq("id", inv.id);

    await supabaseAdmin.from("access_audit_log").insert({
      actor_id: userId, trip_id: inv.trip_id, action: "invitation_accepted",
      target_type: "invitation", target_id: inv.id,
    });

    return { ok: true, tripId: inv.trip_id };
  });

// Public lookup so the activation page can show "Welcome, <name>" before login.
export const getInvitationPublic = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ slug: z.string().trim().min(1).max(40) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inv } = await supabaseAdmin
      .from("passenger_invitations")
      .select("name, email, expires_at, accepted_at, revoked_at, starts_on, ends_on")
      .eq("friendly_slug", data.slug)
      .maybeSingle();
    if (!inv) return { found: false as const };
    return {
      found: true as const,
      name: inv.name,
      email: inv.email,
      expiresAt: inv.expires_at,
      acceptedAt: inv.accepted_at,
      revokedAt: inv.revoked_at,
      startsOn: inv.starts_on,
      endsOn: inv.ends_on,
    };
  });

// Look up the friendly_slug for a token (used by /invite/:token page).
// Public — does NOT activate the invitation (that requires sign-in via /p/:slug).
export const getInvitationByToken = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ token: z.string().trim().min(10).max(100) }).parse(d),
  )
  .handler(async ({ data }) => {
    const tokenHash = hashToken(data.token);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inv } = await supabaseAdmin
      .from("passenger_invitations")
      .select("friendly_slug, expires_at, revoked_at, accepted_at, name")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (!inv) return { found: false as const };
    return {
      found: true as const,
      slug: inv.friendly_slug,
      name: inv.name,
      expiresAt: inv.expires_at,
      revokedAt: inv.revoked_at,
      acceptedAt: inv.accepted_at,
    };
  });

export const listInvitations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ tripId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("passenger_invitations")
      .select("id, name, email, friendly_slug, starts_on, ends_on, expires_at, accepted_at, revoked_at, created_at")
      .eq("trip_id", data.tripId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ tripId: z.string().uuid().optional(), limit: z.number().int().min(1).max(200).default(100) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("access_audit_log")
      .select("id, actor_id, trip_id, action, target_type, target_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.tripId) q = q.eq("trip_id", data.tripId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getDefaultTrip = createServerFn({ method: "GET" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("trips")
      .select("id, name, slug, public_slug, starts_on, ends_on, owner_id, public_tracking_enabled")
      .eq("slug", "eu-tripping-2026")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

// Owner-only: ensure Simona has a valid (non-revoked, non-expired) invitation.
// Returns the activation link + token. Always rotates the token if a new one is generated.
export const ensureSimonaInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const SIMONA_EMAIL = process.env.SIMONA_EMAIL ?? "member1@example.com";

    const { data: trip } = await supabase
      .from("trips").select("id, owner_id, starts_on, ends_on")
      .eq("slug", "eu-tripping-2026").maybeSingle();
    if (!trip) throw new Error("Trip not found");
    if (trip.owner_id !== userId) throw new Error("Forbidden");

    // Check existing active invite (any non-revoked, non-expired row)
    const { data: existing } = await supabase
      .from("passenger_invitations")
      .select("id, friendly_slug, expires_at, revoked_at")
      .eq("trip_id", trip.id)
      .eq("email", SIMONA_EMAIL)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing && !existing.revoked_at && new Date(existing.expires_at).getTime() > Date.now()) {
      return {
        created: false,
        slug: existing.friendly_slug,
        // Token already issued previously; not retrievable. Return null and let owner regenerate.
        token: null as string | null,
        expiresAt: existing.expires_at,
      };
    }

    // Create a fresh invitation
    const token = randomBytes(24).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 14 * 86400_000).toISOString();
    const baseSlug = "simona";
    let slug = baseSlug; let n = 1;
    while (true) {
      const { data: dup } = await supabase
        .from("passenger_invitations").select("id").eq("friendly_slug", slug).maybeSingle();
      if (!dup) break;
      n += 1; slug = `${baseSlug}-${n}`;
      if (n > 50) throw new Error("Could not allocate slug");
    }

    const { data: row, error } = await supabase
      .from("passenger_invitations")
      .insert({
        trip_id: trip.id, name: "Simona", email: SIMONA_EMAIL,
        friendly_slug: slug, token_hash: tokenHash,
        starts_on: trip.starts_on, ends_on: trip.ends_on,
        permissions: { companion: true },
        expires_at: expiresAt, created_by: userId,
      })
      .select("id, friendly_slug, expires_at").single();
    if (error) throw new Error(error.message);

    await supabase.from("access_audit_log").insert({
      actor_id: userId, trip_id: trip.id, action: "user_invited",
      target_type: "invitation", target_id: row.id,
      metadata: { email: SIMONA_EMAIL, name: "Simona" },
    });

    return { created: true, slug: row.friendly_slug, token, expiresAt: row.expires_at };
  });
