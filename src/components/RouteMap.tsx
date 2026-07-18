import { useEffect, useRef, useState } from "react";

interface Point {
  lat: number;
  lng: number;
  label?: string;
  accent?: boolean; // render as glowing live-position marker
}

interface RouteMapProps {
  points: Point[];
  height?: number;
  /** Optional override of initial zoom when only one point is supplied. */
  singleZoom?: number;
  /** Number of leading points considered "covered". Polyline up to this index renders solid; the rest dashed. */
  coveredIndex?: number;
  /** If true, auto-fit to live + covered points only, leaving the remaining route visible but off-center. */
  focusCovered?: boolean;
}


declare global {
  interface Window {
    google?: any;
    __initEUTrippingMap?: () => void;
    __euTrippingMapReady?: boolean;
  }
}

const CUSTOM_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const MANAGED_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as
  | string
  | undefined;
const TRACKING_ID = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as
  | string
  | undefined;

// The custom (Khizar's) key is referrer-restricted to trip.azatfilms.com.
// The managed Lovable key is restricted to *.lovable.app and *.lovableproject.com.
// Pick whichever one matches the current hostname so previews and prod both work.
function pickBrowserKey(): string | undefined {
  if (typeof window === "undefined") return CUSTOM_KEY ?? MANAGED_KEY;
  const host = window.location.hostname;
  const isLovableHost =
    host.endsWith(".lovable.app") ||
    host.endsWith(".lovableproject.com") ||
    host.endsWith(".lovable.dev") ||
    host === "localhost";
  if (isLovableHost && MANAGED_KEY) return MANAGED_KEY;
  return CUSTOM_KEY ?? MANAGED_KEY;
}
const BROWSER_KEY = pickBrowserKey();

function loadMapsScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!BROWSER_KEY) {
      reject(new Error("Map key unavailable"));
      return;
    }
    if (window.__euTrippingMapReady && window.google?.maps) {
      resolve();
      return;
    }
    const existing = document.getElementById("eu-tripping-maps-js");
    if (existing) {
      const check = setInterval(() => {
        if (window.__euTrippingMapReady && window.google?.maps) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      return;
    }
    window.__initEUTrippingMap = () => {
      window.__euTrippingMapReady = true;
    };
    const s = document.createElement("script");
    s.id = "eu-tripping-maps-js";
    s.async = true;
    const channel = TRACKING_ID ? `&channel=${TRACKING_ID}` : "";
    s.src = `https://maps.googleapis.com/maps/api/js?key=${BROWSER_KEY}&loading=async&callback=__initEUTrippingMap${channel}`;
    s.onerror = () => reject(new Error("Map script failed to load"));
    document.head.appendChild(s);
    const check = setInterval(() => {
      if (window.__euTrippingMapReady && window.google?.maps) {
        clearInterval(check);
        resolve();
      }
    }, 100);
    setTimeout(() => {
      clearInterval(check);
      if (!window.__euTrippingMapReady) reject(new Error("Map load timeout"));
    }, 15000);
  });
}

export function RouteMap({
  points,
  height = 224,
  singleZoom = 9,
  coveredIndex,
  focusCovered = false,
}: RouteMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!BROWSER_KEY) {
      setError("Map provider not configured.");
      return;
    }
    if (points.length === 0) return;
    let cancelled = false;
    loadMapsScript()
      .then(() => {
        if (cancelled || !ref.current || !window.google?.maps) return;
        const g = window.google.maps;
        const routePoints = points.filter((p) => !p.accent);
        const accentPoints = points.filter((p) => p.accent);
        const bounds = new g.LatLngBounds();
        points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
        const map = new g.Map(ref.current, {
          center: bounds.getCenter(),
          zoom: singleZoom,
          disableDefaultUI: true,
          zoomControl: true,
          styles: [
            { elementType: "geometry", stylers: [{ color: "#1d2027" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#1d2027" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#9aa4b2" }] },
            { featureType: "water", stylers: [{ color: "#0e1116" }] },
            { featureType: "road", stylers: [{ color: "#2a2f38" }] },
            { featureType: "poi", stylers: [{ visibility: "off" }] },
          ],
        });
        const covered = typeof coveredIndex === "number"
          ? Math.max(0, Math.min(routePoints.length, coveredIndex))
          : routePoints.length;
        routePoints.forEach((p, i) => {
          const isCovered = i < covered;
          new g.Marker({
            position: { lat: p.lat, lng: p.lng },
            map,
            title: p.label ?? `Point ${i + 1}`,
            label: {
              text: String(i + 1),
              color: "#fff",
              fontSize: "11px",
            },
            icon: {
              path: g.SymbolPath.CIRCLE,
              scale: 11,
              fillColor: isCovered ? "#22c55e" : "#7aa2f7",
              fillOpacity: isCovered ? 0.95 : 0.45,
              strokeColor: "#ffffff",
              strokeWeight: 1.5,
            },
          });
        });
        accentPoints.forEach((p) => {
          new g.Marker({
            position: { lat: p.lat, lng: p.lng },
            map,
            title: p.label ?? "Live",
            icon: {
              path: g.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: "#22c55e",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            },
            zIndex: 999,
          });
          new g.Circle({
            map,
            center: { lat: p.lat, lng: p.lng },
            radius: 800,
            strokeColor: "#22c55e",
            strokeOpacity: 0.5,
            strokeWeight: 1,
            fillColor: "#22c55e",
            fillOpacity: 0.12,
          });
        });
        if (routePoints.length > 1) {
          const path = routePoints.map((p) => ({ lat: p.lat, lng: p.lng }));
          if (covered > 1) {
            new g.Polyline({
              path: path.slice(0, covered),
              map,
              strokeColor: "#22c55e",
              strokeOpacity: 0.95,
              strokeWeight: 4,
            });
          }
          if (covered < path.length) {
            const startIdx = Math.max(0, covered - 1);
            new g.Polyline({
              path: path.slice(startIdx),
              map,
              strokeColor: "#7aa2f7",
              strokeOpacity: 0.6,
              strokeWeight: 3,
              icons: [
                {
                  icon: { path: "M 0,-1 0,1", strokeOpacity: 0.9, scale: 3 },
                  offset: "0",
                  repeat: "12px",
                },
              ],
            });
          }
        }
        if (focusCovered) {
          const focusBounds = new g.LatLngBounds();
          routePoints.slice(0, Math.max(1, covered)).forEach((p) =>
            focusBounds.extend({ lat: p.lat, lng: p.lng }),
          );
          accentPoints.forEach((p) => focusBounds.extend({ lat: p.lat, lng: p.lng }));
          if (!focusBounds.isEmpty()) map.fitBounds(focusBounds, 60);
        } else if (points.length > 1) {
          map.fitBounds(bounds, 40);
        }

      })
      .catch((e) => setError(e?.message ?? "Map failed to load"));
    return () => {
      cancelled = true;
    };
  }, [points, singleZoom]);

  if (error) {
    return (
      <div
        className="grid place-items-center overflow-hidden rounded-xl border border-border bg-background/50 text-sm text-muted-foreground"
        style={{ height }}
      >
        {error}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-xl border border-border bg-background/50"
      style={{ height }}
      aria-label="Route map"
    />
  );
}
