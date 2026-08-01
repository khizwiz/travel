/**
 * One answer to "is this person the owner".
 *
 * The codebase had three, and they disagreed:
 *
 *  - `roleFromClaims` compares the JWT email against OWNER_EMAIL,
 *  - `ensureTripScaffold` looks for a `user_roles` row with role 'owner',
 *  - and a dozen server functions compare `trips.owner_id` with the caller.
 *
 * Signing in with the admin password satisfies the first two: it provisions
 * the OWNER_EMAIL account and upserts the owner role. It does nothing about
 * the third, because `trips.owner_id` was written once by whichever account
 * happened to create the trip. When those are not the same account — a trip
 * seeded before the owner ever signed in, or created from a different login —
 * the app owner is refused by everything that guards on the trip row: logging
 * fuel, seeding photos, re-pinning, clearing bad GPS. Which reads, correctly,
 * as "being admin doesn't give you rights to edit".
 *
 * Any of the three counts. There is exactly one owner in this deployment, so
 * this recognises them however they were recorded rather than insisting all
 * three agree.
 */

function ownerEmail(): string {
  return (process.env.OWNER_EMAIL ?? "owner@example.com").toLowerCase();
}

export interface OwnerCheck {
  isOwner: boolean;
  /** Which signal matched, for diagnosing a refusal. */
  via: "trip" | "role" | "email" | "none";
}

export async function checkTripOwner(
  db: any,
  userId: string,
  tripId?: string,
): Promise<OwnerCheck> {
  if (!userId) return { isOwner: false, via: "none" };

  if (tripId) {
    const { data: trip } = await db
      .from("trips").select("owner_id").eq("id", tripId).maybeSingle();
    if (trip?.owner_id && trip.owner_id === userId) return { isOwner: true, via: "trip" };
  }

  const { data: roleRow } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "owner")
    .maybeSingle();
  if (roleRow) return { isOwner: true, via: "role" };

  // Last resort: the account's own email. Uses the admin client because the
  // caller's row in `profiles` may not be readable under their own policies.
  const { data: profile } = await db
    .from("profiles").select("email").eq("id", userId).maybeSingle();
  const email = String((profile as any)?.email ?? "").toLowerCase();
  if (email && email === ownerEmail()) return { isOwner: true, via: "email" };

  return { isOwner: false, via: "none" };
}

/** Throws unless the caller is the owner. */
export async function assertTripOwner(db: any, userId: string, tripId?: string): Promise<void> {
  const { isOwner } = await checkTripOwner(db, userId, tripId);
  if (!isOwner) throw new Error("Only the trip owner can do this");
}
