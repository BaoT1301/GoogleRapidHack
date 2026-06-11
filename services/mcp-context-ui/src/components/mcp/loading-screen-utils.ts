/**
 * Loading Screen Utility Functions
 *
 * Pure functions extracted from GlobeLoadingScreen for testability.
 * These functions encapsulate the deterministic logic used by the
 * loading screen component.
 *
 * Feature: 3d-codebase-globe-visualizer, Loading Screen Properties
 */

/**
 * The CSS transition duration (in ms) used for the loading screen fade-out.
 * Corresponds to Tailwind's `duration-300` class.
 */
export const LOADING_FADE_DURATION_MS = 300;

/**
 * Computes the loading progress percentage from current/total values.
 * Returns a value clamped to [0, 100], rounded to the nearest integer.
 *
 * @param current - Number of items processed so far (0 ≤ current ≤ total)
 * @param total - Total number of items to process (must be > 0)
 * @returns Integer percentage in [0, 100]
 */
export function computeProgress(current: number, total: number): number {
  if (total <= 0) return 0;
  const raw = (current / total) * 100;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

/**
 * Computes the visibility style object for the loading screen based on
 * the `isLoading` state.
 *
 * @param isLoading - Whether the loading screen should be visible
 * @returns Style object with `opacity` and `pointerEvents`
 */
export function computeLoadingVisibility(isLoading: boolean): {
  opacity: number;
  pointerEvents: "auto" | "none";
} {
  return {
    opacity: isLoading ? 1 : 0,
    pointerEvents: isLoading ? "auto" : "none",
  };
}
