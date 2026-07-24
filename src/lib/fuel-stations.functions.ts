import { createServerFn } from "@tanstack/react-start";
import { requireCapability } from "@/integrations/supabase/permission-middleware";
import { z } from "zod";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

export interface FuelStation {
  id: string;
  name: string;
  address?: string;
  rating?: number;
  distanceMeters?: number;
  mapsUri?: string;
  location?: { latitude: number; longitude: number };
  primaryType?: string;
}

const input = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusMeters: z.number().min(500).max(50000).optional(),
});

/**
 * Members only: nearest fuel stations (low-fuel prompt + manual search).
 *
 * Was unauthenticated, which is the "non-admins can find fuel stations" bug —
 * hiding the button on one screen never helped, because the endpoint answered
 * anyone who asked and the card is mounted on two routes.
 *
 * Provider chain:
 *   1. Lovable connector gateway (only works inside Lovable cloud)
 *   2. Google Places API (New) if GOOGLE_MAPS_API_KEY_1 is set server-side
 *   3. OpenStreetMap Overpass API — keyless, works everywhere (default)
 */
export const getFuelStationsNearby = createServerFn({ method: "GET" })
  .middleware([requireCapability("fuel.searchStations")])
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data }): Promise<{ stations: FuelStation[] }> => {
    const radius = data.radiusMeters ?? 10000;

    const viaLovable = await tryLovableGateway(data.lat, data.lng, radius);
    if (viaLovable) return { stations: viaLovable };

    const viaGoogle = await tryGooglePlaces(data.lat, data.lng, radius);
    if (viaGoogle) return { stations: viaGoogle };

    const viaOsm = await tryOverpass(data.lat, data.lng, radius);
    return { stations: viaOsm ?? [] };
  });

async function tryLovableGateway(lat: number, lng: number, radius: number): Promise<FuelStation[] | null> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY_1;
  if (!lovableKey || !mapsKey) return null;
  try {
    const res = await fetch(`${GATEWAY_URL}/places/v1/places:searchNearby`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": mapsKey,
        "Content-Type": "application/json",
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.rating,places.googleMapsUri,places.location,places.primaryType",
      },
      body: googleNearbyBody(lat, lng, radius),
    });
    if (!res.ok) {
      console.error("[fuel-stations] lovable gateway", res.status, await res.text().catch(() => ""));
      return null;
    }
    return mapGooglePlaces(await res.json(), lat, lng);
  } catch (e) {
    console.error("[fuel-stations] lovable gateway error", e);
    return null;
  }
}

async function tryGooglePlaces(lat: number, lng: number, radius: number): Promise<FuelStation[] | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY_1;
  if (!key) return null;
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": key,
        "Content-Type": "application/json",
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.rating,places.googleMapsUri,places.location,places.primaryType",
      },
      body: googleNearbyBody(lat, lng, radius),
    });
    if (!res.ok) {
      console.error("[fuel-stations] google places", res.status, await res.text().catch(() => ""));
      return null;
    }
    return mapGooglePlaces(await res.json(), lat, lng);
  } catch (e) {
    console.error("[fuel-stations] google places error", e);
    return null;
  }
}

// Keyless fallback: OpenStreetMap Overpass. Fits the app's key-less Leaflet/OSM setup.
async function tryOverpass(lat: number, lng: number, radius: number): Promise<FuelStation[] | null> {
  const query = `[out:json][timeout:10];(node["amenity"="fuel"](around:${radius},${lat},${lng});way["amenity"="fuel"](around:${radius},${lat},${lng}););out center 30;`;
  try {
    // Overpass rejects UA-less requests with 406 — always send an identifying UA.
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "khizapp-travel/1.0 (family road-trip app)",
        Accept: "application/json",
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) {
      console.error("[fuel-stations] overpass", res.status, await res.text().catch(() => ""));
      return null;
    }
    const json = (await res.json()) as {
      elements?: Array<{
        type: string;
        id: number;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }>;
    };
    const stations: FuelStation[] = (json.elements ?? [])
      .map((el) => {
        const plat = el.lat ?? el.center?.lat;
        const plon = el.lon ?? el.center?.lon;
        if (plat == null || plon == null) return null;
        const t = el.tags ?? {};
        const name = t.name ?? t.brand ?? t.operator ?? "Fuel station";
        const addr = [t["addr:street"], t["addr:housenumber"], t["addr:city"]].filter(Boolean).join(" ");
        return {
          id: `${el.type}/${el.id}`,
          name,
          address: addr || undefined,
          location: { latitude: plat, longitude: plon },
          mapsUri: `https://www.google.com/maps/search/?api=1&query=${plat},${plon}`,
          distanceMeters: haversineMeters(lat, lng, plat, plon),
          primaryType: "gas_station",
        } as FuelStation;
      })
      .filter((s): s is FuelStation => s !== null)
      .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
      .slice(0, 8);
    return stations;
  } catch (e) {
    console.error("[fuel-stations] overpass error", e);
    return null;
  }
}

function googleNearbyBody(lat: number, lng: number, radius: number): string {
  return JSON.stringify({
    includedTypes: ["gas_station"],
    maxResultCount: 8,
    rankPreference: "DISTANCE",
    locationRestriction: {
      circle: { center: { latitude: lat, longitude: lng }, radius },
    },
  });
}

function mapGooglePlaces(
  json: {
    places?: Array<{
      id: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      rating?: number;
      googleMapsUri?: string;
      location?: { latitude: number; longitude: number };
      primaryType?: string;
    }>;
  },
  lat: number,
  lng: number,
): FuelStation[] {
  return (json.places ?? []).map((p) => ({
    id: p.id,
    name: p.displayName?.text ?? "Fuel station",
    address: p.formattedAddress,
    rating: p.rating,
    mapsUri: p.googleMapsUri,
    location: p.location,
    primaryType: p.primaryType,
    distanceMeters: p.location
      ? haversineMeters(lat, lng, p.location.latitude, p.location.longitude)
      : undefined,
  }));
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
