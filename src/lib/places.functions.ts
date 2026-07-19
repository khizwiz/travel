import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";
const WIKI_UA = { "User-Agent": "khizapp-travel/1.0 (family road-trip app)" };

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
 * Public read: top attractions & things to do near a city.
 * Provider chain:
 *   1. Google Places via the Lovable connector gateway (Lovable cloud only)
 *   2. Google Places API (New) directly, if GOOGLE_MAPS_API_KEY_1 is set
 *   3. Wikipedia geosearch — keyless, works everywhere (default)
 */
export const getCitySuggestions = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data }): Promise<{ places: PlaceSuggestion[] }> => {
    const viaGateway = await tryLovableGateway(data.city, data.country);
    if (viaGateway && viaGateway.length > 0) return { places: viaGateway };

    const viaGoogle = await tryGoogleDirect(data.city, data.country);
    if (viaGoogle && viaGoogle.length > 0) return { places: viaGoogle };

    const viaWiki = await tryWikipedia(data.city, data.country);
    return { places: viaWiki ?? [] };
  });

function googleTextBody(city: string, country?: string): string {
  const query = country ? `top attractions in ${city}, ${country}` : `top attractions in ${city}`;
  return JSON.stringify({ textQuery: query, pageSize: 10, rankPreference: "RELEVANCE" });
}

const GOOGLE_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.types,places.primaryType,places.googleMapsUri,places.location,places.photos.name";

function mapGooglePlaces(json: any): PlaceSuggestion[] {
  return ((json?.places ?? []) as any[]).map((p) => ({
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
}

async function tryLovableGateway(city: string, country?: string): Promise<PlaceSuggestion[] | null> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY_1;
  if (!lovableKey || !mapsKey) return null;
  try {
    const res = await fetch(`${GATEWAY_URL}/places/v1/places:searchText`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": mapsKey,
        "Content-Type": "application/json",
        "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
      },
      body: googleTextBody(city, country),
    });
    if (!res.ok) {
      console.error(`[places] gateway ${res.status}: ${await res.text().catch(() => "")}`);
      return null;
    }
    return mapGooglePlaces(await res.json());
  } catch (e) {
    console.error("[places] gateway failed", e);
    return null;
  }
}

async function tryGoogleDirect(city: string, country?: string): Promise<PlaceSuggestion[] | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY_1;
  if (!key) return null;
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": key,
        "Content-Type": "application/json",
        "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
      },
      body: googleTextBody(city, country),
    });
    if (!res.ok) {
      console.error(`[places] google ${res.status}: ${await res.text().catch(() => "")}`);
      return null;
    }
    return mapGooglePlaces(await res.json());
  } catch (e) {
    console.error("[places] google failed", e);
    return null;
  }
}

// Keyless fallback: find the city page's coordinates on Wikipedia, then list
// notable geo-tagged articles around the centre — museums, landmarks,
// churches, viewpoints. No ratings, but real sights with real names.
async function tryWikipedia(city: string, country?: string): Promise<PlaceSuggestion[] | null> {
  try {
    const q = encodeURIComponent(country ? `${city}, ${country}` : city);
    const cityRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${q}&gsrlimit=1&prop=coordinates&colimit=1`,
      { headers: WIKI_UA },
    );
    if (!cityRes.ok) return null;
    const cityJson: any = await cityRes.json();
    const cityPage: any = Object.values(cityJson?.query?.pages ?? {})[0];
    const coord = cityPage?.coordinates?.[0];
    if (!coord) return null;

    const geoRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=geosearch` +
        `&ggscoord=${coord.lat}%7C${coord.lon}&ggsradius=10000&ggslimit=25` +
        `&prop=description%7Ccoordinates&colimit=25`,
      { headers: WIKI_UA },
    );
    if (!geoRes.ok) return null;
    const geoJson: any = await geoRes.json();
    const pages: any[] = Object.values(geoJson?.query?.pages ?? {});
    const cityTitle = String(cityPage?.title ?? city).toLowerCase();
    const skip = /(district|municipality|province|county|railway station|airport|university|hospital|football|stadium of|neighborhood|suburb)/i;
    const places: PlaceSuggestion[] = pages
      .filter((p) => {
        const t = String(p.title ?? "").toLowerCase();
        if (!p.title || t === cityTitle || t === city.toLowerCase()) return false;
        const desc = String(p.description ?? "");
        if (skip.test(desc) || skip.test(t)) return false;
        return true;
      })
      .slice(0, 10)
      .map((p) => {
        const c = p.coordinates?.[0];
        return {
          id: String(p.pageid),
          name: p.title,
          address: p.description ?? undefined,
          mapsUri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.title} ${city}`)}`,
          location: c ? { latitude: c.lat, longitude: c.lon } : undefined,
        };
      });
    return places;
  } catch (e) {
    console.error("[places] wikipedia failed", e);
    return null;
  }
}
