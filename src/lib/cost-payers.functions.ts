import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function ensureOwner(supabase: any, userId: string, tripId: string) {
  const { data: trip } = await supabase
    .from("trips").select("owner_id").eq("id", tripId).single();
  if (!trip || trip.owner_id !== userId) throw new Error("Forbidden");
}

export const listCostPayers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tripId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("cost_payers")
      .select("id, name, created_at")
      .eq("trip_id", data.tripId)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const addCostPayer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ tripId: z.string().uuid(), name: z.string().trim().min(1).max(80) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // Any trip member may add a payer; RLS ("members add cost_payers") enforces membership.
    const { data: row, error } = await context.supabase
      .from("cost_payers")
      .insert({ trip_id: data.tripId, name: data.name })
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const removeCostPayer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("cost_payers").select("trip_id").eq("id", data.id).single();
    if (!row) throw new Error("Not found");
    await ensureOwner(context.supabase, context.userId, row.trip_id);
    const { error } = await context.supabase.from("cost_payers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
