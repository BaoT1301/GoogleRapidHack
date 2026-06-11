/**
 * Edge Filtering Property Tests (Properties 19–21)
 *
 * Validates the edge filtering logic: unchecked types are hidden,
 * filters apply globally, and filter updates are responsive.
 *
 * The `filterEdges` pure function is duplicated here from
 * `src/__tests__/edge-filter.test.ts` to avoid invasive refactoring.
 * Tech debt: extract to `src/utils/edge-filter.ts` in a future sprint.
 *
 * Feature: 3d-codebase-globe-visualizer
 * Sprint: 4 — Property-Based Testing Batch 2
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { arbEdgeType } from "./_arbitraries";
import type { Edge } from "../../types/mcp";
import type { EdgeType } from "../../types/globe";

// ---------------------------------------------------------------------------
// Pure filtering function (duplicated from edge-filter.test.ts)
// Source of truth: Globe3DPhase1 component filtering logic
// ---------------------------------------------------------------------------
function filterEdges(
  edges: Edge[],
  enabledTypes: Set<string>,
  filteredNodeIds: Set<string>,
): Edge[] {
  return edges.filter((edge) => {
    if (!enabledTypes.has(edge.type)) return false;
    if (!filteredNodeIds.has(edge.source)) return false;
    if (!filteredNodeIds.has(edge.target)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// All valid edge types
// ---------------------------------------------------------------------------
const ALL_EDGE_TYPES: EdgeType[] = [
  "imports",
  "calls",
  "defines",
  "reads",
  "writes",
  "references",
  "instantiates",
  "exports",
];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a random subset of edge types (1–8 types enabled). */
const arbEnabledTypes: fc.Arbitrary<Set<string>> = fc
  .subarray(ALL_EDGE_TYPES, { minLength: 1, maxLength: 8 })
  .map((types) => new Set(types));

/** Generates a set of node IDs (5–20 unique IDs). */
const arbNodeIdSet: fc.Arbitrary<Set<string>> = fc
  .array(fc.uuid(), { minLength: 5, maxLength: 20 })
  .map((ids) => new Set(ids));

/** Generates edges referencing node IDs from a given set. */
function arbEdgesForNodes(nodeIds: Set<string>): fc.Arbitrary<Edge[]> {
  const nodeArray = Array.from(nodeIds);
  if (nodeArray.length < 2) {
    return fc.constant([]);
  }
  return fc
    .array(
      fc.record({
        sourceIdx: fc.nat({ max: nodeArray.length - 1 }),
        targetIdx: fc.nat({ max: nodeArray.length - 1 }),
        type: arbEdgeType,
      }),
      { minLength: 5, maxLength: 50 },
    )
    .map((specs) =>
      specs.map((spec) => ({
        source: nodeArray[spec.sourceIdx],
        target: nodeArray[spec.targetIdx],
        type: spec.type,
      })),
    );
}

// ---------------------------------------------------------------------------
// Property 19: Edge Type Filter Effectiveness
// ---------------------------------------------------------------------------
describe("Property 19: Edge Type Filter Effectiveness", () => {
  it("filtered output contains ONLY edges whose type is in the enabled set", () => {
    fc.assert(
      fc.property(
        arbNodeIdSet.chain((nodeIds) =>
          fc.tuple(
            fc.constant(nodeIds),
            arbEdgesForNodes(nodeIds),
            arbEnabledTypes,
          ),
        ),
        ([nodeIds, edges, enabledTypes]) => {
          const result = filterEdges(edges, enabledTypes, nodeIds);

          // Every edge in the result must have an enabled type
          for (const edge of result) {
            expect(enabledTypes.has(edge.type)).toBe(true);
          }

          // The result count must match the expected count
          const expectedCount = edges.filter(
            (e) =>
              enabledTypes.has(e.type) &&
              nodeIds.has(e.source) &&
              nodeIds.has(e.target),
          ).length;
          expect(result.length).toBe(expectedCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 20: Global Filter Application
// ---------------------------------------------------------------------------
describe("Property 20: Global Filter Application", () => {
  it("disabling a type removes ALL edges of that type from the output", () => {
    fc.assert(
      fc.property(
        arbNodeIdSet.chain((nodeIds) =>
          fc.tuple(
            fc.constant(nodeIds),
            arbEdgesForNodes(nodeIds),
            arbEdgeType, // The type to disable
          ),
        ),
        ([nodeIds, edges, disabledType]) => {
          // Enable all types EXCEPT the disabled one
          const enabledTypes = new Set<string>(
            ALL_EDGE_TYPES.filter((t) => t !== disabledType),
          );

          const result = filterEdges(edges, enabledTypes, nodeIds);

          // Count of the disabled type in output must be exactly 0
          const disabledCount = result.filter(
            (e) => e.type === disabledType,
          ).length;
          expect(disabledCount).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 21: Filter Update Responsiveness
// ---------------------------------------------------------------------------
describe("Property 21: Filter Update Responsiveness", () => {
  it("toggling a type from disabled→enabled adds back exactly the edges of that type", () => {
    fc.assert(
      fc.property(
        arbNodeIdSet.chain((nodeIds) =>
          fc.tuple(
            fc.constant(nodeIds),
            arbEdgesForNodes(nodeIds),
            arbEdgeType, // The type to toggle
          ),
        ),
        ([nodeIds, edges, toggledType]) => {
          // State 1: type disabled
          const disabledSet = new Set<string>(
            ALL_EDGE_TYPES.filter((t) => t !== toggledType),
          );
          const disabledResult = filterEdges(edges, disabledSet, nodeIds);

          // State 2: type enabled (all types enabled)
          const enabledSet = new Set<string>(ALL_EDGE_TYPES);
          const enabledResult = filterEdges(edges, enabledSet, nodeIds);

          // The delta must equal exactly the edges of the toggled type
          // that also pass the node filter
          const expectedDelta = edges.filter(
            (e) =>
              e.type === toggledType &&
              nodeIds.has(e.source) &&
              nodeIds.has(e.target),
          ).length;

          expect(enabledResult.length - disabledResult.length).toBe(
            expectedDelta,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
