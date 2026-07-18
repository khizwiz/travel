import { Link } from "@tanstack/react-router";
import { Award, Sparkles } from "lucide-react";
import { computeEarnedBadges } from "@/lib/badges";
import { cn } from "@/lib/utils";

export function HomeBadges() {
  const badges = computeEarnedBadges();
  const earned = badges.filter((b) => b.earned);
  // Hide the strip publicly until at least one badge has been earned.
  if (earned.length === 0) return null;
  const showToday = earned.find((b) => b.isToday);
  const upcoming = badges.filter((b) => !b.earned).slice(0, Math.max(0, 6 - earned.length));
  const strip = [...earned.slice(-6), ...upcoming];


  return (
    <section>
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Badges
        </div>
        <Link to="/achievements" className="text-xs font-semibold text-primary">
          All badges →
        </Link>
      </div>

      {showToday && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
          <Sparkles className="h-3.5 w-3.5" /> New today · {showToday.name}
        </div>
      )}

      <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {strip.map((b) => (
          <li
            key={b.id}
            className={cn(
              "card-elev p-3 text-center transition",
              !b.earned && "opacity-45",
              b.isToday && "border-primary/50 ring-2 ring-primary/30",
            )}
            title={b.desc}
          >
            <div
              className={cn(
                "mx-auto grid h-10 w-10 place-items-center rounded-full",
                b.earned ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              <Award className="h-5 w-5" />
            </div>
            <div className="mt-2 line-clamp-2 text-[11px] font-medium leading-tight">{b.name}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
