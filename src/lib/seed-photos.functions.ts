import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  MAX_SAMPLES,
  removeSamples,
  seedSamples,
  type SeedResult,
} from "@/lib/seed-samples";

/**
 * Owner-only buttons for the sample story photos.
 *
 * Uploading had never succeeded in this project — destination_photos had zero
 * rows and the bucket zero objects — which made "the feed is broken" and
 * "nobody has posted yet" look identical. These exercise the same path a real
 * post takes (bucket write, row insert, companion-post trigger, signed URL,
 * feed grouping, map pin) and are removable in one call.
 *
 * The work itself lives in seed-samples.ts, shared with the bootstrap hook.
 */

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function ownedTrip(userId: string, tripId?: string) {
  const db = await admin();
  const q = db.from("trips").select("id, owner_id, slug");
  const { data } = tripId
    ? await q.eq("id", tripId).maybeSingle()
    : await q.eq("slug", "eu-tripping-2026").maybeSingle();
  if (!data) throw new Error("No trip found");
  if ((data as any).owner_id !== userId) throw new Error("Only the trip owner can do this");
  return data as { id: string; owner_id: string; slug: string };
}

export type { SeedResult };

const seedInput = z.object({
  tripId: z.string().uuid().optional(),
  count: z.number().int().min(1).max(MAX_SAMPLES).optional(),
});

export const seedSamplePhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => seedInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<SeedResult> => {
    const trip = await ownedTrip(context.userId, data.tripId);
    return seedSamples(await admin(), trip.id, context.userId, data.count ?? MAX_SAMPLES);
  });

export const removeSamplePhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tripId: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<{ removed: number; message: string }> => {
    const trip = await ownedTrip(context.userId, data.tripId);
    return removeSamples(await admin(), trip.id);
  });
