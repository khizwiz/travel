import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Car, Fuel as FuelIcon, MapPin } from "lucide-react";
import { VEHICLE, ITINERARY, getTripProgress } from "@/lib/trip-data";
import { useApp } from "@/lib/app-state";
import { useLiveGeolocation } from "@/hooks/use-live-geolocation";
import { nearestCity, pickCoord, CITY_COORDS } from "@/lib/geo";
import { RouteMap } from "@/components/RouteMap";
import { FuelPromptCard } from "@/components/FuelPromptCard";

export const Route = createFileRoute("/vehicle")({
  head: () => ({
    meta: [
      { title: "The Vehicle — Tripping" },
      {
        name: "description",
        content: "The truck driving the trip: Mitsubishi L200 diesel, live city-level location and fuel helper.",
      },
      { property: "og:title", content: "The Vehicle — Tripping" },
      { property: "og:description", content: "Live location and fuel helper for the trip car." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: VehiclePage,
});

function VehiclePage() {
  const { liveFix } = useApp();
  useLiveGeolocation();
  const live = liveFix ? { lat: liveFix.lat, lng: liveFix.lng } : null;
  const progress = useMemo(() => getTripProgress(new Date(), live), [live?.lat, live?.lng]);
  const nearest = live ? nearestCity(live) : null;
  const todayDay = progress.todayDay ?? (progress.index >= 0 ? ITINERARY[progress.index] : null);
  const cityLabel = nearest?.name ?? todayDay?.to ?? todayDay?.from ?? ITINERARY[0].from;
  const coord = nearest?.coord ?? pickCoord(cityLabel) ?? CITY_COORDS["Istanbul"];

  const mapPoints = [
    { ...coord, label: cityLabel },
    ...(live ? [{ ...live, label: "The truck", accent: true as const }] : []),
  ];

  return (
    <div className="space-y-5">
      <header className="card-elev overflow-hidden p-0">
        <div className="relative bg-gradient-to-br from-[oklch(0.24_0.04_260)] to-[oklch(0.32_0.06_240)] p-6 text-[var(--cream)]">
          <div className="flex items-center gap-3">
            <Car className="h-6 w-6" />
            <h1 className="font-display text-3xl leading-none">The Vehicle</h1>
          </div>
          <p className="mt-2 max-w-md text-sm opacity-90">
            {VEHICLE.year} {VEHICLE.make} {VEHICLE.model} — {VEHICLE.engine} {VEHICLE.transmission.toLowerCase()}, {VEHICLE.fuel.toLowerCase()}.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <Stat label="Tank" value={`${VEHICLE.tankLitres} L`} />
            <Stat label="Fuel" value={VEHICLE.fuel} />
          </div>
        </div>
      </header>

      <section className="card-elev p-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold">Right now</h2>
          <span className="ml-auto text-xs text-muted-foreground">City-level only</span>
        </div>
        <p className="mt-2 text-sm">
          {live
            ? <>Roughly around <span className="font-semibold">{cityLabel}</span>.</>
            : <>Location off. Turn it on from Home to see the truck live.</>}
        </p>
        <div className="mt-3 overflow-hidden rounded-2xl">
          <RouteMap points={mapPoints} height={280} />
        </div>
      </section>

      <FuelPromptCard live={live} cityLabel={cityLabel} />


      <section className="card-elev p-4">
        <div className="flex items-center gap-2">
          <FuelIcon className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold">Route so far</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {progress.phase === "before"
            ? "The truck sets off from Istanbul in July 2026."
            : progress.phase === "after"
              ? "The truck is home — full loop complete."
              : `Day ${progress.index + 1} of ${ITINERARY.length} · currently on ${todayDay?.from} → ${todayDay?.to}.`}
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/10 px-3 py-2 backdrop-blur">
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}
