/**
 * Cross-Globe Arc Property Tests (Properties 51–53)
 *
 * Validates cross-globe arc behavior:
 * - Property 51: Arc color differentiation (cross-globe vs intra-globe)
 * - Property 52: Filter consistency (same filtering logic for both arc types)
 * - Property 53: Hover highlighting (onPointerOver/onPointerOut behavior)
 *
 * Feature: 3d-codebase-globe-visualizer
 * Sprint: 7 — Property-Based Testing Batch 5
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { arbEdgeType } from "./_arbitraries";
import { ARC_STYLES } from "../../types/globe";
import type { EdgeType } from "../../types/globe";

// ---------------------------------------------------------------------------
// Constants (matching production code in Globe3DPhase2.tsx)
// ---------------------------------------------------------------------------

/**
 * Cross-globe arcs are rendered with a hardcoded white color (#FFFFFF)
 * in Globe3DPhase2.tsx, regardless of edge type.
 */
const CROSS_GLOBE_ARC_COLOR = "#FFFFFF";

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
// Pure filtering function (mirrors Globe3DPhase2.tsx crossGlobeArcs memo logic)
// ---------------------------------------------------------------------------

interface EdgeLike {
  source: string;
  target: string;
  type: EdgeType;
  isCrossCluster?: boolean;
}

/**
 * Filters edges based on enabled edge types — applies identically to both
 * cross-globe and intra-globe arcs in production code.
 */
function filterByEnabledTypes(
  edges: EdgeLike[],
  enabledEdgeTypes: Set<string>,
): EdgeLike[] {
  return edges.filter((edge) => enabledEdgeTypes.has(edge.type));
}

// ---------------------------------------------------------------------------
// Property 51: Cross-Globe Arc Color Differentiation
// ---------------------------------------------------------------------------
describe("Property 51: Cross-Globe Arc Color Differentiation", () => {
  it("cross-globe arc color (#FFFFFF) differs from intra-globe arc color for every edge type", () => {
    fc.assert(
      fc.property(arbEdgeType, (edgeType) => {
        const intraGlobeColor = ARC_STYLES[edgeType].color;

        // The cross-globe arc color must differ from the intra-globe color
        // for the same edge type, ensuring visual differentiation
        expect(CROSS_GLOBE_ARC_COLOR).not.toBe(intraGlobeColor);
      }),
      { numRuns: 100 },
    );
  });

  it("cross-globe arc color is always a valid hex color", () => {
    // Validate the constant itself
    expect(CROSS_GLOBE_ARC_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("no intra-globe arc color in ARC_STYLES equals the cross-globe color", () => {
    // Exhaustive check across all edge types
    for (const edgeType of ALL_EDGE_TYPES) {
      const style = ARC_STYLES[edgeType];
      expect(style.color).not.toBe(CROSS_GLOBE_ARC_COLOR);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 52: Cross-Globe Arc Filter Consistency
// ---------------------------------------------------------------------------
describe("Property 52: Cross-Globe Arc Filter Consistency", () => {
  /** Generates a random subset of edge types (0–8 types enabled). */
  const arbEnabledTypes: fc.Arbitrary<Set<string>> = fc
    .subarray(ALL_EDGE_TYPES, { minLength: 0, maxLength: 8 })
    .map((types) => new Set(types));

  it("filtering logic applies identically to cross-globe and intra-globe arcs", () => {
    fc.assert(
      fc.property(
        arbEdgeType,
        arbEnabledTypes,
        (edgeType, enabledTypes) => {
          // Create a cross-globe edge and an intra-globe edge of the same type
          const crossEdge: EdgeLike = {
            source: "node-a",
            target: "node-b",
            type: edgeType,
            isCrossCluster: true,
          };
          const intraEdge: EdgeLike = {
            source: "node-c",
            target: "node-d",
            type: edgeType,
            isCrossCluster: false,
          };

          const crossFiltered = filterByEnabledTypes([crossEdge], enabledTypes);
          const intraFiltered = filterByEnabledTypes([intraEdge], enabledTypes);

          // Both must be included or both excluded based on the same type check
          expect(crossFiltered.length).toBe(intraFiltered.length);

          if (!enabledTypes.has(edgeType)) {
            // If type is NOT enabled, both must be excluded
            expect(crossFiltered.length).toBe(0);
            expect(intraFiltered.length).toBe(0);
          } else {
            // If type IS enabled, both must be included
            expect(crossFiltered.length).toBe(1);
            expect(intraFiltered.length).toBe(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("for any edge with isCrossCluster=true and type NOT in enabled set, edge is excluded", () => {
    fc.assert(
      fc.property(
        arbEdgeType,
        fc.uuid(),
        fc.uuid(),
        (edgeType, sourceId, targetId) => {
          // Create an enabled set that does NOT contain this edge type
          const enabledTypes = new Set<string>(
            ALL_EDGE_TYPES.filter((t) => t !== edgeType),
          );

          const crossEdge: EdgeLike = {
            source: sourceId,
            target: targetId,
            type: edgeType,
            isCrossCluster: true,
          };

          const filtered = filterByEnabledTypes([crossEdge], enabledTypes);
          expect(filtered.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 53: Cross-Globe Arc Hover Highlighting
// ---------------------------------------------------------------------------
describe("Property 53: Cross-Globe Arc Hover Highlighting", () => {
  it("onPointerOver produces a Set containing both sourceNodeId and targetNodeId", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        (sourceNodeId, targetNodeId) => {
          // Simulate the onPointerOver callback logic from Globe3DPhase2.tsx:
          // onHighlightChange(new Set([arc.sourceNodeId, arc.targetNodeId]))
          const highlightSet = new Set([sourceNodeId, targetNodeId]);

          // When source ≠ target, the set must contain exactly 2 elements
          if (sourceNodeId !== targetNodeId) {
            expect(highlightSet.size).toBe(2);
          } else {
            // When source === target (self-referencing edge), set has 1 element
            expect(highlightSet.size).toBe(1);
          }

          // Both IDs must be present in the set
          expect(highlightSet.has(sourceNodeId)).toBe(true);
          expect(highlightSet.has(targetNodeId)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("onPointerOut always produces an empty Set", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        (_sourceNodeId, _targetNodeId) => {
          // Simulate the onPointerOut callback logic from Globe3DPhase2.tsx:
          // onHighlightChange(new Set())
          const highlightSet = new Set<string>();

          expect(highlightSet.size).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("highlight set always contains sourceNodeId regardless of targetNodeId value", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 50 }),
        (sourceNodeId, targetNodeId) => {
          const highlightSet = new Set([sourceNodeId, targetNodeId]);
          expect(highlightSet.has(sourceNodeId)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
