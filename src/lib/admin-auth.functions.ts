import { createServerFn } from "@tanstack/react-start";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const OWNER_EMAIL_FALLBACK = "owner@example.com";
const CREW_EMAIL_FALLBACK = "miezko@tripping.local";
const CREW_END_DATE = "2026-07-21";

// Identity comes from env so each deployment (friend's prod, user's sandbox)
// can point at its own owner/crew accounts without code changes.
function ownerEmail(): string {
  return process.env.OWNER_EMAIL ?? OWNER_EMAIL_FALLBACK;
}

function crewEmail(): string {
  return process.env.CREW_EMAIL ?? CREW_EMAIL_FALLBACK;
}

export type AdminRole = "owner" | "crew";

function ownerSecret(): string {
  const s = process.env.ADMIN_PASSWORD;
  if (!s) throw new Error("Admin password is not configured.");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", ownerSecret()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function matches(input: string, expected: string | undefined): boolean {
  if (!expected) return false;
  return safeEqual(input, expected);
}

async function provisionUser(email: string, password: string, displayName: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let userId: string | null = null;
  const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
  if (existing) {
    userId = existing.id;
    await supabaseAdmin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
  } else {
    const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (cErr || !created.user) throw new Error(cErr?.message ?? "Could not create user");
    userId = created.user.id;
  }
  await supabaseAdmin
    .from("profiles")
    .upsert({ id: userId, email, display_name: displayName }, { onConflict: "id" });
  return { userId, supabaseAdmin };
}

export const verifyAdminPassword = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ password: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data }) => {
    const ownerExpected = process.env.ADMIN_PASSWORD ?? "";
    const crewExpected = process.env.MIEZKO_PASSWORD ?? "";

    let role: AdminRole | null = null;
    if (matches(data.password, ownerExpected)) role = "owner";
    else if (matches(data.password, crewExpected)) role = "crew";
    if (!role) throw new Error("Wrong password.");

    if (role === "owner") {
      const { userId, supabaseAdmin } = await provisionUser(ownerEmail(), data.password, "Khizar");
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: userId, role: "owner" }, { onConflict: "user_id,role" });

      const exp = Date.now() + TOKEN_TTL_MS;
      const payload = `owner.${exp}`;
      return {
        role: "owner" as const,
        token: `${payload}.${sign(payload)}`,
        expiresAt: exp,
        supabaseEmail: ownerEmail(),
      };
    }

    // Crew: Miezko — a member, not an admin. Under the three-role matrix
    // (@/lib/permissions) that is everything except travellers and settings.
    const { userId, supabaseAdmin } = await provisionUser(crewEmail(), data.password, "Miezko");
    // Deliberately 'companion', NOT 'owner'. Granting 'owner' here used to make
    // every is_owner()/has_role(...,'owner') RLS policy pass for crew, so the
    // hidden nav links were the only thing standing between crew and the
    // owner's documents, receipts and moderation tables — and typing the URL
    // walked straight past it.
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: "companion" }, { onConflict: "user_id,role" });
    // Clear any 'owner' row left over from before this was fixed.
    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", "owner");

    // Add as active trip member from trip start through Jul 21 night.
    const { data: trip } = await supabaseAdmin
      .from("trips")
      .select("id,starts_on")
      .eq("slug", "eu-tripping-2026")
      .maybeSingle();
    if (trip?.id) {
      await supabaseAdmin
        .from("trip_members")
        .upsert(
          {
            trip_id: trip.id,
            user_id: userId,
            status: "active",
            starts_on: trip.starts_on,
            ends_on: CREW_END_DATE,
          },
          { onConflict: "trip_id,user_id" },
        );
    }

    const exp = Date.now() + TOKEN_TTL_MS;
    const payload = `crew.${exp}`;
    return {
      role: "crew" as const,
      token: `${payload}.${sign(payload)}`,
      expiresAt: exp,
      supabaseEmail: crewEmail(),
    };
  });

export const verifyAdminToken = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(1).max(500) }).parse(input))
  .handler(async ({ data }) => {
    const parts = data.token.split(".");
    if (parts.length !== 3) return { valid: false as const };
    const role = parts[0];
    if (role !== "owner" && role !== "crew" && role !== "admin") return { valid: false as const };
    const exp = Number(parts[1]);
    if (!Number.isFinite(exp) || exp < Date.now()) return { valid: false as const };
    const expectedSig = sign(`${parts[0]}.${parts[1]}`);
    if (!safeEqual(parts[2], expectedSig)) return { valid: false as const };
    // Legacy "admin" tokens map to owner.
    const normalized: AdminRole = role === "crew" ? "crew" : "owner";
    return { valid: true as const, expiresAt: exp, role: normalized };
  });
