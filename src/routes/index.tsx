import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, MapPin, ArrowRight, LocateFixed, LocateOff, Rss, Award, Sparkles } from "lucide-react";
import { ITINERARY, getTripProgress, formatDateLong } from "@/lib/trip-data";
import { pickCityImage, HERO_CITIES } from "@/lib/city-images";
import { pickCoord, nearestCity, CITY_COORDS } from "@/lib/geo";
import { RouteMap } from "@/components/RouteMap";
import { HomeBadges } from "@/components/HomeBadges";
import { WeatherChip } from "@/components/WeatherChip";
import { HomeBanner } from "@/components/HomeBanner";
import { FuelPromptCard } from "@/components/FuelPromptCard";
import { DailyPlanPrompt } from "@/components/DailyPlanPrompt";
import { NearbyAiCard } from "@/components/NearbyAiCard";

import { useApp } from "@/lib/app-state";
import { useCan } from "@/lib/use-role";
import { useLiveGeolocation } from "@/hooks/use-live-geolocation";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tripping — Istanbul and back across Europe" },
      {
        name: "description",
        content: "Follow the 2026 road trip live — city-level GPS, covered route, photo feed and playful badges.",
      },
      { property: "og:title", content: "Tripping — Istanbul and back across Europe" },
      { property: "og:description", content: "Follow the 2026 road trip live." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const { liveFix } = useApp();
  const canAsk = useCan("ask.use");
  const geo = useLiveGeolocation();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const live = liveFix ? { lat: liveFix.lat, lng: liveFix.lng } : null;
  const progress = useMemo(() => getTripProgress(new Date(), live), [live?.lat, live?.lng]);
  const start = ITINERARY[0]?.date;
  const end = ITINERARY[ITINERARY.length - 1]?.date;

  const nearest = live ? nearestCity(live) : null;
  const todayDay = progress.todayDay ?? (progress.index >= 0 ? ITINERARY[progress.index] : null);
  const currentCityName = nearest?.name ?? todayDay?.to ?? todayDay?.from ?? ITINERARY[0].from;
  const currentCoord = (nearest?.coord ?? null) || pickCoord(currentCityName) || CITY_COORDS["Istanbul"];

  const nextDay =
    progress.phase === "before"
      ? ITINERARY[0]
      : progress.index >= 0 && progress.index < ITINERARY.length - 1
        ? ITINERARY[progress.index + 1]
        : null;

  const mapPoints = [
    { ...currentCoord, label: currentCityName },
    ...(live ? [{ ...live, label: "You are here", accent: true as const }] : []),
  ];

  const currentImage = pickCityImage(currentCityName) ?? HERO_CITIES[0].src;

  return (
    <div className="space-y-6">
      <HomeBanner />
      <DailyPlanPrompt />

      {/* Hero */}
      <section className="relative overflow-hidden rounded-[34px] border border-white/60 shadow-[0_22px_70px_-24px_rgba(16,32,51,0.35)]">
        <img
          src={currentImage}
          alt={currentCityName}
          width={1600}
          height={900}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[oklch(0.24_0.04_260/0.85)] via-[oklch(0.24_0.04_260/0.35)] to-transparent" />
        <div className="relative z-10 grid gap-6 px-6 py-10 text-[var(--cream)] sm:px-10 sm:py-14 md:grid-cols-[1fr_360px]">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-[oklch(0.92_0.08_78)]">
              Live road trip journal
            </div>
            <h1 className="mt-3 font-display text-4xl leading-[0.95] sm:text-6xl">
              {progress.phase === "before"
                ? `${progress.daysUntilStart} day${progress.daysUntilStart === 1 ? "" : "s"} to Istanbul`
                : progress.phase === "after"
                  ? "The trip is complete."
                  : currentCityName}
              {progress.phase === "active" && todayDay?.from && todayDay.to && todayDay.from !== todayDay.to && (
                <span className="mt-2 block text-xl font-normal opacity-80 sm:text-2xl">
                  {todayDay.from} → {todayDay.to}
                </span>
              )}
            </h1>
            <p className="mt-4 max-w-lg text-sm opacity-90 sm:text-base">
              {progress.phase === "before"
                ? `Trip begins in ${progress.daysUntilStart} day${progress.daysUntilStart === 1 ? "" : "s"}.`
                : progress.phase === "after"
                  ? "The full loop is complete."
                  : `${formatDateLong(progress.todayISO)} · day ${progress.index + 1} of ${ITINERARY.length}`}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                to="/itinerary"
                className="inline-flex items-center gap-2 rounded-full bg-[var(--cream)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:opacity-90"
              >
                See the route <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/map"
                className="inline-flex items-center gap-2 rounded-full border border-white/40 px-5 py-2.5 text-sm font-semibold transition hover:bg-white/10"
              >
                <MapPin className="h-4 w-4" /> Covered route
              </Link>
            </div>
          </div>

          {/* Live card */}
          <aside className="glass rounded-3xl p-4 text-[var(--ink)]">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2.5">
              <div>
                <div className="flex items-center gap-2 font-semibold">
                  <span className="blink-dot" /> Current area
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {live && nearest
                    ? `${nearest.name} area · ${nearest.distanceKm.toFixed(0)} km`
                    : `${currentCityName} area`}
                </div>
              </div>
              <span className="chip chip-green">Live</span>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2.5">
              <div>
                <div className="font-semibold">Weather</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{currentCityName}</div>
              </div>
              <WeatherChip lat={currentCoord.lat} lng={currentCoord.lng} />
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2.5">
              <div>
                <div className="font-semibold">Today</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {todayDay ? `${todayDay.from}${todayDay.to && todayDay.to !== todayDay.from ? ` → ${todayDay.to}` : ""}` : "Rest and explore"}
                </div>
              </div>
              <span className="chip">
                {progress.phase === "before"
                  ? `${progress.daysUntilStart}d to go`
                  : todayDay?.date?.slice(8, 10) ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2.5">
              <div>
                <div className="font-semibold">Covered</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {progress.index > 0
                    ? ITINERARY.slice(0, progress.index + 1).map((d) => d.to || d.from).slice(-3).join(" · ")
                    : "Not started"}
                </div>
              </div>
              <span className="chip chip-blue">Public</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <div className="font-semibold">Next</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{nextDay ? nextDay.to ?? nextDay.from : "—"}</div>
              </div>
              <span className="chip chip-gold">Plan</span>
            </div>
          </aside>
        </div>
      </section>

      {/* Map */}
      <section className="card-elev overflow-hidden p-0">
        <div className="flex items-center justify-between gap-3 px-4 pt-4">
          <div>
            <div className="font-display text-lg">Where the trip is</div>
            <p className="text-xs text-muted-foreground">
              City-level position and completed route only. Full route unlocks with admin.
            </p>
          </div>
          {hydrated && geo.supported && (
            geo.enabled ? (
              <button
                onClick={geo.disable}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                <LocateOff className="h-3.5 w-3.5" /> Stop
              </button>
            ) : (
              <button
                onClick={geo.enable}
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
              >
                <LocateFixed className="h-3.5 w-3.5" /> Use my location
              </button>
            )
          )}
        </div>
        {hydrated && geo.denied && (
          <div className="px-4 pt-2 text-[11px] text-muted-foreground">
            Location blocked. Enable it in your browser settings and try again.
          </div>
        )}
        <div className="mt-3">
          <RouteMap points={mapPoints} height={280} singleZoom={live ? 11 : 6} />
        </div>
      </section>

      {/* Right-now chips */}
      <section>
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-muted-foreground">Right now</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="chip chip-red">
            <span className="blink-dot" style={{ width: 8, height: 8 }} />
            {progress.phase === "before"
              ? `${progress.daysUntilStart} days until Istanbul`
              : `Current · ${currentCityName}`}
          </span>
          {nextDay && (
            <span className="chip">
              <ArrowRight className="h-3 w-3" />
              Next · {nextDay.to ?? nextDay.from}
            </span>
          )}
          {start && end && (
            <span className="chip chip-blue">
              <CalendarDays className="h-3 w-3" />
              {start} → {end}
            </span>
          )}
        </div>
      </section>

      {/* Badges */}
      <HomeBadges />

      {/* Fuel prompt */}
      <FuelPromptCard live={live} cityLabel={currentCityName} />

      {/* AI nearby suggestions */}
      <NearbyAiCard live={live} cityLabel={currentCityName} />

      {/* Deep-link tiles */}
      <section className="grid gap-3 sm:grid-cols-4">
        <Link to="/itinerary" className="card-elev p-5 transition hover:border-primary/40">
          <CalendarDays className="h-5 w-5 text-primary" />
          <div className="mt-2 font-display text-lg">Itinerary</div>
          <p className="mt-1 text-xs text-muted-foreground">Day-by-day route across Europe.</p>
        </Link>
        <Link to="/story" className="card-elev p-5 transition hover:border-primary/40">
          <Rss className="h-5 w-5 text-primary" />
          <div className="mt-2 font-display text-lg">Story</div>
          <p className="mt-1 text-xs text-muted-foreground">Photos and moments from the road.</p>
        </Link>
        <Link to="/achievements" className="card-elev p-5 transition hover:border-primary/40">
          <Award className="h-5 w-5 text-primary" />
          <div className="mt-2 font-display text-lg">Achievements</div>
          <p className="mt-1 text-xs text-muted-foreground">Badges, points and playful rewards.</p>
        </Link>
        {canAsk && (
          <Link to="/ask" className="card-elev p-5 transition hover:border-primary/40">
            <Sparkles className="h-5 w-5 text-primary" />
            <div className="mt-2 font-display text-lg">Ask Tripping</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Travel questions, answered instantly.
            </p>
          </Link>
        )}
      </section>
    </div>
  );
}
