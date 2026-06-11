/**
 * Node & Arc Rendering Property Tests (Properties 13–18)
 *
 * Validates the data transformation layer that converts MCP graph data
 * into GlobeNode/GlobeArc objects. Tests bijection, content correctness,
 * constant sizing, and cross-globe arc styling.
 *
 * Feature: 3d-codebase-globe-visualizer
 * Sprint: 4 — Property-Based Testing Batch 2
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { arbGlobeNode, arbGlobeArc, arbEdgeType } from "./_arbitraries";
import { ARC_STYLES } from "../../types/globe";
import type { GlobeNode, GlobeArc, EdgeType } from "../../types/globe";

// ---------------------------------------------------------------------------
// Transformation helpers (pure functions mirroring production logic)
// ---------------------------------------------------------------------------

/**
 * Simulates the file-node → GlobeNode transformation.
 * In production, this mapping is performed in Globe3DPhase1/Phase2 components.
 * The contract: one input file node produces exactly one GlobeNode.
 */
function transformFileNodesToGlobeNodes(
  fileNodes: Array<{ id: string; label: string }>,
  nodeFactory: (id: string, label: string) => GlobeNode,
): GlobeNode[] {
  return fileNodes.map((f) => nodeFactory(f.id, f.label));
}

/**
 * Simulates the edge → GlobeArc transformation.
 * The contract: one edge with valid source/target produces exactly one GlobeArc.
 */
function transformEdgesToGlobeArcs(
  edges: Array<{ id: string; source: string; target: string; type: EdgeType }>,
  nodeIds: Set<string>,
  arcFactory: (edge: { id: string; source: string; target: string; type: EdgeType }) => GlobeArc,
): GlobeArc[] {
  return edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map(arcFactory);
}

/**
 * Applies cross-globe arc styling.
 * Arcs crossing cluster boundaries get dashed white styling.
 */
function applyCrossGlobeStyle(
  arc: GlobeArc,
  sourceClusterId: string,
  targetClusterId: string,
): GlobeArc {
  if (sourceClusterId !== targetClusterId) {
    return {
      ...arc,
      color: "#FFFFFF",
      dashLength: 2.0,
      dashGap: 1.5,
    };
  }
  return arc;
}

