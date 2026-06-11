const PREFS_KEY = "orchestrator:runDrawerPrefs";

/** Resize bounds for the run drawer (px). Exported so the hook clamps the same way. */
export const DRAWER_MIN_HEIGHT = 160;
export const DRAWER_MAX_HEIGHT = 720;
export const DRAWER_DEFAULT_HEIGHT = 288; // matches the old fixed `h-72`.

export interface DrawerPrefs {
  /** Expanded body height in px (clamped to [MIN, MAX]). */
  height: number;
  /** When true the drawer is minimized to just its header bar. */
  collapsed: boolean;
}

export const DEFAULT_DRAWER_PREFS: DrawerPrefs = {
  height: DRAWER_DEFAULT_HEIGHT,
  collapsed: false,
};

const isClient =
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

/** Clamp an arbitrary height into the allowed drawer range. */
export function clampDrawerHeight(height: number): number {
  if (!Number.isFinite(height)) return DRAWER_DEFAULT_HEIGHT;
  return Math.min(DRAWER_MAX_HEIGHT, Math.max(DRAWER_MIN_HEIGHT, Math.round(height)));
}

/**
 * Read the persisted drawer prefs. Falls back to defaults on SSR, missing,
 * or corrupt values, and always returns a clamped height.
 */
export function getDrawerPrefs(): DrawerPrefs {
  if (!isClient) return { ...DEFAULT_DRAWER_PREFS };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_DRAWER_PREFS };
    const parsed = JSON.parse(raw) as Partial<DrawerPrefs> | null;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_DRAWER_PREFS };
    return {
      height: clampDrawerHeight(
        typeof parsed.height === "number" ? parsed.height : DRAWER_DEFAULT_HEIGHT,
      ),
      collapsed: parsed.collapsed === true,
    };
  } catch {
    return { ...DEFAULT_DRAWER_PREFS };
  }
}

/** Persist drawer prefs. No-op on SSR; height is clamped before writing. */
export function saveDrawerPrefs(prefs: DrawerPrefs): void {
  if (!isClient) return;
  try {
    const safe: DrawerPrefs = {
      height: clampDrawerHeight(prefs.height),
      collapsed: prefs.collapsed === true,
    };
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(safe));
  } catch {
    // Ignore quota / serialization errors — prefs are best-effort.
  }
}
