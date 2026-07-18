import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeEqualShares } from "./split-math";
import { z } from "zod";

export const COST_CATEGORIES = [
  "fuel", "accommodation", "ferry", "food", "activities", "tolls", "misc",
] as const;

// ---------- FX ----------
const fxCache = new Map<string, { rate: number; at: number }>();
const FX_TTL_MS = 6 * 60 * 60 * 1000;

// Balkan currencies the ECB feed doesn't carry — approximate but stable
// (RSD/BAM are managed/pegged): used only when the live lookup can't help.
const FX_FALLBACK_TO_EUR: Record<string, number> = {
  RSD: 1 / 117.2, // Serbian dinar
  BAM: 1 / 1.95583, // Bosnian mark (fixed peg)
  MKD: 1 / 61.6, // Macedonian denar
  ALL: 1 / 99, // Albanian lek
};

async function fetchFxToEur(from: string): Promise<number> {
  const key = from.toUpperCase();
  if (key === "EUR") return 1;
  const cached = fxCache.get(key);
  if (cached && Date.now() - cached.at < FX_TTL_MS) return cached.rate;
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${key}&to=EUR`);
    if (!res.ok) throw new Error(`FX lookup failed (${res.status})`);
    const json = await res.json() as { rates?: { EUR?: number } };
    const rate = json.rates?.EUR;
    if (!rate || !isFinite(rate)) throw new Error("FX response invalid");
    fxCache.set(key, { rate, at: Date.now() });
    return rate;
  } catch (e) {
    const fallback = FX_FALLBACK_TO_EUR[key];
    if (fallback) return fallback;
    throw e;
  }
}

export const COST_CURRENCIES = [
  "EUR", "USD", "TRY", "BGN", "RON", "HUF", "CZK", "PLN", "CHF", "RSD", "BAM", "MKD", "ALL",
] as const;

export const getFxRate = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ from: z.enum(COST_CURRENCIES) }).parse(d))
  .handler(async ({ data }) => ({ from: data.from, toEur: await fetchFxToEur(data.from) }));

// ---------- Helpers ----------
async function ensureOwner(supabase: any, userId: string, tripId: string) {
  const { data: trip } = await supabase
    .from("trips").select("owner_id").eq("id", tripId).single();
  if (!trip || trip.owner_id !== userId) throw new Error("Forbidden");
}

async function dayTravellers(supabase: any, tripId: string, day: string): Promise<
  { user_id: string | null; child_key: string | null }[]
> {
  const { data } = await supabase
    .from("itinerary_days")
    .select("id, day_travellers(user_id, child_key)")
    .eq("trip_id", tripId)
    .eq("day_date", day)
    .maybeSingle();
  return (data?.day_travellers ?? []) as any;
}

// ---------- Create (owner or companion submission) ----------
// splitAmong: unified participant identifiers.
//   "u:<uuid>"  → a real app user (owner or other trip_member)
//   "p:<uuid>"  → a named cost_payer (no account needed)
//   "k:<slug>"  → a legacy child key like "fez" (kept for compatibility)
const createInput = z.object({
  tripId: z.string().uuid(),
  dayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive().max(1_000_000),
  currency: z.enum(COST_CURRENCIES).default("EUR"),
  paidByUserId: z.string().uuid().nullable().optional(),
  paidByLabel: z.string().trim().max(60).optional(),
  payerId: z.string().uuid().nullable().optional(),
  category: z.enum(COST_CATEGORIES),
  description: z.string().trim().max(500).optional(),
  receiptPath: z.string().trim().max(400).optional().nullable(),
  splitAmong: z.array(z.string().min(3).max(60)).optional(),
});


export const createCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: trip } = await supabase
      .from("trips").select("owner_id").eq("id", data.tripId).single();
    if (!trip) throw new Error("Trip not found");
    const isOwner = trip.owner_id === userId;

    const fx = await fetchFxToEur(data.currency);
    const amountEur = Math.round(data.amount * fx * 100) / 100;
    const originalAmount = data.currency === "EUR" ? null : data.amount;
    const originalCurrency = data.currency === "EUR" ? null : data.currency;

    // Splitwise model: any member's cost is live immediately; anyone can record who paid.
    const paidBy = data.paidByUserId ?? (data.payerId ? null : userId);
    const status = "approved";

    const { data: row, error } = await supabase
      .from("trip_costs")
      .insert({
        trip_id: data.tripId,
        day_date: data.dayDate,
        amount_eur: amountEur,
        original_amount: originalAmount,
        original_currency: originalCurrency,
        paid_by: paidBy,
        paid_by_label: data.paidByLabel ?? null,
        payer_id: data.payerId ?? null,
        category: data.category,
        description: data.description ?? null,
        receipt_path: data.receiptPath ?? null,
        status,
        created_by: userId,
        approved_by: userId,
        approved_at: new Date().toISOString(),
      })
      .select("id").single();

    if (error) throw new Error(error.message);

    await materialiseSplitsUnified(supabase, row.id, data.tripId, data.dayDate, amountEur, data.splitAmong);

    return { id: row.id, status, amountEur };
  });

// Unified split materialiser. `splitAmong` items are "u:<uid>", "p:<payerId>", or "k:<slug>".
async function materialiseSplitsUnified(
  supabase: any,
  costId: string,
  tripId: string,
  day: string,
  amountEur: number,
  splitAmong?: string[],
) {
  let entries: { userId: string | null; key: string | null }[] = [];
  if (splitAmong && splitAmong.length > 0) {
    for (const raw of splitAmong) {
      if (raw.startsWith("u:")) entries.push({ userId: raw.slice(2), key: null });
      else if (raw.startsWith("p:")) entries.push({ userId: null, key: `p:${raw.slice(2)}` });
      else if (raw.startsWith("k:")) entries.push({ userId: null, key: raw.slice(2) });
    }
  } else {
    // Default: split equally between everyone PRESENT on that day.
    // A member who joined for one week of a two-week trip only shares costs
    // from days inside their starts_on..ends_on window; the owner is always on.
    // Roster is read via the service role so member-created costs split
    // correctly too (RLS hides co-members from non-owners).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: t } = await supabaseAdmin
      .from("trips").select("owner_id").eq("id", tripId).maybeSingle();
    const { data: roster } = await supabaseAdmin
      .from("trip_members")
      .select("user_id, status, starts_on, ends_on")
      .eq("trip_id", tripId);
    const presentIds = new Set<string>();
    if (t?.owner_id) presentIds.add(t.owner_id);
    for (const r of (roster ?? []) as any[]) {
      if (!r.user_id || r.status !== "active") continue;
      if (r.starts_on && r.starts_on > day) continue;
      if (r.ends_on && r.ends_on < day) continue;
      presentIds.add(r.user_id);
    }
    entries = Array.from(presentIds).map((id) => ({ userId: id, key: null }));
    // Named payers (no accounts) always share — they have no date window.
    const { data: extraPayers } = await supabaseAdmin
      .from("cost_payers").select("id").eq("trip_id", tripId);
    for (const p of (extraPayers ?? []) as any[]) {
      entries.push({ userId: null, key: `p:${p.id}` });
    }
    if (entries.length === 0) {
      const { data: c } = await supabase.from("trip_costs").select("paid_by, payer_id").eq("id", costId).single();
      if (c?.paid_by) entries = [{ userId: c.paid_by, key: null }];
      else if (c?.payer_id) entries = [{ userId: null, key: `p:${c.payer_id}` }];
    }
  }
  const seen = new Set<string>();
  const unique = entries.filter((p) => {
    const k = p.userId ? `u:${p.userId}` : `k:${p.key}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  if (unique.length === 0) return;
  const shares = computeEqualShares(amountEur, unique.length);
  await supabase.from("trip_cost_splits").delete().eq("cost_id", costId);
  await supabase.from("trip_cost_splits").insert(
    unique.map((p, i) => ({
      cost_id: costId,
      participant_user_id: p.userId,
      participant_key: p.key,
      share_eur: shares[i],
    })),
  );
}