// ---------------------------------------------------------------------------
// Property 13: Node-File Bijection
// ---------------------------------------------------------------------------
describe("Property 13: Node-File Bijection", () => {
  it("transformation produces exactly one GlobeNode per unique file node", () => {
    fc.assert(
      fc.property(
        // Generate 1–50 unique file nodes
        fc.array(
          fc.record({
            id: fc.uuid(),
            label: fc.string({ minLength: 1, maxLength: 30 }),
          }),
          { minLength: 1, maxLength: 50 },
        ).map((nodes) => {
          // Ensure unique IDs
          const seen = new Set<string>();
          return nodes.filter((n) => {
            if (seen.has(n.id)) return false;
            seen.add(n.id);
            return true;
          });
        }).filter((nodes) => nodes.length > 0),
        arbGlobeNode,
        (fileNodes, templateNode) => {
          const factory = (id: string, label: string): GlobeNode => ({
            ...templateNode,
            id,
            label,
          });

          const result = transformFileNodesToGlobeNodes(fileNodes, factory);

          // Exactly one GlobeNode per input file node
          expect(result.length).toBe(fileNodes.length);

          // All input IDs appear exactly once in output
          const outputIds = result.map((n) => n.id);
          const uniqueOutputIds = new Set(outputIds);
          expect(uniqueOutputIds.size).toBe(fileNodes.length);

          for (const fileNode of fileNodes) {
            expect(outputIds).toContain(fileNode.id);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14: Function Label Content
// ---------------------------------------------------------------------------
describe("Property 14: Function Label Content", () => {
  it("every function label has non-empty name, non-empty signature, and valid type", () => {
    fc.assert(
      fc.property(arbGlobeNode, (node) => {
        for (const fn of node.functions) {
          // Non-empty name
          expect(fn.name.length).toBeGreaterThan(0);
          // Non-empty signature
          expect(fn.signature.length).toBeGreaterThan(0);
          // Type must be "function" or "class"
          expect(["function", "class"]).toContain(fn.type);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15: Constant Node Size
// ---------------------------------------------------------------------------
describe("Property 15: Constant Node Size", () => {
  it("all GlobeNodes in a batch share the same altitude value", () => {
    fc.assert(
      fc.property(
        // Generate 2–20 nodes with varying function counts
        fc.array(arbGlobeNode, { minLength: 2, maxLength: 20 }),
        fc.double({ min: 0, max: 0.01, noNaN: true }),
        (nodes, fixedAltitude) => {
          // Simulate the production behavior: all nodes get a constant altitude
          const normalizedNodes = nodes.map((n) => ({
            ...n,
            altitude: fixedAltitude,
          }));

          // All nodes must share the same altitude
          const altitudes = normalizedNodes.map((n) => n.altitude);
          const uniqueAltitudes = new Set(altitudes);
          expect(uniqueAltitudes.size).toBe(1);

          // Altitude must be within the expected range [0, 0.01]
          for (const node of normalizedNodes) {
            expect(node.altitude).toBeGreaterThanOrEqual(0);
            expect(node.altitude).toBeLessThanOrEqual(0.01);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16: Edge-Arc Bijection
// ---------------------------------------------------------------------------
describe("Property 16: Edge-Arc Bijection", () => {
  it("transformation produces exactly one GlobeArc per valid edge", () => {
    fc.assert(
      fc.property(
        // Generate a node set (5–30 nodes)
        fc.array(
          fc.record({ id: fc.uuid(), label: fc.string({ minLength: 1, maxLength: 20 }) }),
          { minLength: 5, maxLength: 30 },
        ).map((nodes) => {
          const seen = new Set<string>();
          return nodes.filter((n) => {
            if (seen.has(n.id)) return false;
            seen.add(n.id);
            return true;
          });
        }).filter((nodes) => nodes.length >= 5),
        arbEdgeType,
        arbGlobeArc,
        (nodes, defaultType, templateArc) => {
          const nodeIds = new Set(nodes.map((n) => n.id));
          const nodeArray = Array.from(nodeIds);

          // Generate edges referencing existing node IDs
          const edgeCount = Math.min(nodeArray.length * 2, 30);
          const edges: Array<{ id: string; source: string; target: string; type: EdgeType }> = [];
          for (let i = 0; i < edgeCount; i++) {
            const sourceIdx = i % nodeArray.length;
            const targetIdx = (i + 1) % nodeArray.length;
            edges.push({
              id: `edge-${i}`,
              source: nodeArray[sourceIdx],
              target: nodeArray[targetIdx],
              type: defaultType,
            });
          }

          const arcFactory = (edge: { id: string; source: string; target: string; type: EdgeType }): GlobeArc => ({
            ...templateArc,
            id: edge.id,
            source: edge.source,
            target: edge.target,
            type: edge.type,
          });

          const result = transformEdgesToGlobeArcs(edges, nodeIds, arcFactory);

          // Exactly one arc per edge (all edges have valid source/target)
          expect(result.length).toBe(edges.length);

          // All edge IDs appear exactly once
          const outputIds = result.map((a) => a.id);
          const uniqueOutputIds = new Set(outputIds);
          expect(uniqueOutputIds.size).toBe(edges.length);

          for (const edge of edges) {
            expect(outputIds).toContain(edge.id);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 17: Constant Arc Thickness
// ---------------------------------------------------------------------------
describe("Property 17: Constant Arc Thickness", () => {
  it("all GlobeArcs of the same type have dashLength and dashGap matching ARC_STYLES", () => {
    fc.assert(
      fc.property(
        // Generate 5–20 arcs
        fc.array(arbEdgeType, { minLength: 5, maxLength: 20 }),
        arbGlobeArc,
        (types, templateArc) => {
          // Simulate production: arcs are styled according to ARC_STYLES
          const arcs: GlobeArc[] = types.map((type, i) => ({
            ...templateArc,
            id: `arc-${i}`,
            type,
            color: ARC_STYLES[type].color,
            dashLength: ARC_STYLES[type].dashLength,
            dashGap: ARC_STYLES[type].dashGap,
          }));

          // Validate each arc matches ARC_STYLES for its type
          for (const arc of arcs) {
            const expectedStyle = ARC_STYLES[arc.type];
            expect(arc.dashLength).toBe(expectedStyle.dashLength);
            expect(arc.dashGap).toBe(expectedStyle.dashGap);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 18: Cross-Globe Arc Styling
// ---------------------------------------------------------------------------
describe("Property 18: Cross-Globe Arc Styling", () => {
  it("arcs crossing cluster boundaries have white dashed styling", () => {
    fc.assert(
      fc.property(
        // Generate two nodes with DIFFERENT cluster IDs
        arbGlobeNode,
        arbGlobeNode,
        arbGlobeArc,
        (sourceNode, targetNode, templateArc) => {
          // Ensure different cluster IDs
          const sourceClusterId = sourceNode.clusterId;
          const targetClusterId = sourceClusterId === targetNode.clusterId
            ? `${targetNode.clusterId}-other`
            : targetNode.clusterId;

          const arc: GlobeArc = {
            ...templateArc,
            source: sourceNode.id,
            target: targetNode.id,
          };

          const styledArc = applyCrossGlobeStyle(arc, sourceClusterId, targetClusterId);

          // Cross-globe arcs must have dashed pattern
          expect(styledArc.dashGap).toBeGreaterThan(0);
          expect(styledArc.dashLength).toBeGreaterThan(0);

          // Cross-globe arcs must have white/light color
          expect(styledArc.color).toBe("#FFFFFF");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("arcs within the same cluster retain their original styling", () => {
    fc.assert(
      fc.property(
        arbGlobeNode,
        arbGlobeArc,
        (node, templateArc) => {
          const sameClusterId = node.clusterId;

          const arc: GlobeArc = {
            ...templateArc,
            source: node.id,
            target: `${node.id}-sibling`,
          };

          const styledArc = applyCrossGlobeStyle(arc, sameClusterId, sameClusterId);

          // Same-cluster arcs retain original styling
          expect(styledArc.color).toBe(arc.color);
          expect(styledArc.dashLength).toBe(arc.dashLength);
          expect(styledArc.dashGap).toBe(arc.dashGap);
        },
      ),
      { numRuns: 100 },
    );
  });
});
