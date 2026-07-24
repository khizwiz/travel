import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useApp } from "@/lib/app-state";
import { useAdminAuth } from "@/lib/admin-auth";
import { useLocation } from "@/hooks/use-location";
import { getDefaultTrip, recordLocationPoint, getLatestLocation, getPublicLatestLocation } from "@/lib/tracking.functions";

const PUBLIC_POLL_MS = 5 * 60 * 1000;
const ADMIN_POLL_MS = 2 * 60 * 1000;
// Only record REAL GPS: unknown accuracy or worse than this is never written.
// (A laptop on a mobile hotspot resolves to the carrier's city-centre address —
// that once put the truck in downtown Belgrade.)
const MAX_RECORD_ACCURACY_M = 150;

/**
 * App-wide tracking sync:
 * - Admin (signed in): auto-opts into geolocation and pushes every fix to the DB.
 * - Everyone else: polls the public (coarse) latest location every few minutes
 *   and mirrors it into AppState.liveFix so the map/home chip stay live.
 */
export function useTripTrackingSync() {
  const { isAdmin, role } = useAdminAuth();
  const { liveFix, setLiveFix, geoOptIn, setGeoOptIn } = useApp();
  const geo = useLocation();
  const getTrip = useServerFn(getDefaultTrip);
  const recordFn = useServerFn(recordLocationPoint);
  const latestFn = useServerFn(getLatestLocation);
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

  // NOTE: tracking is no longer auto-enabled for admins. Every admin device
  // (including desktops with WiFi/IP-guessed positions) used to opt in
  // silently and pollute the trail. The driver enables tracking once on the
  // phone via the Map page; the choice persists.

  // Owner: persist each new fix to the DB (min 60s between writes).
  // Skip low-accuracy fixes (desktop WiFi/IP guesses) so a PC logged in as
  // owner can't pollute the truck's trail — only real GPS gets recorded.
  useEffect(() => {
    if (!isAdmin || role !== "owner") return;
    if (!liveFix || !tripIdRef.current) return;
    // Unknown accuracy = untrusted; only clean GPS fixes enter the trail.
    if (liveFix.accuracyM == null || liveFix.accuracyM > MAX_RECORD_ACCURACY_M) return;
    const now = Date.now();
    if (now - lastSentRef.current < 60_000) return;
    lastSentRef.current = now;
    recordFn({
      data: {
        tripId: tripIdRef.current,
        lat: liveFix.lat,
        lng: liveFix.lng,
        accuracyM: liveFix.accuracyM,
        ts: new Date(liveFix.ts).toISOString(),
      },
    }).catch(() => {});
  }, [isAdmin, role, liveFix, recordFn]);

  // EVERYONE polls the latest stored fix, so any device (including a PC
  // logged in as admin) shows where the truck actually is. Admins read the
  // precise authenticated feed; the public gets the coarse one. A polled fix
  // only replaces the local one when it's newer — a phone with live GPS in
  // hand keeps its own fresher position.
  const liveFixTsRef = useRef<number>(0);
  liveFixTsRef.current = liveFix?.ts ?? 0;
  useEffect(() => {
    let alive = true;
    const tick = () => {
      const apply = (row: { lat: number; lng: number; ts: string } | null | undefined) => {
        if (!alive || !row) return;
        const ts = new Date(row.ts).getTime();
        if (ts <= liveFixTsRef.current) return;
        setLiveFix({ lat: row.lat, lng: row.lng, ts });
      };
      if (isAdmin && tripIdRef.current) {
        latestFn({ data: { tripId: tripIdRef.current } }).then(apply).catch(() => {});
      } else {
        publicFn().then(apply).catch(() => {});
      }
    };
    tick();
    const id = window.setInterval(tick, isAdmin ? ADMIN_POLL_MS : PUBLIC_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [isAdmin, latestFn, publicFn, setLiveFix]);

  return geo;
}
