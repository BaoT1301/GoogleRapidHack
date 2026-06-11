/**
 * Shared fast-check Arbitraries for Property-Based Testing
 *
 * Reusable arbitraries that generate valid domain objects matching
 * the Zod schemas in src/types/globe.ts and src/types/globe-r3f.ts.
 *
 * Feature: 3d-codebase-globe-visualizer, Property Test Infrastructure
 */

import * as fc from "fast-check";
import type { Cluster, ClusterConfig, GlobeNode, GlobeArc, EdgeType } from "../../types/globe";

// ---------------------------------------------------------------------------
// Primitive arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a valid hex color string matching `#[0-9A-Fa-f]{6}`.
 */
export const arbHexColor: fc.Arbitrary<string> = fc
  .stringMatching(/^[0-9A-Fa-f]{6}$/)
  .map((hex) => `#${hex}`);

/**
 * Generates one of the valid edge types from the MCP schema.
 */
export const arbEdgeType: fc.Arbitrary<EdgeType> = fc.constantFrom<EdgeType>(
  "imports",
  "calls",
  "defines",
  "reads",
  "writes",
  "references",
  "instantiates",
  "exports",
);

/**
 * Generates realistic file paths resembling a monorepo structure.
 * Examples: `backend/app/models/user.py`, `frontend/src/hooks/use-auth.ts`
 */
export const arbFilePath: fc.Arbitrary<string> = fc.oneof(
  // Python backend paths
  fc.tuple(
    fc.constantFrom("backend/app", "backend/app/models", "backend/app/routers", "backend/app/schemas"),
    fc.stringMatching(/^[a-z_]{1,20}$/),
    fc.constant(".py"),
  ).map(([dir, name, ext]) => `${dir}/${name}${ext}`),

  // TypeScript frontend paths
  fc.tuple(
    fc.constantFrom("frontend/src", "frontend/src/hooks", "frontend/src/components", "frontend/src/pages"),
    fc.stringMatching(/^[a-z\-]{1,20}$/),
    fc.constantFrom(".ts", ".tsx"),
  ).map(([dir, name, ext]) => `${dir}/${name}${ext}`),

  // Services paths
  fc.tuple(
    fc.constantFrom("services/mcp-context-manager/src", "services/mcp-context-ui/src"),
    fc.stringMatching(/^[a-z\-]{1,20}$/),
    fc.constantFrom(".ts", ".tsx"),
  ).map(([dir, name, ext]) => `${dir}/${name}${ext}`),
);

// ---------------------------------------------------------------------------
// Domain object arbitraries
// ---------------------------------------------------------------------------

/** Helper: generates a non-empty lowercase alphanumeric + dash identifier. */
const arbIdentifier = fc.stringMatching(/^[a-z][a-z0-9\-]{0,19}$/);

/**
 * Generates a valid `ClusterConfig` object — an array of 1–5 clusters
 * with valid id, relative path, label, and hex color.
 */
export const arbClusterConfig: fc.Arbitrary<ClusterConfig> = fc
  .array(
    fc.record<Cluster>({
      id: arbIdentifier,
      path: fc.stringMatching(/^[a-z0-9\-\/]{0,30}$/).filter((p) => !p.startsWith("/")),
      label: fc.string({ minLength: 1, maxLength: 30 }),
      color: arbHexColor,
    }),
    { minLength: 1, maxLength: 5 },
  )
  .map((clusters) => ({ clusters }));

/**
 * Generates a valid `GlobeNode` object with lat ∈ [-90, 90],
 * lng ∈ [-180, 180], a valid clusterId, and 0–10 function labels.
 */
export const arbGlobeNode: fc.Arbitrary<GlobeNode> = fc.record<GlobeNode>({
  id: fc.string({ minLength: 1, maxLength: 50 }),
  label: fc.string({ minLength: 1, maxLength: 30 }),
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
  altitude: fc.double({ min: 0, max: 1, noNaN: true }),
  color: arbHexColor,
  clusterId: arbIdentifier,
  functions: fc.array(
    fc.record({
      name: fc.stringMatching(/^[a-z_][a-z0-9_]{0,19}$/),
      signature: fc.string({ minLength: 1, maxLength: 50 }),
      type: fc.constantFrom("function" as const, "class" as const),
    }),
    { minLength: 0, maxLength: 10 },
  ),
});

/**
 * Generates a valid `GlobeArc` object with source/target ids,
 * a valid edge type, color, and dash settings.
 */
export const arbGlobeArc: fc.Arbitrary<GlobeArc> = fc.record<GlobeArc>({
  id: fc.string({ minLength: 1, maxLength: 50 }),
  source: fc.string({ minLength: 1, maxLength: 50 }),
  target: fc.string({ minLength: 1, maxLength: 50 }),
  type: arbEdgeType,
  color: arbHexColor,
  dashLength: fc.double({ min: 0, max: 10, noNaN: true }),
  dashGap: fc.double({ min: 0, max: 10, noNaN: true }),
  altitude: fc.double({ min: 0, max: 1, noNaN: true }),
  animated: fc.boolean(),
});
