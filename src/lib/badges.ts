import { ITINERARY, getTripProgress } from "@/lib/trip-data";

export interface BadgeDef {
  id: string;
  name: string;
  desc: string;
  /** City the badge unlocks after (matches ITINERARY `to`). */
  after: string;
}

export const BADGES: BadgeDef[] = [
  { id: "kapikule", name: "Kapıkule Crossing", desc: "First border behind you.", after: "Sofia" },
  { id: "two-capitals", name: "Two Capitals in a Day", desc: "Sofia to Belgrade complete.", after: "Belgrade" },
  { id: "berlin-bound", name: "Berlin Bound", desc: "Rome → Berlin flight cleared.", after: "Berlin" },
  { id: "first-jump", name: "First AFF Jump", desc: "Completed an AFF skydive.", after: "Berlin" },
  { id: "ferry-night", name: "Adriatic Night", desc: "Bari → Patras crossing.", after: "Patras" },
  { id: "home-run", name: "Home Run", desc: "Back in Istanbul.", after: "Istanbul" },
];

export interface EarnedBadge extends BadgeDef {
  earned: boolean;
  earnedISO?: string;
  isToday?: boolean;
}

/** Live-calendar aware: a badge is earned once the trip has passed the `after` city. */
export function computeEarnedBadges(
  liveFix?: { lat: number; lng: number } | null,
): EarnedBadge[] {
  // When a live GPS fix is present, getTripProgress advances the current-day
  // index to the itinerary day whose destination is nearest — so badges
  // auto-unlock as the car reaches each city.
  const progress = getTripProgress(new Date(), liveFix ?? null);
  const liveIdx = progress.index;
  const todayISO = progress.todayISO;
  return BADGES.map((b) => {
    const unlockIdx = ITINERARY.findIndex((d) => d.to === b.after);
    if (unlockIdx < 0) return { ...b, earned: false };
    const earned = liveIdx >= unlockIdx;
    const earnedISO = earned ? ITINERARY[unlockIdx].date : undefined;
    return {
      ...b,
      earned,
      earnedISO,
      isToday: earned && earnedISO === todayISO,
    };
  });
}
