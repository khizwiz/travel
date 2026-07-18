import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, Circle, AlertCircle, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ITINERARY, MISSING_INFO, formatDate, getTripProgress, type ItineraryDay } from "@/lib/trip-data";
import { usePlanOverrides, type PlanOverride } from "@/hooks/use-plan-overrides";

export const Route = createFileRoute("/checklist")({
  head: () => ({ meta: [{ title: "Checklists — Tripping" }] }),
  component: ChecklistsPage,
});

interface ListDef {
  title: string;
  items: string[];
}

const STATIC_LISTS: ListDef[] = [
  {
    title: "Morning vehicle walk-around",
    items: [
      "Current odometer recorded",
      "Passenger count confirmed",
      "Luggage / load: light, medium or heavy",
      "Fuel percentage",
      "Warning lights check",
      "Leaks check (drips under car)",
      "Tyre pressure & condition",
      "Unusual sounds",
    ],
  },
  {
    title: "Daily fluids & systems",
    items: [
      "Engine oil",
      "Coolant (cold engine only)",
      "Brake fluid",
      "Washer fluid",
      "Battery terminals",
      "Visible belts",
      "Spare tyre present",
      "Load straps tight",
    ],
  },
];

// Build contextual items for a single itinerary day, factoring in overrides.
function buildDayItems(day: ItineraryDay, override?: PlanOverride): string[] {
  const to = override?.to ?? day.to;
  const from = override?.from ?? day.from;
  const transport = (override?.transport ?? day.transport) as ItineraryDay["transport"];
  const distanceKm = override?.distance_km ?? day.distanceKm ?? 0;
  const items: string[] = [];

  if (transport === "flight" || day.flight) {
    items.push(
      "Online check-in completed",
      "Boarding passes saved offline",
      "Cabin bag within size limit",
      "Liquids in approved bag",
      "Airport transport booked",
    );
  }
  if (transport === "ferry" || day.ferry) {
    items.push(
      "Vehicle deck arrival window confirmed",
      "Cabin booked",
      "Refuel before ferry terminal",
      "Pet documents ready (if Fez on board)",
    );
  }
  const isBorderCross = day.borderWaitMin && day.borderWaitMin > 0;
  if (isBorderCross) {
    items.push(
      "Passports (and Fez documents)",
      "Vehicle registration",
      "Green Card / insurance",
      "Employer vehicle authority letter",
      "Cash for road tolls / vignettes",
    );
  }
  if (transport === "drive" && distanceKm >= 400) {
    items.push(
      "Full tank before departure",
      "Plan one mid-route rest stop",
      "Snacks & water topped up",
    );
  }
  if (from === to && (distanceKm ?? 0) === 0) {
    items.push("Rest day — no driving", "Confirm next-day departure time");
  }
  if (!override && day.missing?.length) {
    for (const m of day.missing) items.push(`Confirm: ${m}`);
  }
  return items;
}

function ChecklistsPage() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setDone((d) => ({ ...d, [k]: !d[k] }));
  const { map: overrides } = usePlanOverrides();

  const upcoming = useMemo(() => {
    const progress = getTripProgress();
    const startIdx = progress.phase === "before" ? 0 : Math.max(0, progress.index);
    return ITINERARY.slice(startIdx, startIdx + 3).map((d) => ({
      day: d,
      override: overrides.get(d.date),
      items: buildDayItems(d, overrides.get(d.date)),
    })).filter((x) => x.items.length > 0);
  }, [overrides]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-3xl">Checklists</h1>
        <p className="text-sm text-muted-foreground">
          Auto-built from today's itinerary and updates whenever you change the plan.
        </p>
      </header>

      <section className="card-elev p-4 border-l-4 border-l-warning">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-warning" />
          <h2 className="font-medium">Information required</h2>
          <Link to="/planning" className="ml-auto text-xs font-medium text-primary hover:underline">Open planning →</Link>
        </div>
        <ul className="mt-3 space-y-1.5">
          {MISSING_INFO.map((m) => {
            const key = `info::${m.item}`;
            const checked = !!done[key];
            return (
              <li key={key}>
                <button
                  onClick={() => toggle(key)}
                  className="flex w-full items-start gap-3 rounded-lg p-2 text-left text-sm transition hover:bg-muted/50"
                >
                  {checked ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                  ) : (
                    <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0">
                    <span className={cn("block font-medium", checked && "text-muted-foreground line-through")}>{m.item}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{m.why}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground/80">Where: {m.where}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {upcoming.map(({ day, override, items }, i) => {
        const to = override?.to ?? day.to;
        const from = override?.from ?? day.from;
        const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : formatDate(day.date);
        return (
          <section key={day.date} className="card-elev p-4">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" />
              <h2 className="font-medium">
                {label} · {from}
                {to && to !== from ? ` → ${to}` : ""}
              </h2>
              {override && (
                <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  re-planned
                </span>
              )}
            </div>
            <ul className="mt-3 space-y-1.5">
              {items.map((it) => {
                const key = `${day.date}::${it}`;
                const checked = !!done[key];
                return (
                  <li key={key}>
                    <button
                      onClick={() => toggle(key)}
                      className="flex w-full items-center gap-3 rounded-lg p-2 text-left text-sm transition hover:bg-muted/50"
                    >
                      {checked ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                      ) : (
                        <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
                      )}
                      <span className={cn("min-w-0", checked && "text-muted-foreground line-through")}>{it}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {STATIC_LISTS.map((l) => (
        <section key={l.title} className="card-elev p-4">
          <h2 className="font-medium">{l.title}</h2>
          <ul className="mt-3 space-y-1.5">
            {l.items.map((it) => {
              const key = `${l.title}::${it}`;
              const checked = !!done[key];
              return (
                <li key={key}>
                  <button
                    onClick={() => toggle(key)}
                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left text-sm transition hover:bg-muted/50"
                  >
                    {checked ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                    ) : (
                      <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
                    )}
                    <span className={cn("min-w-0", checked && "text-muted-foreground line-through")}>{it}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
