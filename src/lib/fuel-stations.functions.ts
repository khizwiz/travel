import { createServerFn } from "@tanstack/react-start";
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

/** Public: nearest fuel stations for the low-fuel prompt (25% threshold). */
export const getFuelStationsNearby = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data }): Promise<{ stations: FuelStation[] }> => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY_1;
    if (!lovableKey || !mapsKey) return { stations: [] };

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
        body: JSON.stringify({
          includedTypes: ["gas_station"],
          maxResultCount: 8,
          rankPreference: "DISTANCE",
          locationRestriction: {
            circle: {
              center: { latitude: data.lat, longitude: data.lng },
              radius: data.radiusMeters ?? 10000,
            },
          },
        }),
      });
      if (!res.ok) {
        console.error("[fuel-stations]", res.status, await res.text().catch(() => ""));
        return { stations: [] };
      }
      const json = (await res.json()) as {
        places?: Array<{
          id: string;
          displayName?: { text?: string };
          formattedAddress?: string;
          rating?: number;
          googleMapsUri?: string;
          location?: { latitude: number; longitude: number };
          primaryType?: string;
        }>;
      };
      const stations: FuelStation[] = (json.places ?? []).map((p) => {
        const dist = p.location
          ? haversineMeters(data.lat, data.lng, p.location.latitude, p.location.longitude)
          : undefined;
        return {
          id: p.id,
          name: p.displayName?.text ?? "Fuel station",
          address: p.formattedAddress,
          rating: p.rating,
          mapsUri: p.googleMapsUri,
          location: p.location,
          primaryType: p.primaryType,
          distanceMeters: dist,
        };
      });
      return { stations };
    } catch (e) {
      console.error("[fuel-stations] error", e);
      return { stations: [] };
    }
  });

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
