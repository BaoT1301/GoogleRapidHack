/**
 * Theme primitives shared by the no-flash inline script, the ThemeProvider, and
 * the ThemeToggle. Kept dependency-free so the same constants can be inlined
 * into a raw <script> string that runs before React hydrates.
 */

/** User-selectable preference. `system` follows the OS `prefers-color-scheme`. */
export type ThemePreference = "light" | "dark" | "system";
/** The concrete theme actually applied to <html data-theme>. */
export type ResolvedTheme = "light" | "dark";

/** localStorage key holding the persisted {@link ThemePreference}. */
export const THEME_STORAGE_KEY = "orch-theme";
/** Default preference on first visit. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

/** Resolve a preference to a concrete theme using the OS setting for `system`. */
export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

/**
 * A self-contained IIFE, serialized to a string, that applies the persisted
 * theme to <html> synchronously in <head> — before first paint — to avoid a
 * flash of the wrong theme (FOUC). It mirrors {@link resolveTheme} but cannot
 * import anything, so the logic is duplicated inline by design.
 */
export const NO_FLASH_SCRIPT = `(function(){try{
var key=${JSON.stringify(THEME_STORAGE_KEY)};
var pref=localStorage.getItem(key)||${JSON.stringify(DEFAULT_THEME_PREFERENCE)};
var dark=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;
var theme=pref==="system"?(dark?"dark":"light"):pref;
document.documentElement.setAttribute("data-theme",theme);
}catch(e){
document.documentElement.setAttribute("data-theme","dark");
}})();`;
