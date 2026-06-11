/**
 * R3F Globe Visualization Type Definitions
 *
 * Types specific to the React Three Fiber multi-globe solar system (Phase 2).
 * Extends the base globe types with 3D scene positioning, cross-globe arcs,
 * layout persistence, and per-globe LOD state.
 */

import { z } from "zod";
import type { GlobeNode } from "./globe";

// ---------------------------------------------------------------------------
// GlobePosition — position of a globe in the 3D scene (world coordinates)
// ---------------------------------------------------------------------------
export const GlobePositionSchema = z.object({
  clusterId: z.string(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export type GlobePosition = z.infer<typeof GlobePositionSchema>;

// ---------------------------------------------------------------------------
// CrossGlobeArc — a dependency arc connecting nodes on different spheres
// ---------------------------------------------------------------------------
export interface CrossGlobeArc {
  id: string;
  sourceGlobeNode: GlobeNode;
  targetGlobeNode: GlobeNode;
  sourceClusterId: string;
  targetClusterId: string;
  edgeType: string;
  color: string;
}

// ---------------------------------------------------------------------------
// GlobeLayoutState — persisted layout for localStorage
// ---------------------------------------------------------------------------
export const GlobeLayoutStateSchema = z.object({
  positions: z.array(GlobePositionSchema),
  savedAt: z.number(),
});

export type GlobeLayoutState = z.infer<typeof GlobeLayoutStateSchema>;

// ---------------------------------------------------------------------------
// Per-globe LOD state
// ---------------------------------------------------------------------------
export interface GlobeLODState {
  clusterId: string;
  level: "far" | "medium" | "close";
  cameraDistance: number;
}
