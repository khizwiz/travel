import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Building2,
  Compass,
  GlassWater,
  UtensilsCrossed,
  Baby,
  ArrowRight,
  Sparkles,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { getNearbySuggestions, type NearbyPick } from "@/lib/nearby.functions";
import { useCan } from "@/lib/use-role";

const ICONS: Record<NearbyPick["kind"], any> = {
  brutalist: Building2,
  sight: Compass,
  bar: GlassWater,
  food: UtensilsCrossed,
  kids: Baby,
};

const KIND_LABEL: Record<NearbyPick["kind"], string> = {
  brutalist: "Brutalist",
  sight: "Sight",
  bar: "Bar",
  food: "Food",
  kids: "Kids",
};

interface Props {
  live: { lat: number; lng: number } | null;
  cityLabel?: string;
}

/**
 * AI-generated things to do within ~50 km of the current GPS position:
 * brutalist architecture, bars, sightseeing, and a suggested next overnight.
 * Refreshes every ~30 minutes, or when the position moves meaningfully.
 */
export function NearbyAiCard({ live, cityLabel }: Props) {
  const fn = useServerFn(getNearbySuggestions);
  const allowed = useCan("suggestions.nearbyAi");
  // Bucket coords to ~0.1° (~11 km) so we don't refetch on every micro-move.
  const bucketLat = live ? Math.round(live.lat * 10) / 10 : null;
  const bucketLng = live ? Math.round(live.lng * 10) / 10 : null;

  const { data, isLoading, isFetching, refetch, isError } = useQuery({
    queryKey: ["nearby-ai", bucketLat, bucketLng, cityLabel ?? ""],
    queryFn: () => fn({ data: { lat: live!.lat, lng: live!.lng, cityHint: cityLabel } }),
    // The AI endpoint requires a login — don't fire doomed requests for visitors.
    enabled: !!live && allowed,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Visitors get no card at all. The old "log in to get AI picks" block was the
  // empty "suggestions" section on the home page — an advert for a feature the
  // reader cannot use, which just looked like something broken.
  if (!allowed) return null;

  // Signed in but no fix yet: say what's missing, since this one is actionable.
  if (!live) {
    return (
      <section className="card-elev p-4">
        <header className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold">Nearby — brutalist, bars & sights</h2>
        </header>
        <p className="mt-2 text-xs text-muted-foreground">
          Enable location to get AI picks within 50 km of where the truck is.
        </p>
      </section>
    );
  }

  const picks = (data && "picks" in data ? data.picks : []) ?? [];
  const nextStop = data && "next_stop" in data ? data.next_stop : null;
  const areaLabel = (data && "area" in data ? data.area : "") || cityLabel || "";
  const errorMsg = data && "error" in data ? (data as any).error : null;

  return (
    <section className="card-elev p-4">
      <header className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="text-sm font-semibold">Nearby — brutalist, bars & sights</h2>
        {areaLabel && (
          <span className="ml-2 truncate text-xs text-muted-foreground">· near {areaLabel}</span>
        )}
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
          aria-label="Refresh"
        >
          {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </button>
      </header>

      {isLoading && (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Scouting within 50 km…
        </div>
      )}
      {(isError || errorMsg) && (
        <p className="mt-3 text-xs text-destructive">{errorMsg ?? "Couldn't load suggestions."}</p>
      )}

      {picks.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {picks.map((p, i) => {
            const Icon = ICONS[p.kind] ?? Compass;
            return (
              <li
                key={`${p.name}-${i}`}
                className="rounded-lg border border-border/70 p-2.5"
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {KIND_LABEL[p.kind] ?? p.kind}
                  </span>
                  {Number.isFinite(p.approx_km) && p.approx_km > 0 && (
                    <span className="ml-auto text-[11px] font-mono text-muted-foreground">
                      ~{Math.round(p.approx_km)} km
                    </span>
                  )}
                </div>
                {p.thumb && (
                  <img
                    src={p.thumb}
                    alt={p.name}
                    loading="lazy"
                    className="mt-1.5 h-24 w-full rounded-md border border-border/50 object-cover"
                  />
                )}
                <div className="mt-1 text-sm font-medium leading-tight">{p.name}</div>
                {p.where && <div className="text-[11px] text-muted-foreground">{p.where}</div>}
                {p.why && <p className="mt-1 text-xs text-muted-foreground">{p.why}</p>}
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    `${p.name} ${p.where}`,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  Open in Maps <ArrowRight className="h-3 w-3" />
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {nextStop?.name && (
        <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            Suggested next overnight
          </div>
          <div className="mt-1 text-sm font-medium">{nextStop.name}</div>
          {nextStop.why && <p className="mt-1 text-xs text-muted-foreground">{nextStop.why}</p>}
        </div>
      )}
    </section>
  );
}
