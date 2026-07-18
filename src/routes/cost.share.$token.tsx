import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Wallet } from "lucide-react";
import { getCostShareSnapshot } from "@/lib/cost.functions";

export const Route = createFileRoute("/cost/share/$token")({
  head: () => ({ meta: [
    { title: "Trip cost share — Tripping" },
    { name: "robots", content: "noindex" },
  ]}),
  component: SharePage,
});

function fmtEUR(n: number) {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(n);
}

function SharePage() {
  const { token } = Route.useParams();
  const fetchSnap = useServerFn(getCostShareSnapshot);
  const { data, isLoading, error } = useQuery({
    queryKey: ["cost-share", token],
    queryFn: () => fetchSnap({ data: { token } }),
    staleTime: 60_000,
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (error || !data) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="card-elev p-6 text-center">
          <div className="font-display text-xl">Link expired</div>
          <p className="mt-2 text-sm text-muted-foreground">
            This shared statement is no longer available. Ask the trip owner for a new link.
          </p>
          <Link to="/" className="mt-4 inline-flex items-center gap-1 text-sm text-primary">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to trip
          </Link>
        </div>
      </div>
    );
  }

  const p = data.payload as any;
  const expiresIn = Math.max(0, Math.round((new Date(data.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <header className="card-elev p-5">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Wallet className="h-3.5 w-3.5" /> Trip cost — shared statement
        </div>
        <h1 className="mt-1 font-display text-2xl">{p.tripName}</h1>
        <div className="mt-1 text-xs text-muted-foreground">
          Generated {new Date(p.generatedAt).toLocaleString()} · expires in {expiresIn} day{expiresIn === 1 ? "" : "s"}
        </div>
        <div className="mt-4 font-display text-3xl">{fmtEUR(p.approvedTotal)}</div>
        <div className="text-xs text-muted-foreground">Total approved spend</div>
      </header>

      <section className="card-elev p-4">
        <div className="text-sm font-semibold">Who owes whom</div>
        {p.transfers.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Everyone is square.</p>
        ) : (
          <ul className="mt-3 space-y-1.5 text-sm">
            {p.transfers.map((t: any, i: number) => (
              <li key={i} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                <span>
                  <span className="font-medium">{t.fromName}</span>
                  <span className="mx-2 text-muted-foreground">→</span>
                  <span className="font-medium">{t.toName}</span>
                </span>
                <span className="tabular-nums font-semibold">{fmtEUR(t.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card-elev p-4">
        <div className="text-sm font-semibold">Net per person</div>
        <ul className="mt-3 space-y-1.5 text-sm">
          {p.net.map((n: any) => (
            <li key={n.userId} className="flex items-center justify-between">
              <span className="truncate">{n.name}</span>
              <span className="tabular-nums text-xs text-muted-foreground">
                paid {fmtEUR(n.paid)} · share {fmtEUR(n.share)} ·{" "}
                <span className={n.net >= 0 ? "text-emerald-600" : "text-red-600"}>
                  net {fmtEUR(n.net)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card-elev p-4">
        <div className="text-sm font-semibold">Every payment</div>
        <ul className="mt-3 space-y-2 text-sm">
          {p.costs.map((c: any) => (
            <li key={c.id} className="rounded-md border border-border/60 p-2.5">
              <div className="flex justify-between">
                <span className="font-medium">{fmtEUR(c.amount)} · {c.category}</span>
                <span className="text-xs text-muted-foreground">{c.day} · {c.paidByName}</span>
              </div>
              {c.description && <div className="mt-0.5 text-xs text-muted-foreground">{c.description}</div>}
              <div className="mt-1 text-[11px] text-muted-foreground">
                {c.splits.map((s: any, i: number) => (
                  <span key={i}>{i > 0 && " · "}{s.name} {fmtEUR(s.share)}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
