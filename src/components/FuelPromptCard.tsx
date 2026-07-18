import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fuel, MapPin, ExternalLink, Loader2, GaugeCircle } from "lucide-react";
import { getFuelStationsNearby } from "@/lib/fuel-stations.functions";
import { VEHICLE } from "@/lib/trip-data";
import { useAdminAuth } from "@/lib/admin-auth";
import { useApp } from "@/lib/app-state";
import { haversineKm } from "@/lib/geo";

interface Props {
  live: { lat: number; lng: number } | null;
  cityLabel?: string;
}

interface FuelState {
  fullTs: number;
  kmSinceFill: number;
  lastLat?: number;
  lastLng?: number;
  lastTs?: number;
  // Trip totals (v2)
  totalTankedL: number;   // actual litres, from manual entries (or estimate when skipped)
  totalEstUsedL: number;  // estimated litres burned, accumulated at each fill
  fills: number;
}

const CONSUMPTION_L_PER_100 = 9;
const STORAGE_KEY = "tripping.fuel.state.v1";
// Ignore GPS jitter under this (km) or unrealistic teleports over this (km per gap).
const MIN_STEP_KM = 0.05;
const MAX_STEP_KM = 40;

function loadState(): FuelState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FuelState>;
    // v1 -> v2 migration: totals default to zero.
    return {
      fullTs: parsed.fullTs ?? Date.now(),
      kmSinceFill: parsed.kmSinceFill ?? 0,
      lastLat: parsed.lastLat,
      lastLng: parsed.lastLng,
      lastTs: parsed.lastTs,
      totalTankedL: parsed.totalTankedL ?? 0,
      totalEstUsedL: parsed.totalEstUsedL ?? 0,
      fills: parsed.fills ?? 0,
    };
  } catch {
    return null;
  }
}