// Back-compat wrapper for callers still using the old {userId, participantKey} shape.
async function materialiseSplits(
  supabase: any,
  costId: string,
  tripId: string,
  day: string,
  amountEur: number,
  explicit?: { userId?: string | null; participantKey?: string | null }[],
) {
  const splitAmong = explicit
    ?.map((e) => (e.userId ? `u:${e.userId}` : e.participantKey ? `k:${e.participantKey}` : ""))
    .filter(Boolean);
  await materialiseSplitsUnified(supabase, costId, tripId, day, amountEur, splitAmong);
}

// ---------- Approve / Reject ----------
export const approveCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    costId: z.string().uuid(),
    splitParticipants: z.array(z.object({
      userId: z.string().uuid().nullable().optional(),
      participantKey: z.string().max(40).nullable().optional(),
    })).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: c } = await supabase
      .from("trip_costs")
      .select("id, trip_id, day_date, amount_eur, status")
      .eq("id", data.costId).single();
    if (!c) throw new Error("Not found");
    await ensureOwner(supabase, userId, c.trip_id);
    if (c.status === "approved") return { ok: true };
    await supabase.from("trip_costs").update({
      status: "approved", approved_by: userId, approved_at: new Date().toISOString(),
    }).eq("id", c.id);
    await materialiseSplits(supabase, c.id, c.trip_id, c.day_date, Number(c.amount_eur), data.splitParticipants);
    await supabase.from("access_audit_log").insert({
      actor_id: userId, trip_id: c.trip_id, action: "cost_approved",
      target_type: "trip_cost", target_id: c.id,
    });
    return { ok: true };
  });

