// Shared city coordinates and lookup helpers for itinerary map rendering.

export const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  Istanbul: { lat: 41.0082, lng: 28.9784 },
  Edirne: { lat: 41.6771, lng: 26.5557 },
  Sofia: { lat: 42.6977, lng: 23.3219 },
  Belgrade: { lat: 44.7866, lng: 20.4489 },
  Budapest: { lat: 47.4979, lng: 19.0402 },
  Zagreb: { lat: 45.815, lng: 15.9819 },
  "Lake Garda": { lat: 45.6, lng: 10.65 },
  Verona: { lat: 45.4384, lng: 10.9916 },
  Milan: { lat: 45.4642, lng: 9.19 },
  Riccione: { lat: 43.9989, lng: 12.6557 },
  Rome: { lat: 41.9028, lng: 12.4964 },
  Pescara: { lat: 42.4584, lng: 14.2081 },
  Bari: { lat: 41.1171, lng: 16.8719 },
  Igoumenitsa: { lat: 39.5036, lng: 20.265 },
  Athens: { lat: 37.9838, lng: 23.7275 },
  Alexandroupoli: { lat: 40.8458, lng: 25.8736 },
  Thessaloniki: { lat: 40.6401, lng: 22.9444 },
  Berlin: { lat: 52.52, lng: 13.405 },
  Patras: { lat: 38.2466, lng: 21.7346 },
};

export function pickCoord(label: string): { lat: number; lng: number } | null {
  if (!label) return null;
  for (const key of Object.keys(CITY_COORDS)) {
    if (label.toLowerCase().includes(key.toLowerCase())) return CITY_COORDS[key];
  }
  return null;
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nearest known city to a GPS fix; returns { name, distanceKm } or null. */
export function nearestCity(
  fix: { lat: number; lng: number },
  maxKm = 250,
): { name: string; distanceKm: number; coord: { lat: number; lng: number } } | null {
  let best: { name: string; distanceKm: number; coord: { lat: number; lng: number } } | null = null;
  for (const [name, coord] of Object.entries(CITY_COORDS)) {
    const km = haversineKm(fix, coord);
    if (!best || km < best.distanceKm) best = { name, distanceKm: km, coord };
  }
  if (!best || best.distanceKm > maxKm) return null;
  return best;
}
