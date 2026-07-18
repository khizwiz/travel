import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Sparkles, Star } from "lucide-react";
import { getCitySuggestions } from "@/lib/places.functions";

interface Props {
  city: string;
  country?: string;
  limit?: number;
}

/** Public-safe: Google Places top attractions for a city. */
export function CitySuggestions({ city, country, limit = 5 }: Props) {
  const fetchSuggestions = useServerFn(getCitySuggestions);
  const q = useQuery({
    queryKey: ["place-suggestions", city, country ?? ""],
    queryFn: () => fetchSuggestions({ data: { city, country } }),
    staleTime: 1000 * 60 * 60 * 24,
    enabled: !!city && !city.startsWith("__open_"),
  });

  if (!city || city.startsWith("__open_")) return null;

  const places = (q.data?.places ?? []).slice(0, limit);

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        Suggestions in {city}
      </div>
      {q.isLoading && (
        <p className="mt-2 text-xs text-muted-foreground">Loading suggestions…</p>
      )}
      {!q.isLoading && places.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">No suggestions available yet.</p>
      )}
      <ul className="mt-2 space-y-1.5">
        {places.map((p) => (
          <li key={p.id} className="flex items-start justify-between gap-2 text-sm">
            <div className="min-w-0">
              <a
                href={p.mapsUri ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium hover:underline"
              >
                <span className="truncate">{p.name}</span>
                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
              </a>
              {p.address && (
                <div className="truncate text-xs text-muted-foreground">{p.address}</div>
              )}
            </div>
            {p.rating != null && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-background px-2 py-0.5 text-[11px] font-medium">
                <Star className="h-3 w-3 fill-warning text-warning" />
                {p.rating.toFixed(1)}
                {p.userRatingCount ? (
                  <span className="text-muted-foreground"> ({p.userRatingCount})</span>
                ) : null}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
