/**
 * Globe Physics Utilities
 *
 * Pure functions extracted from Globe3DPhase2.tsx for testability.
 * Handles collision detection, coordinate conversion, position persistence,
 * and default layout computation.
 *
 * Feature: 3d-codebase-globe-visualizer
 */

import type { GlobePosition } from "../../types/globe-r3f";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const GLOBE_RADIUS = 2;
export const LAYOUT_RADIUS = 5;
export const STORAGE_KEY = "mcp-globe-layout";

// ---------------------------------------------------------------------------
// Collision Detection
// ---------------------------------------------------------------------------

/**
 * Detects whether any two globes in the given positions array overlap.
 * Two globes overlap when the Euclidean distance between their centers
 * is less than `2 * globeRadius`.
 */
export function detectCollision(
  positions: GlobePosition[],
  globeRadius: number,
): boolean {
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dist = Math.sqrt(
        (positions[i].x - positions[j].x) ** 2 +
        (positions[i].y - positions[j].y) ** 2 +
        (positions[i].z - positions[j].z) ** 2,
      );
      if (dist < 2 * globeRadius) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Coordinate Conversion
// ---------------------------------------------------------------------------

/**
 * Convert lat/lng to world position offset from globe center.
 * Returns a point on the sphere surface at the given radius from globeCenter.
 */
export function latLngToWorld(
  lat: number,
  lng: number,
  radius: number,
  globeCenter: [number, number, number],
): [number, number, number] {
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  return [
    globeCenter[0] + radius * Math.cos(latRad) * Math.cos(lngRad),
    globeCenter[1] + radius * Math.sin(latRad),
    globeCenter[2] + radius * Math.cos(latRad) * Math.sin(lngRad),
  ];
}

// ---------------------------------------------------------------------------
// Position Persistence
// ---------------------------------------------------------------------------

/**
 * Save positions to localStorage.
 */
export function savePositions(positions: GlobePosition[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ positions, savedAt: Date.now() }),
    );
  } catch {
    // Silently ignore storage errors
  }
}

/**
 * Load persisted positions from localStorage. Returns null if invalid
 * or if the persisted cluster IDs don't match the provided clusterIds.
 */
export function loadPersistedPositions(clusterIds: string[]): GlobePosition[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { positions?: GlobePosition[]; savedAt?: number };
    if (!Array.isArray(parsed.positions)) return null;

    // Validate that persisted positions match current cluster IDs
    const persistedIds = new Set(parsed.positions.map((p) => p.clusterId));
    const currentIds = new Set(clusterIds);
    if (persistedIds.size !== currentIds.size) return null;
    for (const id of currentIds) {
      if (!persistedIds.has(id)) return null;
    }
    return parsed.positions;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Default Layout Computation
// ---------------------------------------------------------------------------

/**
 * Compute default globe positions arranged in a circle in the XZ plane.
 */
export function computeDefaultPositions(clusterIds: string[]): GlobePosition[] {
  const n = clusterIds.length;
  return clusterIds.map((id, i) => ({
    clusterId: id,
    x: n === 1 ? 0 : LAYOUT_RADIUS * Math.cos((2 * Math.PI * i) / n),
    y: 0,
    z: n === 1 ? 0 : LAYOUT_RADIUS * Math.sin((2 * Math.PI * i) / n),
  }));
}

// ---------------------------------------------------------------------------
// Drag Position Update
// ---------------------------------------------------------------------------

/**
 * Apply a drag delta to a specific globe position.
 * Returns a new positions array with only the dragged globe's x/z updated.
 */
export function applyDragDelta(
  positions: GlobePosition[],
  dragIndex: number,
  dx: number,
  dz: number,
): GlobePosition[] {
  return positions.map((p, i) => {
    if (i !== dragIndex) return p;
    return { ...p, x: p.x + dx, z: p.z + dz };
  });
}
