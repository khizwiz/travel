import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useApp } from "@/lib/app-state";
import { useCan } from "@/lib/use-role";
import { reverseGeocode } from "@/lib/location.functions";

/**
 * The single source of truth for "where are we".
 *
 * Everything that needs a position — home, map, nearby suggestions, fuel,
 * achievements — reads this. Before, each screen worked it out for itself, and
 * most of them worked it out from the *itinerary*: the nearest of ~28 hardcoded
 * cities, or simply whichever city today's plan named. That is why the app
 * would insist you were in a city you had left hours earlier.
 *
 * Position comes from the device. The itinerary is a plan, not an observation.
 */

export type LocationStatus =
  | "unsupported" // no geolocation API
  | "prompt" // supported, not yet asked
  | "denied" // user said no
  | "locating" // asked, waiting for the first fix
  | "live" // we have a device fix
  | "shared"; // no device fix; showing the trip's last recorded position

export interface LocationState {
  status: LocationStatus;
  /** Current position, device-first, falling back to the shared trip fix. */
  fix: { lat: number; lng: number; ts: number; accuracyM?: number } | null;
  /** Real place name for `fix`, reverse-geocoded. Null while unknown. */
  placeName: string | null;
  country: string | null;
  /** True when the position came from this device rather than the shared feed. */
  isDeviceFix: boolean;
  enable: () => void;
  disable: () => void;
  refresh: () => void;
}

/**
 * `watchPosition` gives continuous updates while driving, which is what the map
 * and arrival detection need. It is also cheaper than it looks: the platform
 * coalesces updates and only wakes us when the position actually changes,
 * whereas the old 2-minute polling timer woke the GPS on a fixed schedule even
 * while parked.
 */
const WATCH_OPTS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 30_000,
  timeout: 25_000,
};

export function useLocation(): LocationState {
  const { liveFix, setLiveFix, geoOptIn, setGeoOptIn } = useApp();
  const canSeePrecise = useCan("location.viewPrecise");
  const [denied, setDenied] = useState(false);
  const [locating, setLocating] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const deviceFixRef = useRef(false);

  const supported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.geolocation;

  const onFix = useCallback(
    (pos: GeolocationPosition) => {
      setDenied(false);
      setLocating(false);
      deviceFixRef.current = true;
      setLiveFix({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        ts: pos.timestamp || Date.now(),
        accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
      });
    },
    [setLiveFix],
  );

  const onError = useCallback(
    (err: GeolocationPositionError) => {
      setLocating(false);
      if (err.code === err.PERMISSION_DENIED) {
        setDenied(true);
        setGeoOptIn(false);
      }
    },
    [setGeoOptIn],
  );

  // Continuous watch while opted in.
  useEffect(() => {
    if (!supported || !geoOptIn) return;
    setLocating(true);
    const id = navigator.geolocation.watchPosition(onFix, onError, WATCH_OPTS);
    watchIdRef.current = id;
    return () => {
      navigator.geolocation.clearWatch(id);
      watchIdRef.current = null;
    };
  }, [supported, geoOptIn, onFix, onError]);

  // A one-shot read on regaining focus: watchPosition can go quiet while the
  // tab is backgrounded, and coming back to a stale position is exactly the
  // "it thinks I'm still in yesterday's city" complaint.
  useEffect(() => {
    if (!supported || !geoOptIn) return;
    const onVis = () => {
      if (document.visibilityState === "visible") {
        navigator.geolocation.getCurrentPosition(onFix, onError, WATCH_OPTS);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [supported, geoOptIn, onFix, onError]);

  const fix = liveFix ?? null;

  // Name the place. Only for users allowed a precise position — visitors get
  // the coarse shared view and no reverse geocoding.
  const geocodeFn = useServerFn(reverseGeocode);
  const bucketLat = fix ? Math.round(fix.lat * 100) / 100 : null;
  const bucketLng = fix ? Math.round(fix.lng * 100) / 100 : null;
  const { data: place } = useQuery({
    queryKey: ["reverse-geocode", bucketLat, bucketLng],
    queryFn: () => geocodeFn({ data: { lat: fix!.lat, lng: fix!.lng } }),
    enabled: canSeePrecise && bucketLat !== null && bucketLng !== null,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const status: LocationStatus = !supported
    ? "unsupported"
    : denied
      ? "denied"
      : locating && !fix
        ? "locating"
        : fix && deviceFixRef.current
          ? "live"
          : fix
            ? "shared"
            : "prompt";

  return {
    status,
    fix,
    placeName: place?.label ?? null,
    country: place?.country ?? null,
    isDeviceFix: deviceFixRef.current,
    enable: () => {
      setDenied(false);
      setGeoOptIn(true);
    },
    disable: () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      deviceFixRef.current = false;
      setGeoOptIn(false);
      setLiveFix(null);
    },
    refresh: () => {
      if (!supported) return;
      setLocating(true);
      navigator.geolocation.getCurrentPosition(onFix, onError, {
        ...WATCH_OPTS,
        maximumAge: 0,
      });
    },
  };
}
