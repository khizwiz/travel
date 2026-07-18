import { createFileRoute } from "@tanstack/react-router";
import { Award, Trophy } from "lucide-react";
import { useApp } from "@/lib/app-state";
import { computeEarnedBadges } from "@/lib/badges";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/achievements")({
  head: () => ({ meta: [{ title: "Achievements — Tripping" }] }),
  component: AchievementsPage,
});

function AchievementsPage() {
  const { individualPoints, groupPoints, liveFix } = useApp();

  const badges = computeEarnedBadges(liveFix ? { lat: liveFix.lat, lng: liveFix.lng } : null);
  const earnedCount = badges.filter((b) => b.earned).length;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-3xl">Achievements</h1>
        <p className="text-sm text-muted-foreground">
          Individual and group points earned along the road.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className="card-elev p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Trophy className="h-3.5 w-3.5" /> Individual
          </div>
          <div className="mt-2 font-display text-3xl">{individualPoints}</div>
        </div>
        <div className="card-elev p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Trophy className="h-3.5 w-3.5" /> Group
          </div>
          <div className="mt-2 font-display text-3xl">{groupPoints}</div>
        </div>
      </div>

      <section className="card-elev p-4">
        <h2 className="text-sm font-semibold">How points work</h2>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          <li>• Scoring starts on <strong>17 July 2026 at 05:00 Istanbul time</strong>, when the app opens.</li>
          <li>• <strong>Individual</strong> — earned from your own missions: posting a photo, checking in to a city, completing a side quest.</li>
          <li>• <strong>Group</strong> — earned by the whole trip: border crossings, ferries boarded, new countries unlocked, and the daily surprise badge.</li>
          <li>• Badges appear automatically as milestones unlock — no manual claim needed.</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Badges · {earnedCount}/{badges.length}
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {badges.map((b) => (
            <li
              key={b.id}
              className={cn(
                "card-elev p-3 text-center",
                !b.earned && "opacity-60",
                b.isToday && "border-primary/50 ring-2 ring-primary/30",
              )}
            >
              <div
                className={cn(
                  "mx-auto grid h-12 w-12 place-items-center rounded-full",
                  b.earned ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                <Award className="h-6 w-6" />
              </div>
              <div className="mt-2 text-sm font-medium">{b.name}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{b.desc}</div>
              {b.isToday && (
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  New today
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

    </div>
  );
}
