import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Bed, CheckCircle2, Circle, MapPin, Plane, Ship, TramFront, Wand2 } from "lucide-react";
import { useApp } from "@/lib/app-state";
import { formatDate, formatDuration, getTripProgress, ITINERARY, type ItineraryDay } from "@/lib/trip-data";
import { pickCityImage } from "@/lib/city-images";
import { useAdminAuth } from "@/lib/admin-auth";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPublicAccommodations } from "@/lib/planning.functions";
import { CitySuggestions } from "@/components/CitySuggestions";
import { RePlanSheet } from "@/components/RePlanSheet";
import { usePlanOverrides } from "@/hooks/use-plan-overrides";


export const Route = createFileRoute("/itinerary")({
  head: () => ({
    meta: [
      { title: "Itinerary — Tripping" },
      { name: "description", content: "Day-by-day route across Europe and back." },
      { property: "og:title", content: "Tripping itinerary" },
      {
        property: "og:description",
        content: "Cities, ferries and driving days from Istanbul across Europe.",
      },
    ],
  }),
  component: ItineraryPage,
});

type Day = (typeof ITINERARY)[number];

interface Stay {
  city: string;
  days: Day[];
  startIdx: number;
  endIdx: number;
  totalKm: number;
  totalMin: number;
  transports: Set<string>;
  hasFerry: boolean;
  hasFlight: boolean;
  isOpen: boolean;
}

function groupStays(days: Day[]): Stay[] {
  const stays: Stay[] = [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const city = d.kind === "open" ? `__open_${d.id}` : d.to;
    const last = stays[stays.length - 1];
    if (last && last.city === city) {
      last.days.push(d);
      last.endIdx = i;
      last.totalKm += d.distanceKm ?? 0;
      last.totalMin += d.durationMin ?? 0;
      last.transports.add(d.transport);
      if (d.ferry) last.hasFerry = true;
      if (d.flight) last.hasFlight = true;
    } else {
      stays.push({
        city,
        days: [d],
        startIdx: i,
        endIdx: i,
        totalKm: d.distanceKm ?? 0,
        totalMin: d.durationMin ?? 0,
        transports: new Set([d.transport]),
        hasFerry: !!d.ferry,
        hasFlight: !!d.flight,
        isOpen: d.kind === "open",
      });
    }
  }
  return stays;
}

function TransportIcon({ kind, className }: { kind: string; className?: string }) {
  const cls = cn("h-3.5 w-3.5", className);
  if (kind === "flight") return <Plane className={cls} />;
  if (kind === "ferry") return <Ship className={cls} />;
  if (kind === "mixed") return <Ship className={cls} />;
  if (kind === "rest") return <Bed className={cls} />;
  return <TramFront className={cls} />;
}

