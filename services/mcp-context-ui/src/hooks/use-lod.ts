/**
 * useLOD Hook — Level of Detail
 *
 * Determines which visual elements to show based on camera distance
 * relative to the globe radius. This keeps the visualization performant
 * by hiding details when zoomed out.
 *
 * LOD Levels:
 *   Far    (ratio > 3):     File nodes only — no arcs, labels, or badges
 *   Medium (1.5 ≤ ratio ≤ 3): Nodes + function count badges
 *   Close  (ratio < 1.5):   Everything visible
 */

import { useMemo } from "react";

export interface LODState {
  level: "far" | "medium" | "close";
  showFunctionLabels: boolean;
  showDirectedArcs: boolean;
  showFunctionBadges: boolean;
}

/**
 * Compute the current LOD state from camera distance and globe radius.
 *
 * @param cameraDistance - Distance from the camera to the globe center
 * @param globeRadius   - Radius of the globe
 */
export function useLOD(cameraDistance: number, globeRadius: number): LODState {
  return useMemo(() => {
    return computeLOD(cameraDistance, globeRadius);
  }, [cameraDistance, globeRadius]);
}

/**
 * Pure function for LOD computation — also used directly in tests.
 */
export function computeLOD(cameraDistance: number, globeRadius: number): LODState {
  const ratio = globeRadius === 0 ? Infinity : cameraDistance / globeRadius;

  if (ratio > 3) {
    return {
      level: "far",
      showFunctionLabels: false,
      showDirectedArcs: false,
      showFunctionBadges: false,
    };
  }

  if (ratio >= 1.5) {
    return {
      level: "medium",
      showFunctionLabels: false,
      showDirectedArcs: false,
      showFunctionBadges: true,
    };
  }

  return {
    level: "close",
    showFunctionLabels: true,
    showDirectedArcs: true,
    showFunctionBadges: true,
  };
}
