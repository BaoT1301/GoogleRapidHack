/**
 * Edge Filter Tests
 *
 * Property 19: unchecked types are hidden (filtering logic)
 * Property 20: filter applies to all arcs uniformly
 */

import { describe, it, expect } from "vitest";
import type { Edge } from "../types/mcp";

// ---------------------------------------------------------------------------
// Pure filtering function extracted from Globe3DPhase1 logic
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
// Test data
// ---------------------------------------------------------------------------
const ALL_NODE_IDS = new Set(["a", "b", "c", "d"]);

const SAMPLE_EDGES: Edge[] = [
  { source: "a", target: "b", type: "imports" },
  { source: "a", target: "c", type: "calls" },
  { source: "b", target: "c", type: "defines" },
  { source: "c", target: "d", type: "reads" },
  { source: "d", target: "a", type: "writes" },
  { source: "a", target: "d", type: "references" },
  { source: "b", target: "d", type: "instantiates" },
  { source: "c", target: "a", type: "exports" },
];

const ALL_TYPES = new Set([
  "imports",
  "calls",
  "defines",
  "reads",
  "writes",
  "references",
  "instantiates",
  "exports",
]);

describe("Edge filtering logic", () => {
  // ── Property 19: unchecked types are hidden ─────────────────────────
  describe("Property 19: unchecked types are hidden", () => {
    it("returns all edges when all types are enabled", () => {
      const result = filterEdges(SAMPLE_EDGES, ALL_TYPES, ALL_NODE_IDS);
      expect(result).toHaveLength(SAMPLE_EDGES.length);
    });

    it("returns no edges when no types are enabled", () => {
      const result = filterEdges(SAMPLE_EDGES, new Set(), ALL_NODE_IDS);
      expect(result).toHaveLength(0);
    });

    it("hides only the unchecked type", () => {
      const enabled = new Set(ALL_TYPES);
      enabled.delete("imports");

      const result = filterEdges(SAMPLE_EDGES, enabled, ALL_NODE_IDS);
      expect(result.every((e) => e.type !== "imports")).toBe(true);
      expect(result).toHaveLength(SAMPLE_EDGES.length - 1);
    });

    it("shows only the checked type when a single type is enabled", () => {
      const enabled = new Set(["calls"]);
      const result = filterEdges(SAMPLE_EDGES, enabled, ALL_NODE_IDS);
      expect(result.every((e) => e.type === "calls")).toBe(true);
      expect(result).toHaveLength(1);
    });

    it("each edge type can be independently toggled", () => {
      for (const edgeType of ALL_TYPES) {
        const enabled = new Set([edgeType]);
        const result = filterEdges(SAMPLE_EDGES, enabled, ALL_NODE_IDS);
        expect(result.every((e) => e.type === edgeType)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
      }
    });
  });

  // ── Property 20: filter applies to all arcs ─────────────────────────
  describe("Property 20: filter applies to all arcs uniformly", () => {
    it("filters out ALL arcs of a disabled type, not just some", () => {
      const enabled = new Set(ALL_TYPES);
      enabled.delete("reads");

      const result = filterEdges(SAMPLE_EDGES, enabled, ALL_NODE_IDS);
      const readsCount = result.filter((e) => e.type === "reads").length;
      expect(readsCount).toBe(0);
    });

    it("does not filter arcs based on source/target when type is enabled", () => {
      // All types enabled, all nodes present → every edge passes
      const result = filterEdges(SAMPLE_EDGES, ALL_TYPES, ALL_NODE_IDS);
      expect(result).toEqual(SAMPLE_EDGES);
    });

    it("filters out arcs whose source or target is not in the node set", () => {
      const partialNodes = new Set(["a", "b"]);
      const result = filterEdges(SAMPLE_EDGES, ALL_TYPES, partialNodes);
      // Only edges where both source and target are in {a, b}
      expect(result.every((e) => partialNodes.has(e.source) && partialNodes.has(e.target))).toBe(true);
    });

    it("combining type filter and node filter works correctly", () => {
      const enabled = new Set(["imports"]);
      const partialNodes = new Set(["a", "b"]);
      const result = filterEdges(SAMPLE_EDGES, enabled, partialNodes);
      // Only a→b imports edge should pass
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe("a");
      expect(result[0].target).toBe("b");
      expect(result[0].type).toBe("imports");
    });
  });
});
