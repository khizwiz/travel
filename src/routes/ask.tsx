import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Send, Sparkles, Loader2 } from "lucide-react";
import { askTripping } from "@/lib/ask.functions";
import { ITINERARY, MISSING_INFO, VEHICLE, getTripProgress } from "@/lib/trip-data";
import { useApp } from "@/lib/app-state";

export const Route = createFileRoute("/ask")({
  head: () => ({
    meta: [
      { title: "Ask Tripping — travel assistant" },
      { name: "description", content: "Ask anything about the Istanbul-and-back road trip." },
    ],
  }),
  component: AskPage,
});

type Turn = { q: string; a?: string; error?: string; loading?: boolean };

function AskPage() {
  const ask = useServerFn(askTripping);
  const { liveFix } = useApp();
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);

  const progress = getTripProgress(new Date(), liveFix ? { lat: liveFix.lat, lng: liveFix.lng } : null);
  const today = progress.todayDay ?? (progress.index >= 0 ? ITINERARY[progress.index] : null);

  // Give the model the full trip knowledge it needs to act as an in-app search.
  const itineraryLines = ITINERARY.map((d) => {
    const bits: string[] = [`${d.date}: ${d.from} → ${d.to} (${d.transport})`];
    if (d.distanceKm) bits.push(`${d.distanceKm} km`);
    if (d.accommodation?.name) bits.push(`stay: ${d.accommodation.name}`);
    if (d.ferry) bits.push(`ferry ${d.ferry.from}→${d.ferry.to}`);
    if (d.flight) bits.push(`flight ${d.flight.from}→${d.flight.to}${d.flight.number ? ` ${d.flight.number}` : ""}`);
    if (d.notes) bits.push(d.notes);
    return "- " + bits.join(" · ");
  }).join("\n");
  const missingLines = MISSING_INFO.map((m) => `- ${m.item} (${m.where})`).join("\n");
  const vehicleLine = `${VEHICLE.year} ${VEHICLE.make} ${VEHICLE.model}, ${VEHICLE.fuel}, ${VEHICLE.tankLitres} L tank, low-fuel warn at ${VEHICLE.lowFuelWarnPct}%.`;
  const todayLine = today ? `TODAY ${today.date}: ${today.from} → ${today.to}.` : "Trip not started yet.";
  const context = [
    todayLine,
    `VEHICLE: ${vehicleLine}`,
    `ITINERARY (${ITINERARY.length} days):\n${itineraryLines}`,
    `INFORMATION STILL NEEDED:\n${missingLines}`,
  ].join("\n\n");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question) return;
    setQ("");
    const idx = turns.length;
    setTurns((t) => [...t, { q: question, loading: true }]);
    const res = await ask({ data: { question, context } });
    setTurns((t) =>
      t.map((tn, i) =>
        i === idx ? { q: tn.q, loading: false, a: (res as any).answer, error: (res as any).error } : tn,
      ),
    );
  }

  const suggestions = [
    "Which hotels do we still need to book?",
    "What's on the itinerary between 3 and 7 August?",
    "How many driving days are longer than 400 km?",
    "Best beach near Athens within 30 km, no shopping streets.",
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Travel assistant
        </div>
        <h1 className="mt-1 font-display text-3xl inline-flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" /> Ask Tripping
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search the trip — dates, cities, bookings, vehicle — or ask general travel questions.
        </p>
      </header>

      <div className="card-elev space-y-4 p-4">
        {turns.length === 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Try
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setQ(s)}
                  className="chip hover:border-primary/40 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="rounded-2xl bg-primary/10 px-3 py-2 text-sm">{t.q}</div>
            {t.loading ? (
              <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
              </div>
            ) : t.error ? (
              <div className="rounded-2xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {t.error}
              </div>
            ) : (
              <div className="whitespace-pre-wrap rounded-2xl bg-muted/60 px-3 py-2 text-sm leading-relaxed">
                {t.a}
              </div>
            )}
          </div>
        ))}

        <form onSubmit={submit} className="flex items-center gap-2 border-t border-border/60 pt-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask about the route, food, kids activities…"
            className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm outline-none focus:border-primary/40"
          />
          <button
            type="submit"
            disabled={!q.trim()}
            className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Send className="h-4 w-4" /> Ask
          </button>
        </form>
      </div>
    </div>
  );
}
