"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_THEME_PREFERENCE,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

interface ThemeContextValue {
  /** What the user picked: light / dark / system. */
  preference: ThemePreference;
  /** The theme currently applied to <html> (system already resolved). */
  resolved: ResolvedTheme;
  /** Persist a new preference and apply it immediately. */
  setPreference: (preference: ThemePreference) => void;
  /** Convenience flip between light and dark (resolves `system` first). */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia(MEDIA_QUERY).matches;
}

/**
 * Owns theme state for the app. The initial `data-theme` is set by the no-flash
 * script in <head> (see lib/theme.ts), so this provider only takes over to
 * react to user toggles, OS changes (when preference is `system`), and writes
 * to localStorage. It re-reads the persisted preference on mount to stay in
 * sync with the pre-hydration script.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    DEFAULT_THEME_PREFERENCE,
  );
  const [prefersDark, setPrefersDark] = useState<boolean>(true);

  // Hydrate from storage + current OS setting once mounted (client only).
  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as
      | ThemePreference
      | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      setPreferenceState(stored);
    }
    setPrefersDark(systemPrefersDark());
  }, []);

  // Track OS changes so `system` stays live without a reload.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(MEDIA_QUERY);
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const resolved = useMemo(
    () => resolveTheme(preference, prefersDark),
    [preference, prefersDark],
  );

  // Reflect the resolved theme onto <html> for the CSS token cascade.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* storage unavailable (private mode) — keep in-memory only */
    }
  }, []);

  const toggle = useCallback(() => {
    setPreference(resolved === "dark" ? "light" : "dark");
  }, [resolved, setPreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, setPreference, toggle],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/** Access the active theme + setters. Throws if used outside ThemeProvider. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
