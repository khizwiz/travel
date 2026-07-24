import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fuel, MapPin, ExternalLink, Loader2, GaugeCircle, RotateCcw, Route } from "lucide-react";
import { getFuelStationsNearby } from "@/lib/fuel-stations.functions";
import { getFuelStatus, recordFuelFill, undoLastFill } from "@/lib/fuel.functions";
import { VEHICLE } from "@/lib/trip-data";
import { useCan } from "@/lib/use-role";

interface Props {
  live: { lat: number; lng: number } | null;
  cityLabel?: string;
}

/**
 * Fuel gauge, station search and fill logging. Members only, whole card.
 *
 * This card is mounted on both / and /vehicle, which is why gating it on one
 * screen never fixed the leak. The gate lives here now, so every mount point
 * inherits it, and the three server functions it calls each enforce the same
 * capability independently.
 */
export function FuelPromptCard({ live, cityLabel }: Props) {
  const canViewFuel = useCan("fuel.viewStatus");
  const canRecordFill = useCan("fuel.recordFill");
  const canSearchStations = useCan("fuel.searchStations");
  const qc = useQueryClient();
  const [manualOpen, setManualOpen] = useState(false);
  const [radiusKm, setRadiusKm] = useState(10);
  const [fillOpen, setFillOpen] = useState(false);
  const [litresInput, setLitresInput] = useState("");
  const [busy, setBusy] = useState(false);

  const statusFn = useServerFn(getFuelStatus);
  const fillFn = useServerFn(recordFuelFill);
  const undoFn = useServerFn(undoLastFill);

  // Fuel status is computed on the server from the whole GPS trail — shared
  // across every device, detours included.
  const { data: fuel } = useQuery({
    queryKey: ["fuel-status"],
    queryFn: () => statusFn({ data: {} }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    enabled: canViewFuel,
  });

  const pct = fuel?.tankPct ?? null;
  const low = pct !== null && pct <= VEHICLE.lowFuelWarnPct;
  const shouldSearch = canSearchStations && ((low && !!live) || manualOpen) && !!live;

  const stationsFn = useServerFn(getFuelStationsNearby);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["fuel-stations", live?.lat, live?.lng, radiusKm, shouldSearch],
    queryFn: () => stationsFn({ data: { lat: live!.lat, lng: live!.lng, radiusMeters: radiusKm * 1000 } }),
    enabled: shouldSearch,
    staleTime: 60_000,
  });
  const stations = data?.stations ?? [];

  const filledLabel = useMemo(() => {
    if (!fuel?.lastFillTs) return null;
    return new Date(fuel.lastFillTs).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }, [fuel?.lastFillTs]);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["fuel-status"] });
  }

  async function confirmTankFull() {
    const manual = parseFloat(litresInput.replace(",", "."));
    const litres = Number.isFinite(manual) && manual > 0 ? Math.min(manual, 500) : null;
    setBusy(true);
    try {
      await fillFn({ data: { litres } });
      await refresh();
      setFillOpen(false);
      setLitresInput("");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    setBusy(true);
    try {
      await undoFn({ data: {} });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const consumptionNote = fuel
    ? fuel.measured
      ? `measured ${fuel.learnedLPer100} L/100 km`
      : `assuming ${fuel.learnedLPer100} L/100 km`
    : "";

  // Logged-out visitors get no fuel card at all — not an empty shell.
  if (!canViewFuel) return null;

  return (
    <section className="card-elev p-4">
      <div className="flex items-center gap-2">
        <Fuel className={`h-5 w-5 ${low ? "text-warning" : "text-primary"}`} />
        <h2 className="text-sm font-semibold">Fuel</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {VEHICLE.make} {VEHICLE.model} · {VEHICLE.fuel} · {VEHICLE.tankLitres} L tank
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <GaugeCircle className={`h-8 w-8 ${low ? "text-warning" : "text-muted-foreground"}`} />
        <div className="flex-1">
          <div className={`font-mono text-xl ${low ? "text-warning" : ""}`}>
            {pct !== null ? `${pct}%` : "—"}
          </div>
          <div className="text-xs text-muted-foreground">
            {fuel?.hasData
              ? `${fuel.sinceKm} km since ${filledLabel ? `refuel ${filledLabel}` : "trip start"} · ${consumptionNote}`
              : canRecordFill
                ? "No GPS distance yet — keep the tracker phone logged in with location on."
                : "Fuel tracking follows the live GPS route."}
          </div>
        </div>
      </div>

      {/* Trip totals — all derived from the actual driven route. */}
      {fuel?.hasData && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Route className="h-3 w-3" /> Driven
            </div>
            <div className="font-mono text-sm">{fuel.totalKm} km</div>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-muted-foreground">Est. used</div>
            <div className="font-mono text-sm">{fuel.totalEstUsedL} L</div>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-muted-foreground">
              Tanked{fuel.fills > 0 ? ` · ${fuel.fills}×` : ""}
            </div>
            <div className="font-mono text-sm">{fuel.totalTankedL} L</div>
          </div>
        </div>
      )}

      {canRecordFill && !fillOpen && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFillOpen(true)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Fuel className="h-4 w-4" /> Tank full
          </button>
          {fuel && fuel.fills > 0 && (
            <button
              onClick={undo}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Undo last
            </button>
          )}
          {fuel?.hasData && (
            <span className="text-xs text-muted-foreground">
              Est. ~{Math.round(fuel.estSinceL)} L used of {VEHICLE.tankLitres} L since last fill
            </span>
          )}
        </div>
      )}

      {canRecordFill && fillOpen && (
        <div className="mt-3 rounded-lg border border-border p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            How many litres went in? (optional)
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={500}
              step="0.1"
              value={litresInput}
              onChange={(e) => setLitresInput(e.target.value)}
              placeholder={fuel && fuel.estSinceL > 0 ? `~${fuel.estSinceL.toFixed(0)} (estimate)` : "litres"}
              className="input w-32"
              autoFocus
            />
            <button
              onClick={confirmTankFull}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fuel className="h-4 w-4" />} Save fill
            </button>
            <button
              onClick={() => { setFillOpen(false); setLitresInput(""); }}
              className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Entering the real litres teaches the app your true L/100 km, so future
            estimates get sharper. Leave empty to just reset the gauge to 100%.
          </p>
        </div>
      )}

      {low ? (
        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Below {VEHICLE.lowFuelWarnPct}% — searching for stations near you…
        </div>
      ) : (
        pct !== null && (
          <div className="mt-3 text-xs text-muted-foreground">
            We'll pop up the nearest fuel stations automatically at {VEHICLE.lowFuelWarnPct}%.
          </div>
        )
      )}

      {live && !low && (
        <button
          onClick={() => setManualOpen((o) => !o)}
          className="mt-3 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium"
        >
          {manualOpen ? "Hide nearby stations" : "Find nearby fuel stations"}
        </button>
      )}

      {shouldSearch && (
        <div className="mt-3 space-y-2">
          <label className="block rounded-lg border border-border px-3 py-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Search radius</span>
              <span className="font-mono">{radiusKm} km</span>
            </div>
            <input
              type="range"
              min={1}
              max={50}
              step={1}
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              className="mt-1 w-full accent-[var(--ink)]"
            />
          </label>
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching stations near {cityLabel ?? "you"}…
            </div>
          )}
          {isError && (
            <div className="text-xs text-destructive">Couldn't reach the map provider just now.</div>
          )}
          {!isLoading && stations.length === 0 && (
            <div className="text-xs text-muted-foreground">No stations found within {radiusKm} km.</div>
          )}
          {stations.map((s) => (
            <a
              key={s.id}
              href={s.mapsUri ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-3 rounded-lg border border-border p-2.5 hover:bg-muted/40"
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.name}</div>
                <div className="truncate text-xs text-muted-foreground">{s.address}</div>
              </div>
              <div className="text-right text-xs">
                {s.distanceMeters != null && (
                  <div className="font-mono">
                    {s.distanceMeters < 1000
                      ? `${s.distanceMeters} m`
                      : `${(s.distanceMeters / 1000).toFixed(1)} km`}
                  </div>
                )}
                <ExternalLink className="ml-auto mt-1 h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
