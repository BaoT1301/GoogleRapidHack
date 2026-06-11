/**
 * Globe Constants
 *
 * Shared constants for the 3D Globe Visualizer.
 * Extracted from Globe3DPhase2.tsx for testability and single-source-of-truth.
 *
 * Feature: 3d-codebase-globe-visualizer
 */

// ---------------------------------------------------------------------------
// Camera Constraints (OrbitControls)
// ---------------------------------------------------------------------------

/** Minimum camera distance from the scene origin. */
export const CAMERA_MIN_DISTANCE = 3;

/** Maximum camera distance from the scene origin. */
export const CAMERA_MAX_DISTANCE = 50;

// ---------------------------------------------------------------------------
// Camera Utilities
// ---------------------------------------------------------------------------

/**
 * Clamp a camera distance to the allowed range [min, max].
 * If distance < min, returns min. If distance > max, returns max.
 * Otherwise returns the distance unchanged.
 */
export function clampCameraDistance(
  distance: number,
  min: number = CAMERA_MIN_DISTANCE,
  max: number = CAMERA_MAX_DISTANCE,
): number {
  if (distance < min) return min;
  if (distance > max) return max;
  return distance;
}

// ---------------------------------------------------------------------------
// LOD Transition & Performance Warning
// ---------------------------------------------------------------------------

/**
 * LOD transition animation duration in milliseconds.
 * When the LOD level changes (e.g., far → medium), the visual transition
 * animates over this duration. Matches the R3F component transition config.
 */
export const LOD_TRANSITION_DURATION_MS = 200;

/**
 * Performance warning threshold: the "Show All Details" toggle displays
 * a performance warning modal when the total node count exceeds this value.
 */
export const PERFORMANCE_WARNING_NODE_THRESHOLD = 2000;

/**
 * Pure function: determines whether the performance warning should be shown.
 * Returns `true` when `nodeCount` exceeds {@link PERFORMANCE_WARNING_NODE_THRESHOLD}.
 *
 * @param nodeCount - Total number of nodes in the current graph.
 * @returns Whether the performance warning modal should be displayed.
 */
export function shouldShowPerformanceWarning(nodeCount: number): boolean {
  return nodeCount > PERFORMANCE_WARNING_NODE_THRESHOLD;
}
