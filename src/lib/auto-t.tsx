import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useApp, type Language } from "@/lib/app-state";
import { translateStrings } from "@/lib/translate.functions";

/** Runtime AI translation with in-memory + localStorage caching.
 *
 * Two ways to use it:
 * 1. Wrap text explicitly with <T>Some copy</T> or const { t } = useAutoT(); t("Some copy").
 * 2. DOM auto-translation: enabled by default. When the language is not English, this
 *    walks visible text nodes in <main> (the app content region), batches them to the
 *    AI gateway, caches results, and swaps them in-place. Original English is preserved
 *    on each node so switching back is instant.
 */

interface AutoTContext {
  t: (s: string) => string;
  language: Language;
}

const Ctx = createContext<AutoTContext | null>(null);

const LS_KEY = "eutripping.autot.v1";
const ORIG_ATTR = "__autot_orig__";

type Cache = Record<string, Record<string, string>>;

function loadCache(): Cache {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(LS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveCache(cache: Cache) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota
  }
}

/** Should this text node be translated? Skip empty/numeric/tiny nodes and script/style. */
function isTranslatable(node: Text): boolean {
  const val = node.nodeValue;
  if (!val) return false;
  const trimmed = val.trim();
  if (trimmed.length < 2) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false; // needs at least a letter
  const parent = node.parentElement;
  if (!parent) return false;
  const tag = parent.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "CODE" || tag === "PRE" || tag === "NOSCRIPT") return false;
  if (parent.closest("[data-no-translate]")) return false;
  return true;
}

function collectTextNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (isTranslatable(n as Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  let cur = walker.nextNode();
  while (cur) {
    out.push(cur as Text);
    cur = walker.nextNode();
  }
  return out;
}

export function AutoTProvider({ children }: { children: ReactNode }) {
  const { language } = useApp();
  const [cache, setCache] = useState<Cache>(() => loadCache());
  const cacheRef = useRef<Cache>(cache);
  cacheRef.current = cache;

  const pending = useRef<Set<string>>(new Set());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, forceRender] = useState(0);

  const routerLocation = useRouterState({ select: (s) => s.location.pathname });

  const flushBatch = useCallback(
    async (target: Language) => {
      flushTimer.current = null;
      const batch = Array.from(pending.current);
      pending.current.clear();
      if (batch.length === 0 || target === "en") return;
      // Chunk to keep requests under 60 strings per call
      const chunks: string[][] = [];
      for (let i = 0; i < batch.length; i += 50) chunks.push(batch.slice(i, i + 50));
      for (const chunk of chunks) {
        try {
          const res = (await translateStrings({ data: { strings: chunk, target } })) as { translated: string[] };
          setCache((prev) => {
            const next = { ...prev, [target]: { ...(prev[target] ?? {}) } };
            chunk.forEach((src, i) => {
              next[target][src] = res.translated[i] ?? src;
            });
            saveCache(next);
            return next;
          });
        } catch {
          // ignore
        }
      }
      forceRender((n) => n + 1);
    },
    [],
  );

  const scheduleFlush = useCallback(
    (target: Language) => {
      if (flushTimer.current) return;
      flushTimer.current = setTimeout(() => {
        void flushBatch(target);
      }, 200);
    },
    [flushBatch],
  );

  const ensureTranslation = useCallback(
    (s: string, target: Language): string | null => {
      if (target === "en") return s;
      const langCache = cacheRef.current[target] ?? {};
      const hit = langCache[s];
      if (hit) return hit;
      if (!pending.current.has(s)) {
        pending.current.add(s);
        scheduleFlush(target);
      }
      return null;
    },
    [scheduleFlush],
  );

  const t = useCallback(
    (s: string): string => {
      if (!s || language === "en") return s;
      return ensureTranslation(s, language) ?? s;
    },
    [language, ensureTranslation, cache],
  );

  // DOM auto-translation effect: on language change or route change, walk <main> and swap text nodes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.querySelector("main") as HTMLElement | null;
    if (!root) return;

    if (language === "en") {
      // Restore originals
      const nodes = document.querySelectorAll("*");
      nodes.forEach((el) => {
        const anyEl = el as any;
        if (anyEl[ORIG_ATTR]) {
          const originals: Record<number, string> = anyEl[ORIG_ATTR];
          Array.from(el.childNodes).forEach((child, idx) => {
            if (child.nodeType === Node.TEXT_NODE && originals[idx] != null) {
              (child as Text).nodeValue = originals[idx];
            }
          });
        }
      });
      return;
    }

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const textNodes = collectTextNodes(root);
      // Store originals per parent
      textNodes.forEach((n) => {
        const parent = n.parentElement as any;
        if (!parent) return;
        if (!parent[ORIG_ATTR]) parent[ORIG_ATTR] = {} as Record<number, string>;
        const idx = Array.from(parent.childNodes).indexOf(n);
        if (parent[ORIG_ATTR][idx] == null) parent[ORIG_ATTR][idx] = n.nodeValue ?? "";
      });

      // Apply cached translations & queue misses
      textNodes.forEach((n) => {
        const parent = n.parentElement as any;
        if (!parent) return;
        const idx = Array.from(parent.childNodes).indexOf(n);
        const original: string = parent[ORIG_ATTR][idx] ?? n.nodeValue ?? "";
        const key = original.trim();
        if (!key) return;
        // Preserve leading/trailing whitespace
        const leading = original.match(/^\s*/)?.[0] ?? "";
        const trailing = original.match(/\s*$/)?.[0] ?? "";
        const translated = ensureTranslation(key, language);
        if (translated != null) {
          n.nodeValue = `${leading}${translated}${trailing}`;
        } else {
          // keep original for now; will re-run after batch resolves
          n.nodeValue = original;
        }
      });
    };

    run();
    // Re-run shortly after to pick up newly-cached translations
    const t1 = setTimeout(run, 400);
    const t2 = setTimeout(run, 1200);
    const t3 = setTimeout(run, 2500);

    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [language, routerLocation, cache, ensureTranslation]);

  const value = useMemo<AutoTContext>(() => ({ t, language }), [t, language]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAutoT() {
  const ctx = useContext(Ctx);
  if (!ctx) return { t: (s: string) => s, language: "en" as Language };
  return ctx;
}

export function T({ children }: { children: string }) {
  const { t } = useAutoT();
  return <>{t(children)}</>;
}