export const rejectCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ costId: z.string().uuid(), reason: z.string().max(300).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: c } = await supabase
      .from("trip_costs").select("id, trip_id").eq("id", data.costId).single();
    if (!c) throw new Error("Not found");
    await ensureOwner(supabase, userId, c.trip_id);
    await supabase.from("trip_costs").update({
      status: "rejected", approved_by: userId, approved_at: new Date().toISOString(),
    }).eq("id", c.id);
    await supabase.from("trip_cost_splits").delete().eq("cost_id", c.id);
    await supabase.from("access_audit_log").insert({
      actor_id: userId, trip_id: c.trip_id, action: "cost_rejected",
      target_type: "trip_cost", target_id: c.id,
      metadata: { reason: data.reason ?? null },
    });
    return { ok: true };
  });

// ---------- Edit split (owner only) ----------
export const updateCostSplit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    costId: z.string().uuid(),
    participants: z.array(z.object({
      userId: z.string().uuid().nullable().optional(),
      participantKey: z.string().max(40).nullable().optional(),
    })).min(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: c } = await supabase
      .from("trip_costs").select("id, trip_id, day_date, amount_eur").eq("id", data.costId).single();
    if (!c) throw new Error("Not found");
    await ensureOwner(supabase, userId, c.trip_id);
    await materialiseSplits(supabase, c.id, c.trip_id, c.day_date, Number(c.amount_eur), data.participants);
    return { ok: true };
  });

