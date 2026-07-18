import { createFileRoute } from "@tanstack/react-router";
import { useApp, type Language, type Theme } from "@/lib/app-state";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { useAuth } from "@/lib/auth";
import { useAdminAuth } from "@/lib/admin-auth";
import { OwnerOnly } from "@/components/OwnerOnly";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — Tripping" }] }),
  component: () => (
    <OwnerOnly page="Settings">
      <SettingsPage />
    </OwnerOnly>
  ),
});

const LANGUAGES: { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "tr", label: "Türkçe" },
  { id: "pl", label: "Polski" },
  { id: "it", label: "Italiano" },
];

function SettingsPage() {
  const { theme, setTheme, language, setLanguage, isOwner, setIsOwner } = useApp();
  const { user } = useAuth();
  const { isAdmin } = useAdminAuth();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-3xl">Settings</h1>
        <p className="text-sm text-muted-foreground">Theme and language.</p>
      </header>

      <section className="card-elev p-4">
        <h2 className="text-sm font-semibold">Theme</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(["light", "dark"] as Theme[]).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`rounded-lg border px-3 py-2 text-sm capitalize ${
                theme === t ? "border-primary bg-primary/10" : "border-border bg-card"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      <section className="card-elev p-4">
        <h2 className="text-sm font-semibold">Language</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              onClick={() => setLanguage(l.id)}
              className={`rounded-lg border px-3 py-2 text-sm ${
                language === l.id ? "border-primary bg-primary/10" : "border-border bg-card"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          UI strings will localise once the translation files are connected.
        </p>
      </section>


      {isAdmin && (
        <section className="card-elev p-4">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Admin-only. Web push alerts for daily plans, arrivals and reminders. Works on desktop
            and Android; on iPhone add Tripping to your Home Screen first.
          </p>
          {user ? (
            <NotificationsPanel />
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Sign in to enable notifications.</p>
          )}
        </section>
      )}

      <section className="card-elev p-4">
        <h2 className="text-sm font-semibold">Admin preview</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Toggle admin-only UI locally without unlocking with the password. Server-side writes
          still require the real admin password unlock.
        </p>
        <label className="mt-3 flex items-center justify-between gap-3 text-sm">
          <span>Show admin controls in this browser</span>
          <input
            type="checkbox"
            checked={isOwner}
            onChange={(e) => setIsOwner(e.target.checked)}
            className="h-4 w-4"
          />
        </label>
      </section>

    </div>
  );
}
