/**
 * useMultiGlobeLOD Hook — Per-Globe Level of Detail
 *
 * Computes LOD state for each globe in the multi-globe scene based on
 * the camera's distance to each globe center. Uses the same thresholds
 * as the Phase 1 single-globe LOD system.
 *
 * LOD Levels (relative to globe radius R):
 *   Far    (distance > 3R):     Nodes only
 *   Medium (1.5R ≤ distance ≤ 3R): Nodes + function count badges
 *   Close  (distance < 1.5R):   Everything visible
 */

import { useMemo } from "react";
import type { GlobeLODState } from "../types/globe-r3f";

/**
 * Pure function for multi-globe LOD computation.
 *
 * @param globePositions - Array of [x, y, z] positions for each globe
 * @param cameraPosition - Current camera [x, y, z] position
 * @param globeRadius    - Radius of each globe
 * @param clusterIds     - Array of cluster IDs matching globePositions order
 */
export function computeMultiGlobeLOD(
  globePositions: [number, number, number][],
  cameraPosition: [number, number, number],
  globeRadius: number,
  clusterIds: string[],
): GlobeLODState[] {
  return globePositions.map((pos, i) => {
    const dx = cameraPosition[0] - pos[0];
    const dy = cameraPosition[1] - pos[1];
    const dz = cameraPosition[2] - pos[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const ratio = globeRadius === 0 ? Infinity : distance / globeRadius;

    let level: "far" | "medium" | "close";
    if (ratio > 3) {
      level = "far";
    } else if (ratio >= 1.5) {
      level = "medium";
    } else {
      level = "close";
    }

    return {
      clusterId: clusterIds[i] ?? `globe-${i}`,
      level,
      cameraDistance: distance,
    };
  });
}

/**
 * React hook wrapper for multi-globe LOD computation.
 * Accepts globe positions without cluster IDs — uses index-based fallback.
 * For full cluster ID support, pass clusterIds separately.
 */
export function useMultiGlobeLOD(
  globePositions: [number, number, number][],
  cameraPosition: [number, number, number],
  globeRadius: number,
  clusterIds?: string[],
): GlobeLODState[] {
  return useMemo(() => {
    const ids = clusterIds ?? globePositions.map((_, i) => `globe-${i}`);
    return computeMultiGlobeLOD(globePositions, cameraPosition, globeRadius, ids);
  }, [globePositions, cameraPosition, globeRadius, clusterIds]);
}
