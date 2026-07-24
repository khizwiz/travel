import { createFileRoute, Link } from "@tanstack/react-router";
import { LocateFixed, LocateOff, Navigation } from "lucide-react";
import { ITINERARY, getTripProgress } from "@/lib/trip-data";
import { RouteMap, type PhotoMarker } from "@/components/RouteMap";
import { useAdminAuth } from "@/lib/admin-auth";
import { pickCoord, nearestCity } from "@/lib/geo";
import { useApp } from "@/lib/app-state";
import { useCan } from "@/lib/use-role";
import { useLocation } from "@/hooks/use-location";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPublicDestinationPhotos } from "@/lib/photos.functions";
import { clearRecentLocationPoints, getDefaultTrip } from "@/lib/tracking.functions";
import { getRouteTrail } from "@/lib/location.functions";

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "Where we are — Tripping" },
      { name: "description", content: "The trail so far and current location for the Tripping journey." },
      { property: "og:title", content: "Follow the Tripping route" },
      {
        property: "og:description",
        content: "Approximate location and the trail covered so far.",
      },
    ],
  }),
  component: TrackingPage,
});

function TrackingPage() {
  const { isAdmin } = useAdminAuth();
  const { liveFix } = useApp();
  const location = useLocation();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  // GPS-aware progress (nearest destination within 150 km wins over calendar).
  const liveForProgress = liveFix ? { lat: liveFix.lat, lng: liveFix.lng } : null;
  const progress = useMemo(
    () => getTripProgress(new Date(), liveForProgress),
    [liveForProgress?.lat, liveForProgress?.lng],
  );

  // Build ordered waypoints from itinerary (de-duplicated, preserving order).
  const allWaypoints: { lat: number; lng: number; label: string; dayIdx: number }[] = [];
  const seen = new Set<string>();
  ITINERARY.forEach((d, i) => {
    for (const label of [d.from, d.to]) {
      if (!label) continue;
      const c = pickCoord(label);
      if (!c) continue;
      const key = `${c.lat.toFixed(2)},${c.lng.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allWaypoints.push({ ...c, label, dayIdx: i });
    }
  });

  // Public map: only show the trail already covered — never future destinations.
  // Admin sees the whole planned route for reference.
  const coveredWaypoints =
    progress.phase === "before"
      ? []
      : allWaypoints.filter((w) => w.dayIdx <= progress.index);

  const shownWaypoints = isAdmin ? allWaypoints : coveredWaypoints;
  const coveredIndex = coveredWaypoints.length;

  // Show the newest known position for EVERYONE — passengers and viewers get
  // the polled DB fix even with their own geolocation off.
  const live = liveFix ? { lat: liveFix.lat, lng: liveFix.lng } : null;
  const near = live ? nearestCity(live) : null;

  const fetchTrip = useServerFn(getDefaultTrip);
  const doClearPoints = useServerFn(clearRecentLocationPoints);

  // Story photos with GPS: shown as round thumbnails where they were taken.
  const fetchPhotos = useServerFn(listPublicDestinationPhotos);
  const { data: storyPhotos } = useQuery({
    queryKey: ["public-story-photos"],
    queryFn: () => fetchPhotos(),
    staleTime: 60_000,
  });
  const photoMarkers: PhotoMarker[] = (storyPhotos ?? [])
    .filter((p: any) => p.lat != null && p.lng != null && p.signedUrl)
    .map((p: any) => ({
      lat: p.lat,
      lng: p.lng,
      thumbUrl: p.signedUrl,
      label: p.caption ?? p.itinerary_days?.title ?? undefined,
    }));

  // The route actually driven, from the recorded GPS trail and snapped to
  // roads. This replaces drawing straight lines between itinerary cities —
  // those ignored every detour and cut across terrain nobody drove over.
  const fetchTrail = useServerFn(getRouteTrail);
  const canSeePreciseTrail = useCan("location.viewPrecise");
  const { data: trailData } = useQuery({
    queryKey: ["route-trail"],
    queryFn: () => fetchTrail({ data: {} }),
    enabled: canSeePreciseTrail,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
  const trail = trailData?.path;

  const points = [
    ...shownWaypoints.map(({ lat, lng, label }) => ({ lat, lng, label })),
    ...(live ? [{ ...live, label: "Current position", accent: true as const }] : []),
  ];

  return (
    <div className="space-y-5">
      <header>
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Where we are
        </div>
        <h1 className="mt-1 font-display text-3xl">Route map</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {progress.phase === "before"
            ? `Trip begins in ${progress.daysUntilStart} day${progress.daysUntilStart === 1 ? "" : "s"}. The trail will start showing on day one.`
            : progress.phase === "after"
              ? "Trip complete — the full trail is on the map."
              : `${coveredIndex} stop${coveredIndex === 1 ? "" : "s"} behind us so far.`}
        </p>
      </header>

      <div className="card-elev hero-gradient p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Navigation className="h-4 w-4 text-primary" />
            {/* Was "Near <city> · <straight-line> km" — a number measured to a
                hardcoded city centre across whatever terrain lay between. The
                km shown now is the road actually driven. */}
            {live
              ? near
                ? `Near ${near.name}`
                : "Live position"
              : "Location off"}
            {trailData?.drivenKm ? (
              <span className="text-foreground">· {Math.round(trailData.drivenKm)} km driven</span>
            ) : null}
          </div>
          {hydrated && isAdmin && location.status !== "unsupported" && (
            <div className="flex items-center gap-2">
              {location.status === "live" || location.status === "locating" ? (
                <button
                  onClick={location.disable}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  <LocateOff className="h-3.5 w-3.5" /> Stop tracking
                </button>
              ) : (
                <button
                  onClick={location.enable}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
                >
                  <LocateFixed className="h-3.5 w-3.5" /> Start tracking
                </button>
              )}
              <button
                onClick={async () => {
                  if (!confirm("Delete the last 24 h of recorded positions? Use this to remove wrong fixes — the next real GPS fix repopulates the map.")) return;
                  try {
                    const trip = await fetchTrip();
                    if (!trip?.id) throw new Error("Trip not found");
                    const res = await doClearPoints({ data: { tripId: trip.id, hours: 24 } });
                    alert(`Removed ${res.deleted} recorded position${res.deleted === 1 ? "" : "s"}.`);
                  } catch (e: any) {
                    alert(e?.message ?? "Failed to clear positions");
                  }
                }}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                Clear bad fixes
              </button>
            </div>
          )}
        </div>
        <div className="mt-4">
          {points.length === 0 ? (
            <div className="grid h-[380px] place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
              The trail will appear here once the trip is underway.
            </div>
          ) : (
            <RouteMap
              points={points}
              height={380}
              coveredIndex={isAdmin ? coveredIndex : shownWaypoints.length}
              focusCovered={progress.phase === "active" && coveredIndex > 0}
              photos={photoMarkers}
              trail={trail}
            />
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="card-elev p-4">
          <Link to="/settings" className="text-sm font-medium text-primary">
            Open tracking console →
          </Link>
        </div>
      )}
    </div>
  );
}
