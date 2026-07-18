import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Edit3, Link2, Loader2, Lock, Plus, Receipt, Share2, Trash2, UserMinus, UserPlus, Users, Wallet, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getDefaultTrip } from "@/lib/access.functions";
import {
  COST_CATEGORIES, COST_CURRENCIES, addTraveller, approveCost, computeSettlement, createCost, createCostShareSnapshot,
  deleteCost, listCosts, listTravellers, rejectCost, removeTraveller, resetMemberPassword, updateCostAmounts,
} from "@/lib/cost.functions";
import { extractReceipt } from "@/lib/receipt.functions";
import { addCostPayer, listCostPayers, removeCostPayer } from "@/lib/cost-payers.functions";
import { ensureTripScaffold } from "@/lib/scaffold.functions";
import { TravellersManager } from "@/components/TravellersManager";


export const Route = createFileRoute("/cost")({
  head: () => ({ meta: [{ title: "Private Trip Cost — Tripping" }] }),
  component: CostPage,
});

const CAT_LABEL: Record<string, string> = {
  fuel: "Fuel", accommodation: "Accommodation", ferry: "Ferry",
  food: "Food", activities: "Activities", tolls: "Tolls", misc: "Misc",
};

function fmtEUR(n: number) {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(n);
}

// Downscale a photo client-side so the AI receipt scan stays small and fast.
async function downscaleToDataUrl(file: File, maxDim = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.8);
}

function CostPage() {
  const { user, isOwner, loading } = useAuth();
  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!user) {
    return (
      <div className="card-elev p-6 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
        <div className="mt-2 font-medium">Sign in required</div>
      </div>
    );
  }
  // Splitwise model: every member gets the full view (list, splits, balances).
  // Owner-only moderation actions are enforced server-side.
  return <OwnerView />;
}

