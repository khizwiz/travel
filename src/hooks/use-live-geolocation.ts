import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/app-state";
import { useAdminAuth } from "@/lib/admin-auth";

export interface LiveGeolocation {
  supported: boolean;
  enabled: boolean;
  denied: boolean;
  enable: () => void;
  disable: () => void;
  refresh: () => void;
}

// Update cadence: viewers refresh every 30 minutes (battery-friendly); the
// admin/tracker device samples every 2 minutes with real GPS so km-tracking
// and the shared trail actually work while driving.
const REFRESH_MS = 30 * 60 * 1000;
const TRACKER_REFRESH_MS = 2 * 60 * 1000;

/**
 * Reads the browser's geolocation on a 30-minute cadence (and when the app
 * opens / regains focus) and pushes fixes into AppState.liveFix. We
 * deliberately avoid watchPosition so we don't hammer the battery or leak a
 * continuous location trail.
 */
export function useLiveGeolocation(): LiveGeolocation {
  const { setLiveFix, geoOptIn, setGeoOptIn } = useApp();
  const { isAdmin } = useAdminAuth();
  const [denied, setDenied] = useState(false);
  const supported =
    typeof window !== "undefined" && typeof navigator !== "undefined" && !!navigator.geolocation;

  const fetchOnce = useCallback(() => {
    if (!supported) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDenied(false);
        setLiveFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          ts: pos.timestamp || Date.now(),
          accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setDenied(true);
          setGeoOptIn(false);
        }
      },
      {
        enableHighAccuracy: isAdmin,
        maximumAge: isAdmin ? 60_000 : 5 * 60_000,
        timeout: 20_000,
      },
    );
  }, [supported, setLiveFix, setGeoOptIn, isAdmin]);

  useEffect(() => {
    if (!supported || !geoOptIn) return;
    fetchOnce();
    const interval = window.setInterval(fetchOnce, isAdmin ? TRACKER_REFRESH_MS : REFRESH_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") fetchOnce();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [supported, geoOptIn, fetchOnce]);

  return {
    supported,
    enabled: geoOptIn,
    denied,
    enable: () => {
      setDenied(false);
      setGeoOptIn(true);
    },
    disable: () => {
      setGeoOptIn(false);
      setLiveFix(null);
    },
    refresh: fetchOnce,
  };
}