// ---------- List + summary ----------
export const listCosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tripId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Service-role for the people list: RLS hides co-members' profile rows
    // from non-owners, which made every other traveller render as "Member".
    // Access is still verified — the caller must be the owner or a member.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: t } = await supabaseAdmin
      .from("trips").select("owner_id").eq("id", data.tripId).maybeSingle();
    if (!t) throw new Error("Trip not found");
    const isOwner = t.owner_id === userId;
    if (!isOwner) {
      const { data: mem } = await supabaseAdmin
        .from("trip_members").select("id")
        .eq("trip_id", data.tripId).eq("user_id", userId).eq("status", "active")
        .maybeSingle();
      if (!mem) throw new Error("Not a member of this trip");
    }

    // Costs & splits stay under the caller's own RLS.
    const { data: costs, error } = await supabase
      .from("trip_costs")
      .select("id, day_date, amount_eur, original_amount, original_currency, paid_by, paid_by_label, payer_id, category, description, receipt_path, status, created_by, created_at")
      .eq("trip_id", data.tripId)
      .order("day_date", { ascending: false });
    if (error) throw new Error(error.message);

    let splits: any[] = [];
    if (costs && costs.length > 0) {
      const ids = costs.map((c: any) => c.id);
      const { data: s } = await supabase
        .from("trip_cost_splits")
        .select("id, cost_id, participant_user_id, participant_key, share_eur")
        .in("cost_id", ids);
      splits = s ?? [];
    }

    // People list is fetched UNCONDITIONALLY (was gated on costs.length > 0,
    // which made the very first payment impossible on a fresh database).
    // Two plain queries instead of a PostgREST relation join — the join
    // failed silently on some schemas and left everyone unnamed.
    const { data: m, error: mErr } = await supabaseAdmin
      .from("trip_members")
      .select("user_id, status, starts_on, ends_on")
      .eq("trip_id", data.tripId);
    if (mErr) console.error("[listCosts] trip_members:", mErr.message);
    const rowsByUser = new Map(((m ?? []) as any[]).filter((r) => r.user_id).map((r) => [r.user_id, r]));
    const memberIds = Array.from(new Set(
      [t.owner_id, ...((m ?? []) as any[])
        .filter((r) => r.user_id && r.status !== "revoked")
        .map((r) => r.user_id)].filter(Boolean),
    ));
    const { data: profs, error: pErr } = await supabaseAdmin
      .from("profiles").select("id, display_name, email").in("id", memberIds);
    if (pErr) console.error("[listCosts] profiles:", pErr.message);
    const profMap = new Map(((profs ?? []) as any[]).map((p) => [p.id, p]));
    const members = memberIds.map((id) => {
      const p = profMap.get(id);
      const row = id === t.owner_id ? null : rowsByUser.get(id);
      return {
        user_id: id,
        display_name: p?.display_name ?? p?.email ?? (id === t.owner_id ? "Owner" : "Member"),
        email: p?.email ?? null,
        // Presence window: the owner is on the whole trip; members follow
        // their invite dates. Splits only include people present that day.
        starts_on: row?.starts_on ?? null,
        ends_on: row?.ends_on ?? null,
      };
    });
    return { isOwner, costs: costs ?? [], splits, members };
  });

