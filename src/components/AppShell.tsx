import { Link, useRouterState } from "@tanstack/react-router";
import {
  Award,
  Car,
  CalendarDays,
  CheckSquare,
  FileText,
  Home,
  Loader2,
  Lock,
  LogOut,
  Map,
  MoreHorizontal,
  Moon,
  Receipt,
  Rss,
  Settings as SettingsIcon,
  Sparkles,
  ShieldCheck,
  Sun,
  Upload,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "@/lib/app-state";
import { useAdminAuth } from "@/lib/admin-auth";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { useTripTrackingSync } from "@/hooks/use-trip-tracking-sync";
import { cn } from "@/lib/utils";

import logoAsset from "@/assets/logo.png.asset.json";

interface NavItem {
  to: string;
  labelKey: string;
  hint: string;
  icon: LucideIcon;
}

const PUBLIC_NAV: NavItem[] = [
  { to: "/", labelKey: "nav.home", hint: "Live trip", icon: Home },
  { to: "/itinerary", labelKey: "nav.itinerary", hint: "Dates and cities", icon: CalendarDays },
  { to: "/story", labelKey: "nav.story", hint: "Feed", icon: Rss },
  { to: "/map", labelKey: "nav.map", hint: "Covered route", icon: Map },
  { to: "/vehicle", labelKey: "nav.vehicle", hint: "The truck", icon: Car },
  { to: "/achievements", labelKey: "nav.achievements", hint: "Badges", icon: Award },
  { to: "/ask", labelKey: "nav.ask", hint: "AI assistant", icon: Sparkles },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/bookings", labelKey: "nav.bookings", hint: "Admin", icon: Upload },
  { to: "/cost", labelKey: "nav.cost", hint: "Admin", icon: Receipt },
  { to: "/travellers", labelKey: "nav.travellers", hint: "Admin", icon: Users },
  { to: "/documents", labelKey: "nav.documents", hint: "Admin", icon: FileText },
  { to: "/checklist", labelKey: "nav.checklist", hint: "Admin", icon: CheckSquare },
  { to: "/settings", labelKey: "nav.settings", hint: "Admin", icon: SettingsIcon },
];

// Miezko (crew) sees admin tools but not bookings/documents/settings/travellers.
const CREW_HIDDEN = new Set<string>(["/bookings", "/documents", "/settings", "/travellers"]);
const CREW_NAV: NavItem[] = ADMIN_NAV.filter((i) => !CREW_HIDDEN.has(i.to));

// Regular members (email + password login) get the shared cost book.
const MEMBER_NAV: NavItem[] = ADMIN_NAV.filter((i) => i.to === "/cost");

// Mobile bottom tabs: 4 primary + More sheet with the rest.
const MOBILE_PRIMARY: NavItem[] = [
  { to: "/", labelKey: "nav.home", hint: "Live trip", icon: Home },
  { to: "/map", labelKey: "nav.map", hint: "Covered route", icon: Map },
  { to: "/story", labelKey: "nav.story", hint: "Feed", icon: Rss },
  { to: "/ask", labelKey: "nav.ask", hint: "AI assistant", icon: Sparkles },
];


export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { theme, toggleTheme, language, setLanguage } = useApp();
  const t = useT();
  const { isAdmin, role, signIn, signOut, loading } = useAdminAuth();
  const { user, signOut: memberSignOut } = useAuth();
  const isMember = !isAdmin && !!user;
  const [hydrated, setHydrated] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setHydrated(true), []);
  useEffect(() => setMoreOpen(false), [pathname]);

  // App-wide GPS: admin pushes fixes to DB; everyone else polls the coarse public feed.
  useTripTrackingSync();


  // Share links (cost.share) render without the shell chrome so they feel like standalone pages.
  const isShareLink = pathname.startsWith("/cost/share/");
  if (isShareLink) {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>;
  }

  const adminNavForRole: NavItem[] =
    role === "crew" ? CREW_NAV : role === "owner" ? ADMIN_NAV : isMember ? MEMBER_NAV : [];
  const nav: NavItem[] = useMemo(
    () => (hydrated && (isAdmin || isMember) ? [...PUBLIC_NAV, ...adminNavForRole] : PUBLIC_NAV),
    [hydrated, isAdmin, isMember, adminNavForRole],
  );

  const LANG_ORDER: Array<"en" | "tr" | "pl" | "it"> = ["en", "tr", "pl", "it"];
  const nextLanguage = () => {
    const idx = LANG_ORDER.indexOf(language);
    setLanguage(LANG_ORDER[(idx + 1) % LANG_ORDER.length]);
  };
  const languageLabel = language.toUpperCase();
  const nextLabel = LANG_ORDER[(LANG_ORDER.indexOf(language) + 1) % LANG_ORDER.length].toUpperCase();

  return (
    <div className="min-h-screen text-foreground">
      {/* Top bar (glass) */}
      <header className="sticky top-3 z-30 mx-auto max-w-[1440px] px-3 sm:px-4">
        <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-[24px] px-4 py-3 shadow-[0_12px_36px_-16px_rgba(16,32,51,0.25)]">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5 dark:bg-white/90">
              <img
                src={logoAsset.url}
                alt="Tripping"
                width={44}
                height={44}
                loading="lazy"
                className="h-9 w-9 object-contain"
              />
            </div>
            <div className="min-w-0">
              <div className="font-display text-[1.4rem] leading-none">Tripping</div>
              <div className="mt-1 truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Istanbul and back
              </div>
            </div>
          </Link>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={nextLanguage}
              className="rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted"
              suppressHydrationWarning
            >
              {hydrated ? `${languageLabel} · ${nextLabel}` : "EN · TR"}
            </button>
            <button
              type="button"
              aria-label="Toggle theme"
              onClick={toggleTheme}
              className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-foreground transition hover:bg-muted"
              suppressHydrationWarning
            >
              {hydrated ? (
                theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4 opacity-0" />
              )}
            </button>
            {hydrated && isAdmin ? (
              <button
                type="button"
                onClick={signOut}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold text-[var(--cream)] transition hover:opacity-90"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> {role === "crew" ? "Miezko" : "Admin"} active
                <LogOut className="h-3.5 w-3.5 opacity-70" />
              </button>
            ) : hydrated && isMember ? (
              <button
                type="button"
                onClick={memberSignOut}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold text-[var(--cream)] transition hover:opacity-90"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> {user?.user_metadata?.display_name ?? "Member"} active
                <LogOut className="h-3.5 w-3.5 opacity-70" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2 text-xs font-semibold text-[var(--cream)] transition hover:opacity-90"
                suppressHydrationWarning
              >
                <Lock className="h-3.5 w-3.5" /> Log in
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Shell: sidebar + main */}
      <div className="mx-auto mt-4 grid max-w-[1440px] gap-4 px-3 pb-[calc(env(safe-area-inset-bottom)+72px)] sm:px-4 md:grid-cols-[220px_minmax(0,1fr)] md:pb-8">
        <aside className="sticky top-[110px] hidden h-max rounded-[24px] border border-white/60 bg-white/70 p-3 shadow-[0_12px_34px_-16px_rgba(16,32,51,0.18)] backdrop-blur-xl md:block dark:border-border dark:bg-card/70">
          <nav className="flex flex-col gap-1">
            {nav.map((item) => {
              const active =
                item.to === "/"
                  ? pathname === "/"
                  : pathname === item.to || pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "rounded-2xl px-3 py-3 text-left text-sm transition",
                    active
                      ? "bg-[var(--ink)] text-[var(--cream)]"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.4 : 2} />
                    {t(item.labelKey)}
                  </div>
                  <div className={cn("mt-0.5 text-[11px]", active ? "text-white/70" : "opacity-70")}>
                    {item.hint}
                  </div>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0">{children}</main>
      </div>

      {/* Mobile bottom tab bar — 4 primary + More sheet with everything else */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/40 bg-background/85 pb-[max(env(safe-area-inset-bottom),0px)] backdrop-blur-xl md:hidden dark:border-border/60 dark:bg-card/90"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5 items-stretch">
          {MOBILE_PRIMARY.map((item) => {
            const active =
              item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(item.to + "/");
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] transition",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
                  <span>{t(item.labelKey)}</span>
                  {active && <span className="h-0.5 w-6 rounded-full bg-[var(--ink)]" />}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition"
            >
              <MoreHorizontal className="h-5 w-5" />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen && (
        <MoreSheet
          onClose={() => setMoreOpen(false)}
          items={hydrated && (isAdmin || isMember) ? [...PUBLIC_NAV, ...adminNavForRole] : PUBLIC_NAV}
          pathname={pathname}
          t={t}
        />
      )}



      {modalOpen && (
        <LoginModal
          onClose={() => setModalOpen(false)}
          onSubmitAdmin={async (password) => {
            await signIn(password);
            setModalOpen(false);
          }}
          onSubmitMember={async (email, password) => {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw new Error(error.message);
            setModalOpen(false);
          }}
          loading={loading}
        />
      )}
    </div>
  );
}

function LoginModal({
  onClose,
  onSubmitAdmin,
  onSubmitMember,
  loading,
}: {
  onClose: () => void;
  onSubmitAdmin: (password: string) => Promise<void>;
  onSubmitMember: (email: string, password: string) => Promise<void>;
  loading: boolean;
}) {
  const [mode, setMode] = useState<"admin" | "member">("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "admin") await onSubmitAdmin(password);
      else await onSubmitMember(email.trim().toLowerCase(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  const tabClass = (active: boolean) =>
    cn(
      "flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition",
      active ? "bg-[var(--ink)] text-[var(--cream)]" : "text-muted-foreground hover:bg-muted",
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[oklch(0.16_0.03_258/0.55)] p-4 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-white/60 bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              {mode === "admin" ? "Admin" : "Member"}
            </div>
            <h2 className="mt-1 font-display text-2xl">
              {mode === "admin" ? "Unlock controls" : "Log in"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {mode === "admin"
                ? "Same page. Admin gets edit, upload, cost and delete on top of what you already see."
                : "For travellers: add shared costs and see who owes whom. Use the email + password the trip owner gave you."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-muted-foreground transition hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 flex gap-1 rounded-full border border-border bg-background p-1">
          <button type="button" className={tabClass(mode === "admin")} onClick={() => { setMode("admin"); setError(null); }}>
            Admin
          </button>
          <button type="button" className={tabClass(mode === "member")} onClick={() => { setMode("member"); setError(null); }}>
            Member
          </button>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-3">
          {mode === "member" && (
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Email
              <input
                type="email"
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none ring-primary/30 focus:ring-2"
              />
            </label>
          )}
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Password
            <input
              type="password"
              autoFocus={mode === "admin"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none ring-primary/30 focus:ring-2"
            />
          </label>
          {error && (
            <div className="rounded-2xl bg-[oklch(0.62_0.20_30/0.10)] px-3 py-2 text-xs font-medium text-[var(--red-signal)]">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy || loading || !password || (mode === "member" && !email.trim())}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--ink)] px-4 py-2.5 text-sm font-semibold text-[var(--cream)] transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            {busy ? "Signing in…" : mode === "admin" ? "Unlock admin" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}

function MoreSheet({
  items,
  pathname,
  onClose,
  t,
}: {
  items: NavItem[];
  pathname: string;
  onClose: () => void;
  t: (k: string) => string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm md:hidden"
      onClick={onClose}
    >
      <div
        className="rounded-t-3xl border-t border-white/60 bg-background p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-2xl dark:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        <div className="mb-2 flex items-center justify-between">
          <div className="font-display text-lg">Everything</div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="grid grid-cols-3 gap-2">
          {items.map((item) => {
            const active =
              item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(item.to + "/");
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  onClick={onClose}
                  className={cn(
                    "flex h-20 flex-col items-center justify-center gap-1 rounded-2xl border border-border p-2 text-center text-[11px] font-semibold transition",
                    active ? "bg-[var(--ink)] text-[var(--cream)]" : "bg-card text-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
                  <span>{t(item.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

