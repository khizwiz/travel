import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

const input = z.object({
  city: z.string().trim().min(1).max(120),
  country: z.string().trim().max(120).optional(),
});

export interface PlaceSuggestion {
  id: string;
  name: string;
  address?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  primaryType?: string;
  mapsUri?: string;
  photoName?: string;
  location?: { latitude: number; longitude: number };
}

/**
 * Public read: top tourist attractions & things to do near a city.
 * Uses Google Places API (New) text search via the Lovable connector gateway.
 * Safe for public routes — returns only public POI metadata (no PII).
 */
export const getCitySuggestions = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data }): Promise<{ places: PlaceSuggestion[] }> => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY_1;
    if (!lovableKey || !mapsKey) {
      return { places: [] };
    }
    const query = data.country
      ? `top attractions in ${data.city}, ${data.country}`
      : `top attractions in ${data.city}`;

    try {
      const res = await fetch(`${GATEWAY_URL}/places/v1/places:searchText`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": mapsKey,
          "Content-Type": "application/json",
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.types,places.primaryType,places.googleMapsUri,places.location,places.photos.name",
        },
        body: JSON.stringify({
          textQuery: query,
          pageSize: 10,
          rankPreference: "RELEVANCE",
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[places] gateway ${res.status}: ${body}`);
        return { places: [] };
      }
      const json = (await res.json()) as {
        places?: Array<{
          id: string;
          displayName?: { text?: string };
          formattedAddress?: string;
          rating?: number;
          userRatingCount?: number;
          types?: string[];
          primaryType?: string;
          googleMapsUri?: string;
          location?: { latitude: number; longitude: number };
          photos?: Array<{ name: string }>;
        }>;
      };
      const places: PlaceSuggestion[] = (json.places ?? []).map((p) => ({
        id: p.id,
        name: p.displayName?.text ?? "Untitled",
        address: p.formattedAddress,
        rating: p.rating,
        userRatingCount: p.userRatingCount,
        types: p.types,
        primaryType: p.primaryType,
        mapsUri: p.googleMapsUri,
        location: p.location,
        photoName: p.photos?.[0]?.name,
      }));
      return { places };
    } catch (e) {
      console.error("[places] failed", e);
      return { places: [] };
    }
  });
