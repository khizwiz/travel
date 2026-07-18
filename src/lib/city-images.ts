// Maps cities/regions to bundled hero photographs. Admin can later override per-day
// via the destination_photos table (which signed URLs supersede these defaults).
import istanbul from "@/assets/cities/istanbul.jpg";
import sofia from "@/assets/cities/sofia.jpg";
import belgrade from "@/assets/cities/belgrade.jpg";
import budapest from "@/assets/cities/budapest.jpg";
import berlin from "@/assets/cities/berlin.jpg";
import rome from "@/assets/cities/rome.jpg";
import garda from "@/assets/cities/garda.jpg";
import athens from "@/assets/cities/athens.jpg";

export const CITY_IMAGES: Record<string, string> = {
  Istanbul: istanbul,
  Edirne: istanbul,
  Sofia: sofia,
  Belgrade: belgrade,
  Budapest: budapest,
  Zagreb: budapest,
  Berlin: berlin,
  Rome: rome,
  Riccione: rome,
  "Pescara / Chieti": rome,
  "Bari Ferry Terminal": rome,
  "Lake Garda": garda,
  Verona: garda,
  "Northern Italy": garda,
  "Milan area": garda,
  Athens: athens,
  Patras: athens,
  "Volos or Larissa": athens,
  Alexandroupoli: athens,
};

export function pickCityImage(...labels: (string | undefined)[]): string | null {
  for (const l of labels) {
    if (!l) continue;
    if (CITY_IMAGES[l]) return CITY_IMAGES[l];
    // Fuzzy: try matching the first word/segment.
    const key = Object.keys(CITY_IMAGES).find(
      (k) => l.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(l.toLowerCase()),
    );
    if (key) return CITY_IMAGES[key];
  }
  return null;
}

export const HERO_CITIES: { name: string; src: string; subtitle: string }[] = [
  { name: "Istanbul", src: istanbul, subtitle: "Where the journey begins" },
  { name: "Budapest", src: budapest, subtitle: "Danube blue hour" },
  { name: "Berlin", src: berlin, subtitle: "Avenues at dusk" },
  { name: "Rome", src: rome, subtitle: "Eternal city" },
  { name: "Lake Garda", src: garda, subtitle: "Alpine still water" },
  { name: "Athens", src: athens, subtitle: "Aegean light" },
];
