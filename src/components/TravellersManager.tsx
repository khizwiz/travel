import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Loader2, Lock, UserMinus, UserPlus } from "lucide-react";
import {
  addTraveller, listTravellers, removeTraveller, resetMemberPassword, updateMemberDates,
} from "@/lib/cost.functions";
import { addCostPayer, listCostPayers, removeCostPayer } from "@/lib/cost-payers.functions";

// Shared traveller management: used as the /travellers page (owner tab) and
// inside the Cost page's "People on this trip" modal.
export function TravellersManager({ tripId }: { tripId: string }) {
  const doList = useServerFn(listTravellers);
  const doAdd = useServerFn(addTraveller);
  const doRemove = useServerFn(removeTraveller);
  const doResetPwd = useServerFn(resetMemberPassword);
  const doUpdateDates = useServerFn(updateMemberDates);
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
  const [reveal, setReveal] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try { setRows(await doList({ data: { tripId } })); } catch {}
    try { setPayers(await doListPayers({ data: { tripId } })); } catch {}
  }
  useEffect(() => { refresh(); }, []);

  async function add() {
    setBusy(true); setErr(null);
    const invitedEmail = email.trim().toLowerCase();
    try {
      const res = await doAdd({ data: { tripId, email: invitedEmail, startsOn: startsOn || null, endsOn: endsOn || null } });
      setEmail(""); setStartsOn(""); setEndsOn("");
      if (res?.starterPassword) {
        setReveal({ email: invitedEmail, password: res.starterPassword });
        setCopied(false);
      }
      await refresh();
    } catch (e: any) { setErr(e?.message ?? "Failed to add"); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Remove this traveller? Their historical splits stay in place.")) return;
    try { await doRemove({ data: { memberId: id } }); await refresh(); } catch (e: any) { alert(e?.message); }
  }

  async function resetPwd(r: any) {
    if (!confirm(`Set a new password for ${r.email ?? r.display_name}? Their old one stops working.`)) return;
    try {
      const res = await doResetPwd({ data: { memberId: r.id } });
      setReveal({ email: r.email ?? r.display_name, password: res.password });
      setCopied(false);
      await refresh();
    } catch (e: any) { alert(e?.message); }
  }

  async function saveDates(r: any, startsOn: string, endsOn: string) {
    try {
      await doUpdateDates({ data: { memberId: r.id, startsOn: startsOn || null, endsOn: endsOn || null } });
      await refresh();
    } catch (e: any) { alert(e?.message ?? "Failed to update dates"); }
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
    <div>
      <p className="mt-1 text-xs text-muted-foreground">
        Add anyone you split costs with. Names are enough — you only need an email if they should log in to the app.
      </p>

      {/* Invite by email (creates a login) */}
      <div className="mt-4 rounded-lg border border-border p-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Invite by email — creates a login (they can add costs)
        </div>
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
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Invite
          </button>
        </div>
        {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
      </div>

      {/* One-time password reveal after inviting / resetting */}
      {reveal && (
        <div className="mt-4 rounded-lg border-2 border-amber-400/70 bg-amber-50 p-3 dark:bg-amber-950/30">
          <div className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            Login details — shown once, copy them now
          </div>
          <div className="mt-2 space-y-1 font-mono text-sm">
            <div className="truncate">{reveal.email}</div>
            <div className="font-semibold">{reveal.password}</div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Send these to the person. They log in via the <b>Log in → Member</b> tab. You can reset the password here any time.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${reveal.email}\n${reveal.password}`);
                  setCopied(true);
                } catch { /* clipboard unavailable */ }
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
            </button>
            <button onClick={() => setReveal(null)}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
              Done
            </button>
          </div>
        </div>
      )}

      {/* Existing app-user members (owner + anyone who logs in) */}
      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">App accounts on this trip</div>
        <ul className="mt-2 space-y-2">
          {rows.length === 0 && <li className="text-xs text-muted-foreground">Just you for now.</li>}
          {rows.map((r) => (
            <li key={r.id} className="rounded-md border border-border/60 p-2 text-sm">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.display_name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.email ?? ""}
                    {r.status !== "active" && ` · ${r.status}`}
                  </div>
                </div>
                {r.status === "active" && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    {r.role_in_trip !== "owner" && r.email && (
                      <button onClick={() => resetPwd(r)}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                        <Lock className="h-3 w-3" /> Reset password
                      </button>
                    )}
                    <button onClick={() => remove(r.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                      <UserMinus className="h-3 w-3" /> Remove
                    </button>
                  </div>
                )}
              </div>
              {/* Presence window: drives which costs this person shares. */}
              {r.status === "active" && r.role_in_trip !== "owner" && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">On the trip:</span>
                  <input
                    type="date"
                    defaultValue={r.starts_on ?? ""}
                    onBlur={(e) => { if (e.target.value !== (r.starts_on ?? "")) saveDates(r, e.target.value, r.ends_on ?? ""); }}
                    className="input h-7 w-[8.5rem] px-1.5 py-0.5 text-xs"
                  />
                  <span className="text-muted-foreground">→</span>
                  <input
                    type="date"
                    defaultValue={r.ends_on ?? ""}
                    onBlur={(e) => { if (e.target.value !== (r.ends_on ?? "")) saveDates(r, r.starts_on ?? "", e.target.value); }}
                    className="input h-7 w-[8.5rem] px-1.5 py-0.5 text-xs"
                  />
                  <span className="text-[11px] text-muted-foreground">empty = whole trip</span>
                </div>
              )}
              {/* App-generated password, owner-visible so forgetters can be rescued. */}
              {r.starter_password && r.role_in_trip !== "owner" && (
                <div className="mt-1.5 flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Login password:</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{r.starter_password}</code>
                  <button
                    onClick={async () => { try { await navigator.clipboard.writeText(`${r.email ?? ""}\n${r.starter_password}`); } catch {} }}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] hover:bg-muted">
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Add by name only (creates a cost_payer, no account) */}
      <div className="mt-4 rounded-lg border border-border p-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add a person without a login</div>
        <div className="mt-2 flex items-center gap-2">
          <input
            className="input flex-1"
            value={payerName}
            onChange={(e) => setPayerName(e.target.value)}
            placeholder="Name (e.g. Simona, Miezko, Ali)"
            maxLength={80}
          />
          <button disabled={!payerName.trim() || busyPayer} onClick={addPayer}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium disabled:opacity-60">
            {busyPayer ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Add
          </button>
        </div>
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
    </div>
  );
}