// ---------- Settlement (owner) ----------
// Unified over app users (paid_by uuid) and named payers (payer_id via cost_payers).
// Person key: `u:<uid>` or `p:<payerId>`.
export const computeSettlement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tripId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Any trip member may view the settlement; RLS scopes rows to their trips.
    const { data: costs } = await supabase
      .from("trip_costs").select("id, amount_eur, paid_by, payer_id")
      .eq("trip_id", data.tripId).eq("status", "approved");
    const { data: splits } = await supabase
      .from("trip_cost_splits")
      .select("cost_id, participant_user_id, participant_key, share_eur")
      .in("cost_id", (costs ?? []).map((c: any) => c.id));

    const paid = new Map<string, number>();
    const owes = new Map<string, number>();
    const keyForCost = (c: any) => c.paid_by ? `u:${c.paid_by}` : c.payer_id ? `p:${c.payer_id}` : null;
    const keyForSplit = (s: any) => {
      if (s.participant_user_id) return `u:${s.participant_user_id}`;
      if (s.participant_key?.startsWith("p:")) return s.participant_key; // already "p:<id>"
      if (s.participant_key) return `k:${s.participant_key}`;
      return null;
    };
    for (const c of costs ?? []) {
      const k = keyForCost(c);
      if (!k) continue;
      paid.set(k, (paid.get(k) ?? 0) + Number(c.amount_eur));
    }
    for (const s of splits ?? []) {
      const k = keyForSplit(s);
      if (!k) continue;
      owes.set(k, (owes.get(k) ?? 0) + Number(s.share_eur));
    }
    const keys = Array.from(new Set([...paid.keys(), ...owes.keys()]));
    const net = keys.map((k) => ({
      userId: k, // legacy field name; now a compound person key
      net: Math.round(((paid.get(k) ?? 0) - (owes.get(k) ?? 0)) * 100) / 100,
      paid: Math.round((paid.get(k) ?? 0) * 100) / 100,
      share: Math.round((owes.get(k) ?? 0) * 100) / 100,
    }));

    const creditors = net.filter((n) => n.net > 0.01).map((n) => ({ ...n }));
    const debtors = net.filter((n) => n.net < -0.01).map((n) => ({ ...n, net: -n.net }));
    creditors.sort((a, b) => b.net - a.net);
    debtors.sort((a, b) => b.net - a.net);
    const transfers: { from: string; to: string; amount: number }[] = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amt = Math.min(debtors[i].net, creditors[j].net);
      if (amt > 0.01) {
        transfers.push({ from: debtors[i].userId, to: creditors[j].userId, amount: Math.round(amt * 100) / 100 });
      }
      debtors[i].net -= amt; creditors[j].net -= amt;
      if (debtors[i].net < 0.01) i++;
      if (creditors[j].net < 0.01) j++;
    }
    return { net, transfers };
  });

// ---------- Delete (owner) ----------
export const deleteCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ costId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: c } = await supabase
      .from("trip_costs").select("id, trip_id, created_by").eq("id", data.costId).single();
    if (!c) throw new Error("Not found");
    // Creators may delete their own costs; the owner may delete any.
    if (c.created_by !== userId) await ensureOwner(supabase, userId, c.trip_id);
    await supabase.from("trip_cost_splits").delete().eq("cost_id", c.id);
    const { error } = await supabase.from("trip_costs").delete().eq("id", c.id);
    if (error) throw new Error(error.message);
    await supabase.from("access_audit_log").insert({
      actor_id: userId, trip_id: c.trip_id, action: "cost_deleted",
      target_type: "trip_cost", target_id: c.id,
    });
    return { ok: true };
  });

// ---------- Manual split override (owner) ----------
// Each participant carries an explicit EUR share; sum must equal cost amount (±0.02).
export const updateCostAmounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    costId: z.string().uuid(),
    perPerson: z.array(z.object({
      userId: z.string().uuid().nullable().optional(),
      participantKey: z.string().max(40).nullable().optional(),
      shareEur: z.number().nonnegative().max(1_000_000),
    })).min(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: c } = await supabase
      .from("trip_costs").select("id, trip_id, amount_eur").eq("id", data.costId).single();
    if (!c) throw new Error("Not found");
    await ensureOwner(supabase, userId, c.trip_id);
    const total = data.perPerson.reduce((s, p) => s + p.shareEur, 0);
    if (Math.abs(total - Number(c.amount_eur)) > 0.02) {
      throw new Error(
        `Split total €${total.toFixed(2)} must equal cost €${Number(c.amount_eur).toFixed(2)}.`,
      );
    }
    await supabase.from("trip_cost_splits").delete().eq("cost_id", c.id);
    const rows = data.perPerson
      .filter((p) => p.shareEur > 0 && (p.userId || p.participantKey))
      .map((p) => ({
        cost_id: c.id,
        participant_user_id: p.userId ?? null,
        participant_key: p.participantKey ?? null,
        share_eur: Math.round(p.shareEur * 100) / 100,
      }));
    if (rows.length === 0) return { ok: true };
    const { error } = await supabase.from("trip_cost_splits").insert(rows);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Travellers (owner) ----------
