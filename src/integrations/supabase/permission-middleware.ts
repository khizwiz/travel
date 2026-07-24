import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "./auth-middleware";
import { can, type Capability, type Role } from "@/lib/permissions";

/**
 * Server-side half of the permission matrix in `@/lib/permissions`.
 *
 * The client can only hide things. This is the layer that refuses, so every
 * server function that is not deliberately public composes one of these.
 *
 * Role comes from the verified Supabase JWT — never from the admin token in
 * localStorage, which the user can edit freely.
 */

function ownerEmail(): string {
  return (process.env.OWNER_EMAIL ?? "owner@example.com").toLowerCase();
}

/**
 * Resolve a signed-in user's role from their JWT claims.
 *
 * Deliberately does NOT read `user_roles`: that table currently hands the crew
 * account an `owner` row so legacy `has_role()`/`is_owner()` RLS would pass,
 * which made crew indistinguishable from the owner. Identity is the email on
 * the token, which crew cannot change.
 */
export function roleFromClaims(claims: Record<string, unknown> | null | undefined): Role {
  if (!claims) return "public";
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
  if (email && email === ownerEmail()) return "owner";
  return "member";
}

/**
 * Require a capability. Throws before the handler runs if the caller lacks it.
 *
 * Adds `role` to the handler context so a function can vary its *response*
 * (e.g. precise vs blurred coordinates) without repeating the role lookup.
 */
export function requireCapability(capability: Capability) {
  return createMiddleware({ type: "function" })
    .middleware([requireSupabaseAuth])
    .server(async ({ next, context }) => {
      const role = roleFromClaims((context as { claims?: Record<string, unknown> }).claims);
      if (!can(role, capability)) {
        // Same message regardless of reason — don't tell a prober which
        // capability exists or what role they'd need.
        throw new Error("Forbidden");
      }
      return next({ context: { role } });
    });
}

/**
 * For endpoints that serve both visitors and members, where the *response*
 * differs by role rather than being allowed or denied outright (the public map
 * trail, for instance). Never throws on a missing session.
 */
export const withOptionalRole = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const anon: { role: Role; userId: string | null } = { role: "public", userId: null };
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const authHeader = request?.headers?.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return next({ context: anon });
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return next({ context: anon });
    const token = authHeader.slice("Bearer ".length);
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims) return next({ context: anon });
    const resolved: { role: Role; userId: string | null } = {
      role: roleFromClaims(data.claims as Record<string, unknown>),
      userId: (data.claims.sub as string) ?? null,
    };
    return next({ context: resolved });
  } catch {
    return next({ context: anon });
  }
});
