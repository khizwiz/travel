import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, X, AlertCircle, CalendarClock } from "lucide-react";
import { MISSING_INFO, ITINERARY, getTripProgress } from "@/lib/trip-data";
import { useAdminAuth } from "@/lib/admin-auth";

interface Item {
  key: string;
  kind: "reminder" | "info";
  title: string;
  detail?: string;
  href?: string;
}

const DISMISS_KEY = "tripping.home-banner.dismissed";

/**
 * Home-page inline notification banner. Merges upcoming itinerary reminders
 * with the "information required" backlog. Dismissible per-day and per-item
 * via localStorage.
 */
export function HomeBanner() {
  const { isAdmin } = useAdminAuth();
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw) setDismissed(JSON.parse(raw));
    } catch {}
  }, []);

  const dismiss = (k: string) => {
    setDismissed((prev) => {
      const next = { ...prev, [k]: true };
      try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const progress = getTripProgress();
  const upcoming: Item[] = [];
  const idx = progress.index < 0 ? 0 : progress.index;
  for (const day of ITINERARY.slice(idx, idx + 3)) {
    if (day.missing && day.missing.length) {
      upcoming.push({
        key: `day:${day.date}`,
        kind: "reminder",
        title: `${day.from} → ${day.to} · ${day.date}`,
        detail: day.missing.join(" · "),
        href: "/itinerary",
      });
    }
  }
  for (const m of MISSING_INFO.slice(0, 3)) {
    upcoming.push({
      key: `info:${m.item.slice(0, 30)}`,
      kind: "info",
      title: m.item,
      detail: m.why,
      href: "/checklist",
    });
  }

  const visible = upcoming.filter((i) => !dismissed[i.key]).slice(0, 3);
  if (!isAdmin) return null;
  if (visible.length === 0) return null;

  return (
    <section aria-label="Reminders" className="card-elev overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Bell className="h-3.5 w-3.5" />
        Reminders & info needed
        <Link to="/checklist" className="ml-auto text-[11px] font-medium text-primary underline-offset-2 hover:underline">
          Open checklist
        </Link>
      </header>
      <ul className="divide-y divide-border/60">
        {visible.map((it) => (
          <li key={it.key} className="flex items-start gap-3 px-4 py-3">
            <div className={it.kind === "info" ? "mt-0.5 text-warning" : "mt-0.5 text-primary"}>
              {it.kind === "info" ? <AlertCircle className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium">{it.title}</div>
              {it.detail && <div className="text-xs text-muted-foreground">{it.detail}</div>}
              {it.href && (
                <Link to={it.href} className="mt-1 inline-block text-[11px] font-medium text-primary hover:underline">
                  Open →
                </Link>
              )}
            </div>
            <button
              onClick={() => dismiss(it.key)}
              aria-label="Dismiss"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