export const listTravellers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tripId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureOwner(supabase, userId, data.tripId);
    const { data: members } = await supabase
      .from("trip_members")
      .select("id, user_id, status, starts_on, ends_on, role_in_trip, profiles:user_id(display_name, email)")
      .eq("trip_id", data.tripId)
      .order("created_at", { ascending: true });
    return (members ?? []).map((m: any) => ({
      id: m.id,
      user_id: m.user_id,
      status: m.status,
      starts_on: m.starts_on,
      ends_on: m.ends_on,
      role_in_trip: m.role_in_trip,
      display_name: m.profiles?.display_name ?? m.profiles?.email ?? "Member",
      email: m.profiles?.email ?? null,
    }));
  });

export const addTraveller = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    tripId: z.string().uuid(),
    email: z.string().email().max(200),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureOwner(supabase, userId, data.tripId);
    const email = data.email.trim().toLowerCase();
    let starterPassword: string | null = null;
    let { data: prof } = await supabase
      .from("profiles").select("id").eq("email", email).maybeSingle();
    if (!prof?.id) {
      // Auto-provision an account so they can be added as a co-payer immediately.
      // A starter password is generated and returned ONCE so the owner can pass
      // it to the person; they log in via the Member tab of the login modal.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      starterPassword = generatePassword();
      const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: starterPassword,
        email_confirm: true,
        user_metadata: { display_name: email.split("@")[0] },
      });
      if (cErr || !created?.user?.id) {
        // If user already exists in auth but no profile row, look them up.
        starterPassword = null; // no new password was set for a pre-existing account
        const { data: list } = await supabaseAdmin.auth.admin.listUsers();
        const existing = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
        if (!existing?.id) throw new Error(cErr?.message ?? "Could not create account for that email.");
        prof = { id: existing.id };
        await supabaseAdmin.from("profiles").upsert({ id: existing.id, email, display_name: email.split("@")[0] }, { onConflict: "id" });
      } else {
        prof = { id: created.user.id };
      }
    }
    const { error } = await supabase.from("trip_members").insert({
      trip_id: data.tripId,
      user_id: prof.id,
      status: "active",
      starts_on: data.startsOn ?? null,
      ends_on: data.endsOn ?? null,
      role_in_trip: "passenger",
    });
    if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
    return { ok: true, starterPassword };
  });

// Owner-only: set a fresh password on a member's account and return it ONCE.
// Target is addressed by trip_members.id so it can never reach users outside
// a trip the caller owns.
export const resetMemberPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ memberId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: m } = await supabase
      .from("trip_members").select("trip_id, user_id").eq("id", data.memberId).single();
    if (!m?.user_id) throw new Error("Not found");
    await ensureOwner(supabase, userId, m.trip_id);
    const password = generatePassword();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(m.user_id, { password });
    if (error) throw new Error(error.message);
    return { password };
  });

