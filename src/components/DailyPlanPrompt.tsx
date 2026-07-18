import { useMemo } from "react";
import { Wand2, CalendarClock } from "lucide-react";
import { useAdminAuth } from "@/lib/admin-auth";
import { getTripProgress, ITINERARY } from "@/lib/trip-data";
import { usePlanOverrides } from "@/hooks/use-plan-overrides";
import { RePlanSheet } from "@/components/RePlanSheet";

/** Owner-only nudge shown on active-trip days that don't yet have a re-routed plan.
 *  Prompts for both TODAY and TOMORROW when either is still on the original plan. */
export function DailyPlanPrompt() {
  const { isAdmin } = useAdminAuth();
  const progress = useMemo(() => getTripProgress(), []);
  const { map } = usePlanOverrides();

  if (!isAdmin) return null;
  if (progress.phase !== "active") return null;

  const today = progress.todayDay ?? ITINERARY[progress.index] ?? null;
  const tomorrow =
    progress.index >= 0 && progress.index < ITINERARY.length - 1
      ? ITINERARY[progress.index + 1]
      : null;

  const nextFixed = (fromIdx: number) =>
    ITINERARY.slice(fromIdx + 1).find(
      (d) => d.kind !== "open" && d.to && d.to !== d.from,
    );

  const showToday = today && !map.has(today.date);
  const showTomorrow = tomorrow && !map.has(tomorrow.date);
  if (!showToday && !showTomorrow) return null;

  return (
    <section className="card-elev border-primary/30 bg-primary/5 p-4 space-y-3">
      {showToday && today && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <Wand2 className="h-3.5 w-3.5" /> Today's plan
            </div>
            <p className="mt-1 font-display text-lg">Where are you headed?</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Original: {today.from}
              {today.to && today.to !== today.from ? ` → ${today.to}` : ""}. Tell the app the
              real destination and it will re-work today's route.
            </p>
          </div>
          <RePlanSheet
            dayDate={today.date}
            currentFrom={today.from}
            originalTo={today.to}
            nextFixedStop={nextFixed(progress.index)?.to ?? null}
          />
        </div>
      )}

      {showTomorrow && tomorrow && (
        <div className="flex items-start justify-between gap-3 border-t border-primary/20 pt-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <CalendarClock className="h-3.5 w-3.5" /> Tomorrow's plan
            </div>
            <p className="mt-1 font-display text-lg">Where to tomorrow?</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Original: {tomorrow.from}
              {tomorrow.to && tomorrow.to !== tomorrow.from ? ` → ${tomorrow.to}` : ""}. Set it
              tonight so checklists and fuel prompts adapt in the morning.
            </p>
          </div>
          <RePlanSheet
            dayDate={tomorrow.date}
            currentFrom={tomorrow.from}
            originalTo={tomorrow.to}
            nextFixedStop={nextFixed(progress.index + 1)?.to ?? null}
          />
        </div>
      )}
    </section>
  );
}
