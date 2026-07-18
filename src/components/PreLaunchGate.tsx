import { useEffect, useState, type ReactNode } from "react";
import { APP_KICKOFF_MS, APP_KICKOFF_ISO } from "@/lib/trip-data";
import { useAdminAuth } from "@/lib/admin-auth";
import logoAsset from "@/assets/logo.png.asset.json";

/** Pre-launch splash — shown to everyone except signed-in admin/crew before 17 Jul 2026 05:00 (Europe/Istanbul). */
export function PreLaunchGate({ children }: { children: ReactNode }) {
  const { isAdmin } = useAdminAuth();
  const [now, setNow] = useState(() => Date.now());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Avoid hydration flicker — during SSR/before hydrate, just render children.
  if (!hydrated) return <>{children}</>;
  if (isAdmin) return <>{children}</>;
  if (now >= APP_KICKOFF_MS) return <>{children}</>;

  const diff = APP_KICKOFF_MS - now;
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[oklch(0.98_0.02_95)] via-[oklch(0.95_0.03_140)] to-[oklch(0.92_0.05_160)] px-6 py-12 text-foreground dark:from-[oklch(0.16_0.03_260)] dark:via-[oklch(0.18_0.04_240)] dark:to-[oklch(0.14_0.03_180)]">
      <div className="mx-auto grid min-h-[80vh] max-w-lg place-items-center">
        <div className="text-center">
          <img
            src={logoAsset.url}
            alt="Tripping"
            width={128}
            height={128}
            className="mx-auto h-32 w-32 rounded-3xl bg-white/70 p-4 shadow-xl backdrop-blur"
          />
          <div className="mt-8 text-[10px] font-bold uppercase tracking-[0.32em] text-muted-foreground">
            Soft launch
          </div>
          <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">Tripping opens on 17 July</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The road trip kicks off at 05:00 Istanbul time. Come back then for the live feed, route map and daily story.
          </p>
          <div className="mt-8 grid grid-cols-4 gap-2 rounded-2xl bg-white/60 p-4 shadow-lg backdrop-blur dark:bg-card/60">
            <Cell v={days} label="days" />
            <Cell v={hours} label="hrs" />
            <Cell v={minutes} label="min" />
            <Cell v={seconds} label="sec" />
          </div>
          <div className="mt-6 text-[10px] uppercase tracking-widest text-muted-foreground">
            {new Date(APP_KICKOFF_ISO).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Cell({ v, label }: { v: number; label: string }) {
  return (
    <div>
      <div className="font-display text-3xl tabular-nums">{String(v).padStart(2, "0")}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