// Readable starter password: 3 groups of 4 lowercase/digit chars, e.g. "k3vt-9pma-x2dh".
function generatePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/O/1/l/i lookalikes
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const s = Array.from(bytes, (b) => chars[b % chars.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export const removeTraveller = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ memberId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: m } = await supabase
      .from("trip_members").select("trip_id").eq("id", data.memberId).single();
    if (!m) throw new Error("Not found");
    await ensureOwner(supabase, userId, m.trip_id);
    const { error } = await supabase
      .from("trip_members").update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", data.memberId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Share sheet (owner creates, public reads) ----------
function randToken(len = 24): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export const createCostShareSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tripId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureOwner(supabase, userId, data.tripId);

    // Rebuild the settlement inline (mirrors computeSettlement).
    const { data: costs } = await supabase
      .from("trip_costs")
      .select("id, day_date, amount_eur, paid_by, category, description")
      .eq("trip_id", data.tripId).eq("status", "approved");
    const { data: splits } = await supabase
      .from("trip_cost_splits")
      .select("cost_id, participant_user_id, participant_key, share_eur")
      .in("cost_id", (costs ?? []).map((c: any) => c.id));
    const { data: members } = await supabase
      .from("trip_members")
      .select("user_id, profiles:user_id(display_name, email)")
      .eq("trip_id", data.tripId);
    const { data: trip } = await supabase
      .from("trips").select("owner_id, name").eq("id", data.tripId).single();
    const { data: ownerProf } = await supabase
      .from("profiles").select("id, display_name, email").eq("id", trip!.owner_id).single();

    const nameFor: Record<string, string> = {};
    if (ownerProf) nameFor[ownerProf.id] = ownerProf.display_name ?? ownerProf.email ?? "Owner";
    for (const m of members ?? []) {
      nameFor[m.user_id] = (m as any).profiles?.display_name ?? (m as any).profiles?.email ?? "Traveller";
    }

    const paid = new Map<string, number>();
    const owes = new Map<string, number>();
    for (const c of costs ?? []) {
      if (!c.paid_by) continue;
      paid.set(c.paid_by, (paid.get(c.paid_by) ?? 0) + Number(c.amount_eur));
    }
    for (const s of splits ?? []) {
      if (!s.participant_user_id) continue;
      owes.set(s.participant_user_id, (owes.get(s.participant_user_id) ?? 0) + Number(s.share_eur));
    }
    const uids = Array.from(new Set([...paid.keys(), ...owes.keys()]));
    const net = uids.map((uid) => ({
      userId: uid,
      name: nameFor[uid] ?? "Traveller",
      paid: Math.round((paid.get(uid) ?? 0) * 100) / 100,
      share: Math.round((owes.get(uid) ?? 0) * 100) / 100,
      net: Math.round(((paid.get(uid) ?? 0) - (owes.get(uid) ?? 0)) * 100) / 100,
    }));
    const creditors = net.filter((n) => n.net > 0.01).map((n) => ({ ...n }));
    const debtors = net.filter((n) => n.net < -0.01).map((n) => ({ ...n, net: -n.net }));
    creditors.sort((a, b) => b.net - a.net);
    debtors.sort((a, b) => b.net - a.net);
    const transfers: { from: string; fromName: string; to: string; toName: string; amount: number }[] = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amt = Math.min(debtors[i].net, creditors[j].net);
      if (amt > 0.01) {
        transfers.push({
          from: debtors[i].userId, fromName: debtors[i].name,
          to: creditors[j].userId, toName: creditors[j].name,
          amount: Math.round(amt * 100) / 100,
        });
      }
      debtors[i].net -= amt; creditors[j].net -= amt;
      if (debtors[i].net < 0.01) i++;
      if (creditors[j].net < 0.01) j++;
    }

    const payload = {
      tripName: trip?.name ?? "Trip",
      generatedAt: new Date().toISOString(),
      approvedTotal: Math.round((costs ?? []).reduce((s: number, c: any) => s + Number(c.amount_eur), 0) * 100) / 100,
      net,
      transfers,
      costs: (costs ?? []).map((c: any) => ({
        id: c.id, day: c.day_date, amount: Number(c.amount_eur),
        category: c.category, description: c.description,
        paidByName: nameFor[c.paid_by] ?? "—",
        splits: (splits ?? [])
          .filter((s: any) => s.cost_id === c.id)
          .map((s: any) => ({
            name: s.participant_user_id ? (nameFor[s.participant_user_id] ?? "Traveller") : (s.participant_key ?? "—"),
            share: Number(s.share_eur),
          })),
      })),
    };

    const token = randToken(24);
    const { error } = await supabase.from("cost_share_snapshots").insert({
      token, trip_id: data.tripId, payload, created_by: userId,
    });
    if (error) throw new Error(error.message);
    return { token };
  });

// Public read (no auth). Uses service-role client so the RLS anon SELECT
// policy can be removed — the unguessable token is the sole capability.
export const getCostShareSnapshot = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(8).max(64) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("cost_share_snapshots")
      .select("token, payload, created_at, expires_at")
      .eq("token", data.token)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    return row;
  });


