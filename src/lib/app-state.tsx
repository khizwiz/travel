import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ITINERARY, getActiveDayId } from "./trip-data";

export type Theme = "light" | "dark";
export type Language = "en" | "tr" | "pl" | "it";

interface AppState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;

  language: Language;
  setLanguage: (l: Language) => void;

  // Active itinerary day (owner can override for testing)
  activeDayId: string;
  setActiveDayId: (id: string) => void;
  resetActiveDay: () => void;

  // Trip pause state ("I missed this destination")
  paused: boolean;
  pauseAtCurrentDay: () => void;
  resume: () => void;

  // Owner mode toggle (in absence of real auth)
  isOwner: boolean;
  setIsOwner: (v: boolean) => void;

  // Tracking
  trackingOn: boolean;
  toggleTracking: () => void;

  // Persistent opt-in for browser geolocation on public pages
  geoOptIn: boolean;
  setGeoOptIn: (v: boolean) => void;

  // Latest in-memory GPS fix (set by Tracking page; read by Today/Itinerary maps)
  liveFix: { lat: number; lng: number; ts: number; accuracyM?: number } | null;
  setLiveFix: (f: { lat: number; lng: number; ts: number; accuracyM?: number } | null) => void;

  // Points
  individualPoints: number;
  groupPoints: number;
  addPoints: (kind: "individual" | "group", n: number) => void;
}

const Ctx = createContext<AppState | null>(null);

const KEY = "eutripping.state.v1";

interface Persisted {
  theme: Theme;
  language: Language;
  activeDayId: string | null;
  paused: boolean;
  isOwner: boolean;
  trackingOn: boolean;
  geoOptIn: boolean;
  individualPoints: number;
  groupPoints: number;
}

function readPersisted(): Partial<Persisted> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<Persisted>;
  } catch {
    return {};
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const defaultActive = useMemo(() => getActiveDayId(), []);

  // SSR-safe defaults; rehydrate from localStorage after mount to avoid hydration mismatch.
  const [theme, setThemeState] = useState<Theme>("light");
  const [language, setLanguage] = useState<Language>("en");
  const [activeDayId, setActiveDayIdState] = useState<string>(defaultActive);
  const [paused, setPaused] = useState<boolean>(false);
  const [isOwner, setIsOwner] = useState<boolean>(true);
  const [trackingOn, setTracking] = useState<boolean>(false);
  const [geoOptIn, setGeoOptIn] = useState<boolean>(false);
  const [individualPoints, setIndividual] = useState<number>(0);
  const [groupPoints, setGroup] = useState<number>(0);
  const [liveFix, setLiveFix] = useState<AppState["liveFix"]>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const p = readPersisted();
    if (p.theme) setThemeState(p.theme);
    if (p.language) setLanguage(p.language);
    if (p.activeDayId) setActiveDayIdState(p.activeDayId);
    if (typeof p.paused === "boolean") setPaused(p.paused);
    if (typeof p.isOwner === "boolean") setIsOwner(p.isOwner);
    if (typeof p.trackingOn === "boolean") setTracking(p.trackingOn);
    if (typeof p.geoOptIn === "boolean") setGeoOptIn(p.geoOptIn);
    if (typeof p.individualPoints === "number") setIndividual(p.individualPoints);
    if (typeof p.groupPoints === "number") setGroup(p.groupPoints);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const data: Persisted = {
      theme, language, activeDayId, paused, isOwner, trackingOn, geoOptIn, individualPoints, groupPoints,
    };
    window.localStorage.setItem(KEY, JSON.stringify(data));
  }, [hydrated, theme, language, activeDayId, paused, isOwner, trackingOn, geoOptIn, individualPoints, groupPoints]);

  // Apply theme class
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const value: AppState = {
    theme,
    setTheme: setThemeState,
    toggleTheme: () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    language,
    setLanguage,
    activeDayId,
    setActiveDayId: (id) => {
      if (ITINERARY.some((d) => d.id === id)) setActiveDayIdState(id);
    },
    resetActiveDay: () => setActiveDayIdState(getActiveDayId()),
    paused,
    pauseAtCurrentDay: () => setPaused(true),
    resume: () => setPaused(false),
    isOwner,
    setIsOwner,
    trackingOn,
    toggleTracking: () => setTracking((v) => !v),
    geoOptIn,
    setGeoOptIn,
    liveFix,
    setLiveFix,
    individualPoints,
    groupPoints,
    addPoints: (kind, n) => {
      if (kind === "individual") setIndividual((v) => v + n);
      else setGroup((v) => v + n);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within AppStateProvider");
  return v;
}