function ItineraryPage() {
  const { activeDayId } = useApp();
  const { isAdmin, role } = useAdminAuth();
  const progress = useMemo(() => getTripProgress(), []);
  const liveIdx = progress.index;
  const { map: overridesByDate } = usePlanOverrides();
  const effectiveDays = useMemo<ItineraryDay[]>(() => {
    if (overridesByDate.size === 0) return ITINERARY;
    return ITINERARY.map((d) => {
      const o = overridesByDate.get(d.date);
      if (!o) return d;
      return {
        ...d,
        from: o.from ?? d.from,
        to: o.to ?? d.to,
        transport: (o.transport as any) ?? d.transport,
        distanceKm: o.distance_km ?? d.distanceKm,
        durationMin: o.duration_min ?? d.durationMin,
        kind: (o.day_kind as any) ?? d.kind,
        notes: o.summary ?? d.notes,
      };
    });
  }, [overridesByDate]);
  const stays = useMemo(() => groupStays(effectiveDays), [effectiveDays]);


  const fetchAccoms = useServerFn(listPublicAccommodations);
  const { data: savedAccoms } = useQuery({
    queryKey: ["public-accommodations"],
    queryFn: () => fetchAccoms(),
    staleTime: 30_000,
  });
  const savedByDate = useMemo(() => {
    const m = new Map<string, any>();
    for (const a of savedAccoms ?? []) if (a.day_date) m.set(a.day_date, a);
    return m;
  }, [savedAccoms]);

  // Auto-collapse past stays; allow user to expand.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setExpanded((p) => ({ ...p, [key]: !p[key] }));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Route
          </div>
          <h1 className="mt-1 font-display text-3xl">Itinerary</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ITINERARY.length} days · {stays.length} stops · {ITINERARY[0].from} → {ITINERARY[ITINERARY.length - 1].to}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip">Jul–Aug 2026</span>
          {role === "owner" && (
            <Link
              to="/planning"
              className="chip inline-flex items-center gap-1 border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
            >
              <Wand2 className="h-3 w-3" /> Edit itinerary
            </Link>
          )}
        </div>
      </header>

      <ol className="relative space-y-3 pl-8">
        {/* The road: vertical line with a gradient of covered vs remaining */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-3 top-2 bottom-2 w-[3px] rounded-full"
          style={{
            background:
              liveIdx < 0
                ? "var(--border)"
                : `linear-gradient(to bottom, var(--color-success) 0%, var(--color-success) ${Math.min(100, ((liveIdx + 1) / ITINERARY.length) * 100)}%, var(--border) ${Math.min(100, ((liveIdx + 1) / ITINERARY.length) * 100)}%)`,
          }}
        />

        {stays.map((stay, si) => {
          const isPast = liveIdx >= 0 && stay.endIdx < liveIdx;
          const isLive = liveIdx >= 0 && stay.startIdx <= liveIdx && liveIdx <= stay.endIdx;
          const isActive = stay.days.some((d) => d.id === activeDayId);
          const nights = stay.days.length;
          const first = stay.days[0];
          const last = stay.days[stay.days.length - 1];
          const collapsedByDefault = isPast && !isLive;
          const isOpen = expanded[stay.city] ?? !collapsedByDefault;
          const headline = stay.isOpen ? "Open day" : last.to;

          return (
            <li key={stay.city + si} className="relative">
              {/* Pin on the road */}
              <span
                className={cn(
                  "absolute -left-[1.85rem] top-4 grid h-6 w-6 place-items-center rounded-full border-2 bg-background shadow-sm",
                  isLive && "border-success text-success",
                  isPast && "border-success/70 text-success/70",
                  !isLive && !isPast && "border-border text-muted-foreground",
                )}
                aria-hidden
              >
                {isLive ? (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
                  </span>
                ) : isPast ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Circle className="h-2.5 w-2.5 fill-current" />
                )}
              </span>

              {/* Transport chip floats on the road between stays */}
              {si < stays.length - 1 && (
                <span
                  aria-hidden
                  className="absolute -left-[1.6rem] -bottom-3 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm"
                >
                  <TransportIcon kind={[...stay.transports].pop() ?? "drive"} />
                </span>
              )}

              <div
                className={cn(
                  "card-elev transition",
                  collapsedByDefault && !isOpen ? "p-3" : "p-4",
                  isLive && "border-success/50 ring-2 ring-success/30",
                  isActive && !isLive && "ring-2 ring-primary/30",
                  collapsedByDefault && !isOpen && "opacity-70",
                  stay.isOpen && "border-dashed bg-muted/20",
                )}
              >
                {/* Header row — always visible */}
                <button
                  type="button"
                  onClick={() => toggle(stay.city)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {!stay.isOpen && (() => {
                      const thumb = pickCityImage(headline, first.from);
                      return thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          className={cn(
                            "h-12 w-12 shrink-0 rounded-full border border-border object-cover",
                            isPast && "grayscale opacity-70",
                            isLive && "ring-2 ring-success/60",
                          )}
                        />
                      ) : (
                        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-border bg-muted">
                          <MapPin className="h-5 w-5 text-muted-foreground" />
                        </div>
                      );
                    })()}
                    <div className="min-w-0 font-display text-base sm:text-lg">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn(stay.isOpen ? "text-muted-foreground" : "font-semibold")}>
                          {headline}
                        </span>
                      </span>
                      {!stay.isOpen && nights > 1 && (
                        <span className="ml-2 text-xs text-muted-foreground">· {nights} nights</span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(first.date)}
                    {nights > 1 && ` — ${formatDate(last.date)}`}
                  </div>
                </button>

                {/* Quick chips */}
                {!stay.isOpen && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    {[...stay.transports].map((t) => (
                      <span key={t} className="chip inline-flex items-center gap-1">
                        <TransportIcon kind={t} className="h-3 w-3" /> {labelTransport(t)}
                      </span>
                    ))}
                    {stay.totalKm > 0 && <span className="chip">{Math.round(stay.totalKm)} km</span>}
                    {stay.totalMin > 0 && (
                      <span className="chip">{formatDuration(stay.totalMin)}</span>
                    )}
                    {isLive && (
                      <span className="chip border-success/50 bg-success/10 text-success">
                        You are here
                      </span>
                    )}
                  </div>
                )}

                {/* Expanded per-day detail */}
                {isOpen && stay.days.length > 0 && (
                  <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-3 text-sm">
                    {stay.days.map((d, di) => {
                      const dIdx = stay.startIdx + di;
                      const dPast = liveIdx >= 0 && dIdx < liveIdx;
                      const dLive = liveIdx >= 0 && dIdx === liveIdx;
                      const savedAcc = isAdmin ? savedByDate.get(d.date) : null;
                      const hasOverride = overridesByDate.has(d.date);
                      const original = ITINERARY.find((x) => x.date === d.date);
                      return (
                        <li
                          key={d.id}
                          className={cn(
                            "flex flex-wrap items-baseline justify-between gap-2 rounded-md px-1.5 py-1",
                            dLive && "bg-success/10",
                            dPast && "text-muted-foreground",
                          )}
                        >
                          <div className="inline-flex items-baseline gap-2">
                            <TransportIcon kind={d.transport} className="translate-y-[2px]" />
                            <span className="font-medium">{d.from}</span>
                            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{d.to}</span>
                            {hasOverride && (
                              <span className="chip border-primary/40 bg-primary/10 text-[10px] text-primary">
                                <Wand2 className="h-2.5 w-2.5" /> Re-routed
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatDate(d.date)}
                            {d.distanceKm != null && ` · ${d.distanceKm} km`}
                            {d.durationMin != null && ` · ${formatDuration(d.durationMin)}`}
                          </div>
                          {hasOverride && original && (original.to !== d.to || original.from !== d.from) && (
                            <div className="w-full pl-6 text-[11px] text-muted-foreground">
                              was: {original.from} → {original.to}
                            </div>
                          )}
                          {isAdmin && !dPast && (
                            <div className="w-full pl-6">
                              <RePlanSheet
                                dayDate={d.date}
                                currentFrom={d.from}
                                originalTo={original?.to ?? null}
                                hasOverride={hasOverride}
                                compact
                              />
                            </div>
                          )}

                          {d.ferry && (
                            <div className="w-full pl-6 text-xs text-muted-foreground">
                              Ferry {d.ferry.from} → {d.ferry.to}
                            </div>
                          )}
                          {d.flight && (
                            <div className="w-full pl-6 text-xs text-muted-foreground">
                              Flight {d.flight.from} → {d.flight.to}
                            </div>
                          )}
                          {savedAcc && (
                            <div className="w-full pl-6 text-xs">
                              <span className="inline-flex items-center gap-1 text-foreground">
                                <Bed className="h-3 w-3 text-muted-foreground" />
                                <span className="font-medium">{savedAcc.name}</span>
                              </span>
                              {savedAcc.area_public && (
                                <span className="text-muted-foreground"> · {savedAcc.area_public}</span>
                              )}
                              {(savedAcc.check_in || savedAcc.check_out) && (
                                <span className="text-muted-foreground">
                                  {" · "}
                                  {savedAcc.check_in ?? "?"} → {savedAcc.check_out ?? "?"}
                                </span>
                              )}
                              {savedAcc.booking_ref && (
                                <span className="text-muted-foreground"> · Ref {savedAcc.booking_ref}</span>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {isOpen && !stay.isOpen && (
                  <CitySuggestions city={stay.city} />
                )}
              </div>
            </li>
          );
        })}
      </ol>

    </div>
  );
}

function labelTransport(t: string) {
  return t === "drive"
    ? "Driving"
    : t === "flight"
      ? "Flight"
      : t === "ferry"
        ? "Ferry"
        : t === "mixed"
          ? "Drive + Ferry"
          : t === "rest"
            ? "Rest"
            : t;
}
