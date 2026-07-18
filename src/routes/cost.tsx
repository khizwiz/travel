import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Edit3, Link2, Loader2, Lock, Plus, Receipt, Share2, Trash2, UserMinus, UserPlus, Users, Wallet, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getDefaultTrip } from "@/lib/access.functions";
import {
  COST_CATEGORIES, addTraveller, approveCost, computeSettlement, createCost, createCostShareSnapshot,
  deleteCost, listCosts, listTravellers, rejectCost, removeTraveller, updateCostAmounts,
} from "@/lib/cost.functions";
import { addCostPayer, listCostPayers, removeCostPayer } from "@/lib/cost-payers.functions";


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

  useEffect(() => { fetchTrip().then((t) => t && setTripId(t.id)); }, [fetchTrip]);
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
    for (const n of settle.net) lines.push(`  ${memberLabel(n.userId)}: paid ${fmtEUR(n.paid)} · share ${fmtEUR(n.share)} · net ${fmtEUR(n.net)}`);
    lines.push("");
    lines.push("Settlement:");
    for (const t of settle.transfers) lines.push(`  ${memberLabel(t.from)} → ${memberLabel(t.to)}: ${fmtEUR(t.amount)}`);
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



      {pending.length > 0 && (
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
                  <button onClick={async () => { await doApprove({ data: { costId: c.id } }); refresh(); }}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs text-white">
                    <Check className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button onClick={async () => { await doReject({ data: { costId: c.id } }); refresh(); }}
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
                  <button
                    onClick={() => setEditSplits({ cost: c, splits })}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                  >
                    <Edit3 className="h-3 w-3" /> Edit splits
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete this ${fmtEUR(Number(c.amount_eur))} payment?`)) return;
                      await doDelete({ data: { costId: c.id } });
                      refresh();
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
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
          isOwner
          members={data.members}
          payers={payers}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); refresh(); }}
          doCreate={doCreate}
        />
      )}


      {editSplits && (
        <EditSplitsModal
          cost={editSplits.cost}
          splits={editSplits.splits}
          members={data.members}
          onClose={() => setEditSplits(null)}
          onSaved={async (perPerson) => {
            await doUpdateSplits({ data: { costId: editSplits.cost.id, perPerson } });
            setEditSplits(null);
            refresh();
          }}
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
  const doList = useServerFn(listTravellers);
  const doAdd = useServerFn(addTraveller);
  const doRemove = useServerFn(removeTraveller);
  const doListPayers = useServerFn(listCostPayers);
  const doAddPayer = useServerFn(addCostPayer);
  const doRemovePayer = useServerFn(removeCostPayer);
  const [rows, setRows] = useState<any[]>([]);
  const [payers, setPayers] = useState<{ id: string; name: string }[]>([]);
  const [email, setEmail] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [payerName, setPayerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyPayer, setBusyPayer] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try { setRows(await doList({ data: { tripId } })); } catch {}
    try { setPayers(await doListPayers({ data: { tripId } })); } catch {}
  }
  useEffect(() => { refresh(); }, []);

  async function add() {
    setBusy(true); setErr(null);
    try {
      await doAdd({ data: { tripId, email: email.trim(), startsOn: startsOn || null, endsOn: endsOn || null } });
      setEmail(""); setStartsOn(""); setEndsOn("");
      await refresh();
    } catch (e: any) { setErr(e?.message ?? "Failed to add"); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Remove this traveller? Their historical splits stay in place.")) return;
    try { await doRemove({ data: { memberId: id } }); await refresh(); } catch (e: any) { alert(e?.message); }
  }

  async function addPayer() {
    if (!payerName.trim()) return;
    setBusyPayer(true); setErr(null);
    try {
      await doAddPayer({ data: { tripId, name: payerName.trim() } });
      setPayerName("");
      await refresh();
    } catch (e: any) { setErr(e?.message ?? "Failed to add payer"); }
    finally { setBusyPayer(false); }
  }

  async function removePayer(id: string) {
    if (!confirm("Remove this extra payer? Costs attributed to them stay in place with the name cleared.")) return;
    try { await doRemovePayer({ data: { id } }); await refresh(); } catch (e: any) { alert(e?.message); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-background p-5 shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl">People on this trip</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Add anyone you split costs with. Names are enough — you only need an email if they should log in to the app.
        </p>

        {/* PRIMARY: add by name (creates a cost_payer). No account required. */}
        <div className="mt-4 rounded-lg border border-border p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add a person</div>
          <div className="mt-2 flex items-center gap-2">
            <input
              className="input flex-1"
              value={payerName}
              onChange={(e) => setPayerName(e.target.value)}
              placeholder="Name (e.g. Simona, Miezko, Ali)"
              maxLength={80}
            />
            <button disabled={!payerName.trim() || busyPayer} onClick={addPayer}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60">
              {busyPayer ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Add
            </button>
          </div>
          {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
          <ul className="mt-3 space-y-1.5">
            {payers.length === 0 && <li className="text-xs text-muted-foreground">No people added yet.</li>}
            {payers.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-md border border-border/60 px-2 py-1.5 text-sm">
                <span className="truncate">{p.name}</span>
                <button onClick={() => removePayer(p.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50">
                  <UserMinus className="h-3 w-3" /> Remove
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Existing app-user members (owner + anyone who logs in) */}
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">App accounts on this trip</div>
          <ul className="mt-2 space-y-2">
            {rows.length === 0 && <li className="text-xs text-muted-foreground">Just you for now.</li>}
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-md border border-border/60 p-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.display_name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.email ?? ""}
                    {(r.starts_on || r.ends_on) && ` · ${r.starts_on ?? "start"} → ${r.ends_on ?? "end"}`}
                    {r.status !== "active" && ` · ${r.status}`}
                  </div>
                </div>
                {r.status === "active" && (
                  <button onClick={() => remove(r.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                    <UserMinus className="h-3 w-3" /> Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* ADVANCED: invite by email (creates a login). Hidden behind a details toggle. */}
        <details className="mt-4 rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Invite by email (creates an app login)
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <label className="sm:col-span-3 block">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Email</div>
              <input className="input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="friend@example.com" />
            </label>
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Active from</div>
              <input className="input mt-1" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </label>
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Active to</div>
              <input className="input mt-1" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </label>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button disabled={!email.trim() || busy} onClick={add}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium disabled:opacity-60">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Invite
            </button>
          </div>
        </details>
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

  useEffect(() => { fetchTrip().then((t) => t && setTripId(t.id)); }, [fetchTrip]);
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
  members?: { user_id: string; display_name?: string; email?: string }[];
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

  // Default: everyone selected.
  const [splitAmong, setSplitAmong] = useState<string[]>([]);
  useEffect(() => {
    setSplitAmong(allPeople.map((p) => p.key));
  }, [allPeople.length]);

  const toggleSplit = (key: string) => {
    setSplitAmong((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };


  async function submit() {
    setErr(null); setBusy(true);
    try {
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) throw new Error("Enter a valid amount");
      if (splitAmong.length === 0) throw new Error("Select at least one person to split between");
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
        splitAmong,
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
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="TRY">TRY</option>
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

          {(
            <Row label="Split between (equal)">
              {allPeople.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  Add travellers or extra payers to split with. For now it goes 100% to whoever paid.
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    <button type="button" onClick={() => setSplitAmong(allPeople.map((p) => p.key))}
                      className="rounded-md border border-border px-2 py-0.5 hover:bg-muted">All</button>
                    <button type="button" onClick={() => setSplitAmong([])}
                      className="rounded-md border border-border px-2 py-0.5 hover:bg-muted">None</button>
                  </div>
                  <ul className="space-y-1">
                    {allPeople.map((p) => (
                      <li key={p.key}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 text-sm hover:bg-muted">
                          <input
                            type="checkbox"
                            checked={splitAmong.includes(p.key)}
                            onChange={() => toggleSplit(p.key)}
                          />
                          <span className="truncate">{p.label}</span>
                          {splitAmong.includes(p.key) && amount && (
                            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                              {fmtEUR((parseFloat(amount) || 0) / splitAmong.length)}
                            </span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Row>
          )}

          <Row label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input" maxLength={500} />
          </Row>
          <Row label="Receipt (optional)">
            <input type="file" accept="image/*,.pdf" onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} className="text-xs" />
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
  cost, splits, members, onClose, onSaved,
}: {
  cost: any;
  splits: any[];
  members: any[];
  onClose: () => void;
  onSaved: (perPerson: PerPersonShare[]) => Promise<void> | void;
}) {
  const total = Number(cost.amount_eur);
  // Seed from existing splits, falling back to equal split across members.
  const initial = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    if (splits.length) {
      for (const s of splits) {
        const key = s.participant_user_id ?? s.participant_key ?? "_";
        map[key] = String(Number(s.share_eur).toFixed(2));
      }
    } else {
      const share = members.length ? total / members.length : 0;
      for (const m of members) map[m.user_id] = share.toFixed(2);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cost.id]);

  const [shares, setShares] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sum = useMemo(
    () => Object.values(shares).reduce((s, v) => s + (parseFloat(v) || 0), 0),
    [shares],
  );
  const diff = total - sum;

  function splitEqually() {
    const n = members.length || 1;
    const each = total / n;
    const next: Record<string, string> = {};
    for (const m of members) next[m.user_id] = each.toFixed(2);
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
      const perPerson: PerPersonShare[] = members.map((m) => ({
        userId: m.user_id,
        participantKey: null,
        shareEur: parseFloat(shares[m.user_id] ?? "0") || 0,
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
          {members.map((m) => (
            <div key={m.user_id} className="grid grid-cols-[1fr_auto] items-center gap-2">
              <span className="truncate text-sm">{m.display_name ?? m.email ?? "User"}</span>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">€</span>
                <input
                  type="number"
                  step="0.01"
                  className="input w-28 text-right tabular-nums"
                  value={shares[m.user_id] ?? "0.00"}
                  onChange={(e) => setShares({ ...shares, [m.user_id]: e.target.value })}
                />
              </div>
            </div>
          ))}
          {members.length === 0 && (
            <div className="text-xs text-muted-foreground">No members on this trip yet.</div>
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

