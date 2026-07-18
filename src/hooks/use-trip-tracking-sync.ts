import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useApp } from "@/lib/app-state";
import { useAdminAuth } from "@/lib/admin-auth";
import { useLiveGeolocation } from "@/hooks/use-live-geolocation";
import { getDefaultTrip, recordLocationPoint, getPublicLatestLocation } from "@/lib/tracking.functions";

const PUBLIC_POLL_MS = 5 * 60 * 1000;

/**
 * App-wide tracking sync:
 * - Admin (signed in): auto-opts into geolocation and pushes every fix to the DB.
 * - Everyone else: polls the public (coarse) latest location every few minutes
 *   and mirrors it into AppState.liveFix so the map/home chip stay live.
 */
export function useTripTrackingSync() {
  const { isAdmin, role } = useAdminAuth();
  const { liveFix, setLiveFix, geoOptIn, setGeoOptIn } = useApp();
  const geo = useLiveGeolocation();
  const getTrip = useServerFn(getDefaultTrip);
  const recordFn = useServerFn(recordLocationPoint);
  const publicFn = useServerFn(getPublicLatestLocation);
  const tripIdRef = useRef<string | null>(null);
  const lastSentRef = useRef<number>(0);

  // Load default trip id once (owner is the tracker).
  useEffect(() => {
    let alive = true;
    getTrip()
      .then((t) => {
        if (alive && t?.id) tripIdRef.current = t.id;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [getTrip]);

  // Owner: auto-enable browser geolocation opt-in.
  useEffect(() => {
    if (isAdmin && role === "owner" && !geoOptIn) {
      setGeoOptIn(true);
    }
  }, [isAdmin, role, geoOptIn, setGeoOptIn]);

  // Owner: persist each new fix to the DB (min 60s between writes).
  useEffect(() => {
    if (!isAdmin || role !== "owner") return;
    if (!liveFix || !tripIdRef.current) return;
    const now = Date.now();
    if (now - lastSentRef.current < 60_000) return;
    lastSentRef.current = now;
    recordFn({
      data: {
        tripId: tripIdRef.current,
        lat: liveFix.lat,
        lng: liveFix.lng,
        ts: new Date(liveFix.ts).toISOString(),
      },
    }).catch(() => {});
  }, [isAdmin, role, liveFix, recordFn]);

  // Non-admins: poll the public coarse location so map/home reflect the trip.
  useEffect(() => {
    if (isAdmin) return;
    let alive = true;
    const tick = () =>
      publicFn()
        .then((row) => {
          if (!alive || !row) return;
          setLiveFix({ lat: row.lat, lng: row.lng, ts: new Date(row.ts).getTime() });
        })
        .catch(() => {});
    tick();
    const id = window.setInterval(tick, PUBLIC_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [isAdmin, publicFn, setLiveFix]);

  return geo;
}
