import { useAuth } from "@/lib/auth";
import { useAdminAuth } from "@/lib/admin-auth";
import { can, type Capability, type Role } from "@/lib/permissions";

/**
 * The caller's role for UI purposes, from the same three-role model the server
 * enforces (`@/lib/permissions`).
 *
 * This is for *hiding* only. It is not a security boundary: the source of truth
 * is the Supabase JWT checked server-side by `requireCapability`. Anything this
 * hook conceals must also be refused by the server and by RLS.
 */
export function useRole(): { role: Role; loading: boolean } {
  const { user, loading: authLoading, roles } = useAuth();
  const { role: adminRole, loading: adminLoading } = useAdminAuth();

  const loading = authLoading || adminLoading;

  // The admin password path signs the user into Supabase too, so a session is
  // the common signal. `adminRole === "owner"` covers the brief window after
  // the password check but before the Supabase session settles.
  if (!user && adminRole === null) return { role: "public", loading };
  if (adminRole === "owner" || roles.includes("owner")) return { role: "owner", loading };
  return { role: "member", loading };
}

/** `can()` bound to the current user. */
export function useCan(capability: Capability): boolean {
  const { role } = useRole();
  return can(role, capability);
}