// ============ OWNER ============
function OwnerView() {
  const { user: authUser } = useAuth();
  const fetchTrip = useServerFn(getDefaultTrip);
  const fetchList = useServerFn(listCosts);
  const fetchSettle = useServerFn(computeSettlement);
  const doApprove = useServerFn(approveCost);
  const doReject = useServerFn(rejectCost);
  const doCreate = useServerFn(createCost);
  const doDelete = useServerFn(deleteCost);
  const doUpdateSplits = useServerFn(updateCostAmounts);
  const doCreateShare = useServerFn(createCostShareSnapshot);
  const [editSplits, setEditSplits] = useState<any | null>(null);
  const [showTravellers, setShowTravellers] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [busyShare, setBusyShare] = useState(false);

  const [tripId, setTripId] = useState<string | null>(null);
  const [data, setData] = useState<any>({ costs: [], splits: [], members: [] });
  const [settle, setSettle] = useState<any>({ net: [], transfers: [] });
  const [payers, setPayers] = useState<{ id: string; name: string }[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const fetchPayers = useServerFn(listCostPayers);

  const ensureScaffold = useServerFn(ensureTripScaffold);
  useEffect(() => {
    fetchTrip().then(async (t) => {
      if (t?.id) { setTripId(t.id); return; }
      // Fresh database: initialise trip + days + photo bucket, then retry.
      // (No-op for non-owners: the server rejects and we swallow the error.)
      try {
        await ensureScaffold();
        const t2 = await fetchTrip();
        if (t2?.id) setTripId(t2.id);
      } catch { /* non-owner or scaffold failed */ }
    });
  }, [fetchTrip, ensureScaffold]);
  useEffect(() => {
    if (!tripId) return;
    refresh();
  }, [tripId]);

  async function refresh() {
    if (!tripId) return;
    const d = await fetchList({ data: { tripId } });
    setData(d);
    const s = await fetchSettle({ data: { tripId } });
    setSettle(s);
    try { setPayers(await fetchPayers({ data: { tripId } })); } catch {}
  }


  // Compound person keys: "u:<uid>" (app users) or "p:<payerId>" (named payers).
  // Legacy bare uuids/keys are still accepted for older data.
  const personLabel = (key: string | null) => {
    if (!key) return "—";
    if (key.startsWith("u:")) {
      const uid = key.slice(2);
      const m = data.members.find((x: any) => x.user_id === uid);
      return m?.display_name ?? m?.email ?? "User";
    }
    if (key.startsWith("p:")) {
      const pid = key.slice(2);
      return payers.find((p) => p.id === pid)?.name ?? "Extra payer";
    }
    // legacy: bare uid
    const m = data.members.find((x: any) => x.user_id === key);
    if (m) return m.display_name ?? m.email ?? "User";
    return payers.find((p) => p.id === key)?.name ?? key;
  };
  const memberLabel = (uid: string | null) => personLabel(uid ? `u:${uid}` : null);

  const approvedTotal = useMemo(
    () => (data.costs as any[]).filter((c) => c.status === "approved").reduce((s, c) => s + Number(c.amount_eur), 0),
    [data.costs],
  );
  const pending = (data.costs as any[]).filter((c) => c.status === "pending");
  const approved = (data.costs as any[]).filter((c) => c.status === "approved");

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of approved) m.set(c.category, (m.get(c.category) ?? 0) + Number(c.amount_eur));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [approved]);

  const exportStatement = () => {
    const lines: string[] = [];
    lines.push("Tripping — Final Statement (Private)");
    lines.push(`Total approved: ${fmtEUR(approvedTotal)}`);
    lines.push("");
    lines.push("By category:");
    for (const [k, v] of byCategory) lines.push(`  ${CAT_LABEL[k] ?? k}: ${fmtEUR(v)}`);
    lines.push("");
    lines.push("Net per person (paid − share):");
    // settle keys are compound ("u:<id>" / "p:<id>") — personLabel handles them.
    for (const n of settle.net) lines.push(`  ${personLabel(n.userId)}: paid ${fmtEUR(n.paid)} · share ${fmtEUR(n.share)} · net ${fmtEUR(n.net)}`);
    lines.push("");
    lines.push("Settlement:");
    for (const t of settle.transfers) lines.push(`  ${personLabel(t.from)} → ${personLabel(t.to)}: ${fmtEUR(t.amount)}`);
    const text = lines.join("\n");
    navigator.clipboard.writeText(text);
    alert("Statement copied to clipboard.");
  };

  return (
    <div className="space-y-4">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl">Private Trip Cost</h1>
          <p className="text-sm text-muted-foreground">Owner-only — never shown publicly.</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          <Plus className="h-4 w-4" /> Add payment
        </button>
      </header>

      <section className="card-elev p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Total approved</div>
        <div className="mt-1 font-display text-4xl">{fmtEUR(approvedTotal)}</div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {byCategory.map(([k, v]) => (
            <span key={k} className="chip">{CAT_LABEL[k] ?? k}: {fmtEUR(v)}</span>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={exportStatement} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted">
            <Copy className="h-3.5 w-3.5" /> Copy statement
          </button>
          {data.isOwner && (
            <>
              <button
                disabled={busyShare || !tripId}
                onClick={async () => {
                  if (!tripId) return;
                  setBusyShare(true);
                  try {
                    const { token } = await doCreateShare({ data: { tripId } });
                    const url = `${window.location.origin}/cost/share/${token}`;
                    setShareUrl(url);
                    try { await navigator.clipboard.writeText(url); } catch {}
                  } catch (e: any) {
                    alert(e?.message ?? "Failed to create share link.");
                  } finally {
                    setBusyShare(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
              >
                {busyShare ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                Share owed-sheet
              </button>
              <button
                onClick={() => setShowTravellers(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
              >
                <Users className="h-3.5 w-3.5" /> Travellers
              </button>
            </>
          )}
        </div>
        {shareUrl && (
          <div className="mt-3 rounded-lg border border-border bg-muted/30 p-2 text-xs">
            <div className="font-medium">Link ready (copied to clipboard, valid 7 days):</div>
            <a href={shareUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 break-all text-primary">
              <Link2 className="h-3 w-3" /> {shareUrl}
            </a>
          </div>
        )}
      </section>



      {data.isOwner && pending.length > 0 && (
        <section className="card-elev p-4">
          <div className="text-sm font-semibold">Pending traveller submissions ({pending.length})</div>
          <ul className="mt-3 space-y-2">
            {pending.map((c: any) => (
              <li key={c.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-medium">{fmtEUR(Number(c.amount_eur))} · {CAT_LABEL[c.category] ?? c.category}</div>
                  <div className="text-xs text-muted-foreground">{c.day_date} · by {memberLabel(c.created_by)}</div>
                </div>
                {c.description && <div className="mt-1 text-xs text-muted-foreground">{c.description}</div>}
                {c.original_amount && (
                  <div className="mt-1 text-xs text-muted-foreground">Original: {c.original_amount} {c.original_currency}</div>
                )}
                <div className="mt-2 flex gap-2">
                  <button onClick={async () => { try { await doApprove({ data: { costId: c.id } }); refresh(); } catch (e: any) { alert(e?.message ?? "Failed"); } }}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs text-white">
                    <Check className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button onClick={async () => { try { await doReject({ data: { costId: c.id } }); refresh(); } catch (e: any) { alert(e?.message ?? "Failed"); } }}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted">
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card-elev p-4">
        <div className="text-sm font-semibold">Net balance per person</div>
        <ul className="mt-3 space-y-2">
          {settle.net.map((n: any) => (
            <li key={n.userId} className="flex items-center justify-between text-sm">
              <span className="truncate">{personLabel(n.userId)}</span>
              <span className="tabular-nums">
                paid {fmtEUR(n.paid)} · share {fmtEUR(n.share)} ·{" "}
                <span className={n.net >= 0 ? "text-emerald-600" : "text-red-600"}>
                  net {fmtEUR(n.net)}
                </span>
              </span>
            </li>
          ))}
          {settle.net.length === 0 && <li className="text-sm text-muted-foreground">No approved payments yet.</li>}
        </ul>
        {settle.transfers.length > 0 && (
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Settlement suggestion</div>
            <ul className="mt-2 space-y-1 text-sm">
              {settle.transfers.map((t: any, i: number) => (
                <li key={i}>{personLabel(t.from)} → {personLabel(t.to)}: <span className="tabular-nums">{fmtEUR(t.amount)}</span></li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card-elev p-4">
        <div className="text-sm font-semibold">Payment log</div>
        <ul className="mt-3 space-y-2">
          {approved.map((c: any) => {
            const splits = (data.splits as any[]).filter((s) => s.cost_id === c.id);
            const splitSummary = splits.length
              ? splits
                  .map((s) => {
                    const key = s.participant_user_id ? `u:${s.participant_user_id}` : s.participant_key ?? null;
                    return `${personLabel(key)} ${fmtEUR(Number(s.share_eur))}`;
                  })
                  .join(" · ")
              : "Split equally";
            return (
              <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-medium">{fmtEUR(Number(c.amount_eur))} · {CAT_LABEL[c.category] ?? c.category}</div>
                  <div className="text-xs text-muted-foreground">{c.day_date} · paid by {c.payer_id ? (payers.find((p) => p.id === c.payer_id)?.name ?? "Extra payer") : memberLabel(c.paid_by)}</div>
                </div>
                {c.description && <div className="mt-1 text-xs text-muted-foreground">{c.description}</div>}
                <div className="mt-1 text-[11px] text-muted-foreground">{splitSummary}</div>
                <div className="mt-2 flex gap-2">
                  {(data.isOwner || c.created_by === authUser?.id) && (
                    <button
                      onClick={async () => {
                        if (!confirm(`Delete this ${fmtEUR(Number(c.amount_eur))} payment?`)) return;
                        try { await doDelete({ data: { costId: c.id } }); refresh(); }
                        catch (e: any) { alert(e?.message ?? "Failed to delete"); }
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {approved.length === 0 && <li className="text-sm text-muted-foreground">No approved payments yet.</li>}
        </ul>
      </section>

      {showAdd && tripId && (
        <AddPaymentModal
          tripId={tripId}
          isOwner={data.isOwner}
          members={data.members}
          payers={payers}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); refresh(); }}
          doCreate={doCreate}
        />
      )}


      {showTravellers && tripId && (
        <TravellersModal tripId={tripId} onClose={() => { setShowTravellers(false); refresh(); }} />
      )}
    </div>
  );
}

// ============ Travellers modal (owner) ============
function TravellersModal({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-background p-5 shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl">People on this trip</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <TravellersManager tripId={tripId} />
      </div>
    </div>
  );
}




// ============ COMPANION ============
function CompanionView() {
  const fetchTrip = useServerFn(getDefaultTrip);
  const doCreate = useServerFn(createCost);
  const [tripId, setTripId] = useState<string | null>(null);
  const [mine, setMine] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  const ensureScaffold = useServerFn(ensureTripScaffold);
  useEffect(() => {
    fetchTrip().then(async (t) => {
      if (t?.id) { setTripId(t.id); return; }
      // Fresh database: initialise trip + days + photo bucket, then retry.
      // (No-op for non-owners: the server rejects and we swallow the error.)
      try {
        await ensureScaffold();
        const t2 = await fetchTrip();
        if (t2?.id) setTripId(t2.id);
      } catch { /* non-owner or scaffold failed */ }
    });
  }, [fetchTrip, ensureScaffold]);
  useEffect(() => {
    if (!tripId) return;
    supabase.from("trip_costs")
      .select("id, day_date, amount_eur, status, category, description, original_amount, original_currency")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .then(({ data }) => setMine(data ?? []));
  }, [tripId, showAdd]);

  return (
    <div className="space-y-4">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl">Submit payment</h1>
          <p className="text-sm text-muted-foreground">Submit a payment from today for owner approval. You don't see totals.</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          <Plus className="h-4 w-4" /> Submit
        </button>
      </header>

      <section className="card-elev p-4">
        <div className="text-sm font-semibold">Your submissions</div>
        <ul className="mt-3 space-y-2">
          {mine.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{fmtEUR(Number(c.amount_eur))} · {CAT_LABEL[c.category] ?? c.category}</div>
                <div className="truncate text-xs text-muted-foreground">{c.day_date}{c.description ? ` · ${c.description}` : ""}</div>
              </div>
              <span className={`chip ${c.status === "approved" ? "bg-emerald-100 text-emerald-700" : c.status === "rejected" ? "bg-red-100 text-red-700" : ""}`}>{c.status}</span>
            </li>
          ))}
          {mine.length === 0 && <li className="text-sm text-muted-foreground">No submissions yet.</li>}
        </ul>
      </section>

      {showAdd && tripId && (
        <AddPaymentModal
          tripId={tripId}
          isOwner={false}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); }}
          doCreate={doCreate}
        />
      )}
    </div>
  );
}

// ============ Add payment modal ============
function AddPaymentModal({
  tripId, isOwner, onClose, onSaved, doCreate, members = [], payers = [],
}: {
  tripId: string; isOwner: boolean;
  onClose: () => void; onSaved: () => void;
  doCreate: ReturnType<typeof useServerFn<typeof createCost>>;
  members?: { user_id: string; display_name?: string; email?: string; starts_on?: string | null; ends_on?: string | null }[];
  payers?: { id: string; name: string }[];
}) {
  const { user } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const [dayDate, setDayDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"EUR" | "USD" | "TRY">("EUR");
  const [category, setCategory] = useState<typeof COST_CATEGORIES[number]>("misc");
  const [description, setDescription] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  // paidBy: "self" | "u:<userId>" | "p:<payerId>"
  const [paidBy, setPaidBy] = useState<string>("self");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const doExtract = useServerFn(extractReceipt);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  // AI receipt scan: reads the photo, prefills amount/currency/category/description.
  async function scanReceipt(file: File) {
    setScanning(true);
    setScanNote(null);
    try {
      const imageDataUrl = await downscaleToDataUrl(file);
      const res: any = await doExtract({ data: { imageDataUrl } });
      if (res?.error) { setScanNote(res.error); return; }
      if (res?.amount) {
        setAmount(String(res.amount));
        if (res.currency) setCurrency(res.currency);
        if (res.category) setCategory(res.category);
        if (res.description && !description) setDescription(res.description);
        if (res.date) setDayDate(res.date);
        setScanNote(
          `Read ${res.amount} ${res.currency ?? ""}${res.currencyNote ? ` — ${res.currencyNote}` : " — check before saving."}`,
        );
      }
    } catch (e: any) {
      setScanNote(e?.message ?? "Scan failed — enter the amount manually.");
    } finally {
      setScanning(false);
    }
  }

  // All possible people to split between. Owner shows only for isOwner scenarios.
  const allPeople = useMemo(() => {
    const list: { key: string; label: string }[] = [];
    for (const m of members) {
      list.push({
        key: `u:${m.user_id}`,
        label: (m.user_id === user?.id ? `${m.display_name ?? "Me"} (me)` : (m.display_name ?? m.email ?? "Member")),
      });
    }
    for (const p of payers) list.push({ key: `p:${p.id}`, label: p.name });
    return list;
  }, [members, payers, user?.id]);

  // Split = everyone PRESENT on the selected day (members follow their
  // invite date window; a one-week guest doesn't share week-two costs).
  // The server computes the authoritative list; this mirrors it for preview.
  const presentPeople = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    for (const m of members) {
      if (m.starts_on && m.starts_on > dayDate) continue;
      if (m.ends_on && m.ends_on < dayDate) continue;
      out.push({
        key: `u:${m.user_id}`,
        label: m.user_id === user?.id ? `${m.display_name ?? "Me"} (me)` : (m.display_name ?? m.email ?? "Member"),
      });
    }
    for (const p of payers) out.push({ key: `p:${p.id}`, label: p.name });
    return out;
  }, [members, payers, dayDate, user?.id]);
  const absentPeople = useMemo(
    () => members.filter((m) => (m.starts_on && m.starts_on > dayDate) || (m.ends_on && m.ends_on < dayDate)),
    [members, dayDate],
  );


  async function submit() {
    setErr(null); setBusy(true);
    try {
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) throw new Error("Enter a valid amount");
      // splitAmong is always "everyone"; with nobody else on the trip yet the
      // server assigns the cost 100% to whoever paid.
      let receiptPath: string | null = null;
      if (receiptFile) {
        if (!user) throw new Error("Please sign in again to attach a receipt.");
        const ext = receiptFile.name.includes(".")
          ? receiptFile.name.slice(receiptFile.name.lastIndexOf(".")).toLowerCase().replace(/[^.a-z0-9]/g, "")
          : "";
        const randomId = (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const path = `${user.id}/${randomId}${ext}`;
        const { error: upErr } = await supabase.storage.from("receipts").upload(path, receiptFile, {
          upsert: false, contentType: receiptFile.type,
        });
        if (upErr) throw new Error(upErr.message || "Receipt upload failed");
        receiptPath = path;
      }
      const extra: { paidByUserId?: string | null; payerId?: string | null } = {};
      if (paidBy !== "self") {
        if (paidBy.startsWith("u:")) extra.paidByUserId = paidBy.slice(2);
        else if (paidBy.startsWith("p:")) extra.payerId = paidBy.slice(2);
      }
      await doCreate({ data: {
        tripId, dayDate, amount: amt, currency, category,
        description: description || undefined, receiptPath,
        // splitAmong deliberately omitted: the server splits equally between
        // everyone present on dayDate (date-window aware).
        ...extra,
      }});
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? "Could not save payment.");
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="card-elev w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl">Add payment</h2>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 grid gap-3">
          <Row label="Date">
            <input type="date" value={dayDate} onChange={(e) => setDayDate(e.target.value)} className="input" />
          </Row>
          <Row label="Amount">
            <div className="flex gap-2">
              <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input flex-1" />
              <select value={currency} onChange={(e) => setCurrency(e.target.value as any)} className="input w-24">
                {COST_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {currency !== "EUR" && <div className="mt-1 text-xs text-muted-foreground">Converted to EUR using today's rate.</div>}
          </Row>
          <Row label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value as any)} className="input">
              {COST_CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select>
          </Row>
          {(
            <Row label="Paid by">
              <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} className="input">
                <option value="self">Me</option>
                {members.filter((m) => m.user_id !== user?.id).map((m) => (
                  <option key={`u:${m.user_id}`} value={`u:${m.user_id}`}>
                    {m.display_name ?? m.email ?? "Member"}
                  </option>
                ))}
                {payers.map((p) => (
                  <option key={`p:${p.id}`} value={`p:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Row>
          )}

          <Row label="Split">
            {presentPeople.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                Just you for now — the cost goes 100% to whoever paid. Add people on the Travellers page to share costs.
              </div>
            ) : (
              <div className="rounded-md border border-border/60 px-2.5 py-2 text-xs text-muted-foreground">
                Split equally between the {presentPeople.length} on the trip that day:{" "}
                <span className="text-foreground">{presentPeople.map((p) => p.label).join(", ")}</span>
                {amount && parseFloat(amount) > 0 && (
                  <span className="ml-1 font-mono text-foreground">
                    — {fmtEUR((parseFloat(amount) || 0) / presentPeople.length)} each
                  </span>
                )}
                {absentPeople.length > 0 && (
                  <div className="mt-1 text-[11px]">
                    Not counted (absent on {dayDate}): {absentPeople.map((m) => m.display_name ?? m.email ?? "Member").join(", ")}
                  </div>
                )}
              </div>
            )}
          </Row>

          <Row label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input" maxLength={500} />
          </Row>
          <Row label="Receipt (optional)">
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setReceiptFile(f);
                // Photos get scanned automatically; PDFs are attach-only.
                if (f && f.type.startsWith("image/")) scanReceipt(f);
              }}
              className="text-xs"
            />
            {scanning && (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the receipt…
              </div>
            )}
            {scanNote && !scanning && (
              <div className="mt-1.5 text-xs text-muted-foreground">{scanNote}</div>
            )}
          </Row>
          {err && <div className="text-sm text-red-600">{err}</div>}
          <button onClick={submit} disabled={busy} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// ============ Edit splits (owner) ============
type PerPersonShare = {
  userId: string | null;
  participantKey: string | null;
  shareEur: number;
};

function EditSplitsModal({
  cost, splits, members, payers = [], onClose, onSaved,
}: {
  cost: any;
  splits: any[];
  members: any[];
  payers?: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (perPerson: PerPersonShare[]) => Promise<void> | void;
}) {
  const total = Number(cost.amount_eur);

  // Editable rows = every trip member PLUS anyone already in the split
  // (named payers, legacy keys). The old version rendered members only —
  // with an empty members list "Split equally" visibly did nothing.
  const rows = useMemo(() => {
    const out: { key: string; userId: string | null; participantKey: string | null; label: string }[] = [];
    const seen = new Set<string>();
    for (const m of members) {
      if (!m.user_id || seen.has(m.user_id)) continue;
      seen.add(m.user_id);
      out.push({ key: m.user_id, userId: m.user_id, participantKey: null, label: m.display_name ?? m.email ?? "Member" });
    }
    for (const s of splits) {
      const key = s.participant_user_id ?? s.participant_key;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const payerName = typeof key === "string" && key.startsWith("p:")
        ? payers.find((p) => p.id === key.slice(2))?.name
        : undefined;
      out.push({
        key,
        userId: s.participant_user_id ?? null,
        participantKey: s.participant_user_id ? null : key,
        label: payerName ?? (s.participant_user_id ? "Member" : String(key)),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cost.id, members.length, splits.length, payers.length]);

  // Seed from existing splits, falling back to equal split across rows.
  const initial = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    if (splits.length) {
      for (const s of splits) {
        const key = s.participant_user_id ?? s.participant_key ?? "_";
        map[key] = String(Number(s.share_eur).toFixed(2));
      }
    } else {
      const share = rows.length ? total / rows.length : 0;
      for (const r of rows) map[r.key] = share.toFixed(2);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cost.id, rows.length]);

  const [shares, setShares] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sum = useMemo(
    () => Object.values(shares).reduce((s, v) => s + (parseFloat(v) || 0), 0),
    [shares],
  );
  const diff = total - sum;

  function splitEqually() {
    const n = rows.length || 1;
    const each = total / n;
    const next: Record<string, string> = {};
    for (const r of rows) next[r.key] = each.toFixed(2);
    setShares(next);
  }

  async function save() {
    setErr(null);
    if (Math.abs(diff) > 0.02) {
      setErr(`Split total ${fmtEUR(sum)} must equal cost ${fmtEUR(total)} (off by ${fmtEUR(diff)}).`);
      return;
    }
    setBusy(true);
    try {
      const perPerson: PerPersonShare[] = rows.map((r) => ({
        userId: r.userId,
        participantKey: r.participantKey,
        shareEur: parseFloat(shares[r.key] ?? "0") || 0,
      }));
      await onSaved(perPerson);
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="card-elev w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl">Edit splits</h2>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Total {fmtEUR(total)} · adjust each share. Must sum to total.
        </div>
        <div className="mt-4 space-y-2">
          {rows.map((r) => (
            <div key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-2">
              <span className="truncate text-sm">{r.label}</span>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">€</span>
                <input
                  type="number"
                  step="0.01"
                  className="input w-28 text-right tabular-nums"
                  value={shares[r.key] ?? "0.00"}
                  onChange={(e) => setShares({ ...shares, [r.key]: e.target.value })}
                />
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="text-xs text-muted-foreground">Nobody to split with yet — add people on the Travellers page first.</div>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <button
            onClick={splitEqually}
            className="rounded-md border border-border px-2 py-1 hover:bg-muted"
          >
            Split equally
          </button>
          <span className={Math.abs(diff) > 0.02 ? "text-red-600" : "text-emerald-600"}>
            Sum {fmtEUR(sum)} {Math.abs(diff) > 0.02 ? `(off by ${fmtEUR(diff)})` : "✓"}
          </span>
        </div>
        {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
        <button
          onClick={save}
          disabled={busy}
          className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
          Save splits
        </button>
      </div>
    </div>
  );
}

