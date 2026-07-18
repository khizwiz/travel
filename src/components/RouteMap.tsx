import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { useApp } from "@/lib/app-state";

interface Point {
  lat: number;
  lng: number;
  label?: string;
  accent?: boolean; // render as glowing live-position marker
}

export interface PhotoMarker {
  lat: number;
  lng: number;
  thumbUrl: string;
  label?: string;
}

interface RouteMapProps {
  points: Point[];
  height?: number;
  /** Optional override of initial zoom when only one point is supplied. */
  singleZoom?: number;
  /** Leading points considered "covered": solid line up to here, dashed after. */
  coveredIndex?: number;
  /** If true, auto-fit to live + covered points only. */
  focusCovered?: boolean;
  /** Story photos pinned where they were taken (round thumbnails). */
  photos?: PhotoMarker[];
}

// Free, key-less map stack: Leaflet + OpenStreetMap data via CARTO tiles.
// Replaces the Google Maps setup whose browser keys were referrer-locked to
// domains this deployment does not control.
// Tiles follow the app theme: readable light "voyager" by default, dark in dark mode.
const TILE_URL_LIGHT = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_URL_DARK = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

export function RouteMap({
  points,
  height = 224,
  singleZoom = 9,
  coveredIndex,
  focusCovered = false,
  photos = [],
}: RouteMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { theme } = useApp();
  const tileUrl = theme === "dark" ? TILE_URL_DARK : TILE_URL_LIGHT;

  useEffect(() => {
    if (points.length === 0 || !ref.current) return;
    let cancelled = false;
    let map: import("leaflet").Map | undefined;
    (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !ref.current) return;
        map = L.map(ref.current, { zoomControl: true, attributionControl: true });
        L.tileLayer(tileUrl, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

        const routePoints = points.filter((p) => !p.accent);
        const accentPoints = points.filter((p) => p.accent);
        const covered = typeof coveredIndex === "number"
          ? Math.max(0, Math.min(routePoints.length, coveredIndex))
          : routePoints.length;

        routePoints.forEach((p, i) => {
          const isCovered = i < covered;
          const bg = isCovered ? "#22c55e" : "#7aa2f7";
          const opacity = isCovered ? 0.95 : 0.6;
          L.marker([p.lat, p.lng], {
            title: p.label ?? `Point ${i + 1}`,
            icon: L.divIcon({
              className: "",
              iconSize: [22, 22],
              iconAnchor: [11, 11],
              html: `<div style="width:22px;height:22px;border-radius:50%;background:${bg};opacity:${opacity};border:1.5px solid #fff;color:#fff;font-size:11px;line-height:19px;text-align:center;font-weight:600;">${i + 1}</div>`,
            }),
          }).addTo(map!);
        });

        accentPoints.forEach((p) => {
          L.circleMarker([p.lat, p.lng], {
            radius: 8, color: "#ffffff", weight: 2,
            fillColor: "#22c55e", fillOpacity: 1,
          }).addTo(map!).bindTooltip(p.label ?? "Live");
          L.circle([p.lat, p.lng], {
            radius: 800, color: "#22c55e", opacity: 0.5, weight: 1,
            fillColor: "#22c55e", fillOpacity: 0.12,
          }).addTo(map!);
        });

        // Story photo thumbnails pinned where they were taken.
        photos.forEach((ph) => {
          const marker = L.marker([ph.lat, ph.lng], {
            title: ph.label ?? "Photo",
            icon: L.divIcon({
              className: "",
              iconSize: [40, 40],
              iconAnchor: [20, 20],
              html: `<div style="width:40px;height:40px;border-radius:50%;overflow:hidden;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);"><img src="${ph.thumbUrl}" style="width:100%;height:100%;object-fit:cover;" alt=""/></div>`,
            }),
          }).addTo(map!);
          marker.bindPopup(
            `<div style="max-width:220px"><img src="${ph.thumbUrl}" style="width:100%;border-radius:8px" alt=""/>${
              ph.label ? `<div style="margin-top:6px;font-size:12px">${ph.label.replace(/</g, "&lt;")}</div>` : ""
            }</div>`,
          );
        });

        const path = routePoints.map((p) => [p.lat, p.lng] as [number, number]);
        if (path.length > 1) {
          if (covered > 1) {
            L.polyline(path.slice(0, covered), {
              color: "#22c55e", opacity: 0.95, weight: 4,
            }).addTo(map!);
          }
          if (covered < path.length) {
            L.polyline(path.slice(Math.max(0, covered - 1)), {
              color: "#7aa2f7", opacity: 0.6, weight: 3, dashArray: "4 10",
            }).addTo(map!);
          }
        }

        const focusPts = focusCovered
          ? [...routePoints.slice(0, Math.max(covered, 1)), ...accentPoints]
          : points;
        const fitTo = focusPts.length > 0 ? focusPts : points;
        if (fitTo.length === 1) {
          map.setView([fitTo[0].lat, fitTo[0].lng], singleZoom);
        } else {
          map.fitBounds(
            L.latLngBounds(fitTo.map((p) => [p.lat, p.lng] as [number, number])),
            { padding: [24, 24] },
          );
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Map failed to load");
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points), JSON.stringify(photos), coveredIndex, focusCovered, singleZoom, tileUrl]);

  if (error) {
    return (
      <div
        style={{ height }}
        className="grid place-items-center rounded-xl border border-border text-xs text-muted-foreground"
      >
        {error}
      </div>
    );
  }
  return <div ref={ref} style={{ height }} className="w-full overflow-hidden rounded-xl" />;
}