function saveState(s: FuelState | null) {
  if (typeof window === "undefined") return;
  try {
    if (s) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function estUsedLitres(state: FuelState | null): number {
  if (!state) return 0;
  return Math.min(VEHICLE.tankLitres, (state.kmSinceFill * CONSUMPTION_L_PER_100) / 100);
}

function percentLeft(state: FuelState | null): number | null {
  if (!state) return null;
  const pct = 100 - (estUsedLitres(state) / VEHICLE.tankLitres) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function FuelPromptCard({ live, cityLabel }: Props) {
  const { isAdmin } = useAdminAuth();
  const { liveFix } = useApp();
  const [state, setState] = useState<FuelState | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [radiusKm, setRadiusKm] = useState(10);
  const [fillOpen, setFillOpen] = useState(false);
  const [litresInput, setLitresInput] = useState("");
  const lastAppliedTs = useRef<number>(0);

  useEffect(() => {
    setState(loadState());
  }, []);

  // Automatic distance accumulation from GPS fixes.
  useEffect(() => {
    if (!liveFix || !state) return;
    // Skip re-applying the same fix.
    if (liveFix.ts === lastAppliedTs.current) return;
    lastAppliedTs.current = liveFix.ts;

    if (state.lastLat == null || state.lastLng == null) {
      const seed = { ...state, lastLat: liveFix.lat, lastLng: liveFix.lng, lastTs: liveFix.ts };
      setState(seed);
      saveState(seed);
      return;
    }
    const stepKm = haversineKm(
      { lat: state.lastLat, lng: state.lastLng },
      { lat: liveFix.lat, lng: liveFix.lng },
    );
    if (stepKm < MIN_STEP_KM || stepKm > MAX_STEP_KM) {
      // Update last fix but don't add jitter/teleports to the odometer.
      const next = { ...state, lastLat: liveFix.lat, lastLng: liveFix.lng, lastTs: liveFix.ts };
      setState(next);
      saveState(next);
      return;
    }
    const next: FuelState = {
      ...state,
      kmSinceFill: state.kmSinceFill + stepKm,
      lastLat: liveFix.lat,
      lastLng: liveFix.lng,
      lastTs: liveFix.ts,
    };
    setState(next);
    saveState(next);
  }, [liveFix, state]);

  const pct = percentLeft(state);
  const low = pct !== null && pct <= VEHICLE.lowFuelWarnPct;
  const shouldSearch = ((low && !!live) || manualOpen) && !!live;

  const fn = useServerFn(getFuelStationsNearby);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["fuel-stations", live?.lat, live?.lng, radiusKm, shouldSearch],
    queryFn: () => fn({ data: { lat: live!.lat, lng: live!.lng, radiusMeters: radiusKm * 1000 } }),
    enabled: shouldSearch,
    staleTime: 60_000,
  });
  const stations = data?.stations ?? [];

  const filledLabel = useMemo(() => {
    if (!state) return null;
    const d = new Date(state.fullTs);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }, [state]);

  // Tank full: accumulate totals, then reset the since-fill odometer.
  // `litres` = what actually went in (manual); falls back to the estimate.
  function confirmTankFull() {
    const est = estUsedLitres(state);
    const manual = parseFloat(litresInput.replace(",", "."));
    const tanked = Number.isFinite(manual) && manual > 0 ? Math.min(manual, 200) : est;
    const next: FuelState = {
      fullTs: Date.now(),
      kmSinceFill: 0,
      lastLat: liveFix?.lat,
      lastLng: liveFix?.lng,
      lastTs: liveFix?.ts,
      totalTankedL: (state?.totalTankedL ?? 0) + tanked,
      totalEstUsedL: (state?.totalEstUsedL ?? 0) + est,
      fills: (state?.fills ?? 0) + 1,
    };
    setState(next);
    saveState(next);
    setFillOpen(false);
    setLitresInput("");
  }

  const kmDisplay = state ? state.kmSinceFill.toFixed(1) : "0.0";
  const sinceFillEst = estUsedLitres(state);
  const totalEst = (state?.totalEstUsedL ?? 0) + sinceFillEst;

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
            {state
              ? `Tank filled ${filledLabel} · ${kmDisplay} km driven · auto-tracked from GPS`
              : isAdmin
                ? "Press Tank full after refuelling — the app then tracks km automatically from GPS."
                : "Fuel tracking is set by the driver."}
          </div>
        </div>
      </div>

      {/* Trip totals: estimate vs what actually went in the tank. */}
      {state && (state.fills > 0 || sinceFillEst > 0) && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-muted-foreground">Estimated used</div>
            <div className="font-mono text-sm">{totalEst.toFixed(1)} L</div>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-muted-foreground">Actually tanked{state.fills > 0 ? ` · ${state.fills} fill${state.fills > 1 ? "s" : ""}` : ""}</div>
            <div className="font-mono text-sm">{state.totalTankedL.toFixed(1)} L</div>
          </div>
        </div>
      )}

      {isAdmin && !fillOpen && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFillOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            <Fuel className="h-4 w-4" /> Tank full
          </button>
          {state && (
            <span className="text-xs text-muted-foreground">
              Est. ~{Math.round(sinceFillEst)} L used of {VEHICLE.tankLitres} L since last fill
            </span>
          )}
        </div>
      )}

      {isAdmin && fillOpen && (
        <div className="mt-3 rounded-lg border border-border p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            How many litres went in? (optional)
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={200}
              step="0.1"
              value={litresInput}
              onChange={(e) => setLitresInput(e.target.value)}
              placeholder={sinceFillEst > 0 ? `~${sinceFillEst.toFixed(0)} (estimate)` : "litres"}
              className="input w-32"
              autoFocus
            />
            <button
              onClick={confirmTankFull}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <Fuel className="h-4 w-4" /> Save fill
            </button>
            <button
              onClick={() => { setFillOpen(false); setLitresInput(""); }}
              className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Leave empty to record the estimate ({sinceFillEst.toFixed(1)} L). The gauge resets to 100% either way.
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
