/**
 * Cross-Globe Arc Detection Tests
 *
 * Tests the logic for detecting cross-cluster edges using the server-side
 * isCrossCluster flag and the client-side clusterId fallback.
 */

import { describe, it, expect } from "vitest";
import type { Edge } from "../types/mcp";

// Replicate the cross-globe arc detection logic from Globe3DPhase2
// to test it in isolation.

interface CrossArcResult {
  edgeId: string;
  sourceClusterId: string;
  targetClusterId: string;
  isCross: boolean;
}

function detectCrossGlobeArcs(
  edges: Edge[],
  nodeClusterMap: Map<string, string>,
): CrossArcResult[] {
  return edges.map((edge) => {
    const srcCluster = nodeClusterMap.get(edge.source) ?? "unknown";
    const tgtCluster = nodeClusterMap.get(edge.target) ?? "unknown";

    let isCross: boolean;
    if (edge.isCrossCluster !== undefined) {
      // Prefer server-side flag
      isCross = edge.isCrossCluster;
    } else {
      // Fallback: client-side comparison
      isCross = Boolean(srcCluster && tgtCluster && srcCluster !== tgtCluster);
    }

    return {
      edgeId: `${edge.source}-${edge.target}-${edge.type}`,
      sourceClusterId: srcCluster,
      targetClusterId: tgtCluster,
      isCross,
    };
  });
}

describe("Cross-Globe Arc Detection", () => {
  const nodeClusterMap = new Map<string, string>([
    ["file:backend/main.py", "backend"],
    ["file:backend/utils.py", "backend"],
    ["file:frontend/App.tsx", "frontend"],
    ["file:services/api.ts", "mcp-services"],
  ]);

  describe("with server-side isCrossCluster flag", () => {
    it("detects cross-cluster edges when isCrossCluster is true", () => {
      const edges: Edge[] = [
        {
          source: "file:backend/main.py",
          target: "file:frontend/App.tsx",
          type: "imports",
          isCrossCluster: true,
        },
      ];

      const result = detectCrossGlobeArcs(edges, nodeClusterMap);

      expect(result).toHaveLength(1);
      expect(result[0].isCross).toBe(true);
      expect(result[0].sourceClusterId).toBe("backend");
      expect(result[0].targetClusterId).toBe("frontend");
    });

    it("identifies same-cluster edges when isCrossCluster is false", () => {
      const edges: Edge[] = [
        {
          source: "file:backend/main.py",
          target: "file:backend/utils.py",
          type: "imports",
          isCrossCluster: false,
        },
      ];

      const result = detectCrossGlobeArcs(edges, nodeClusterMap);

      expect(result).toHaveLength(1);
      expect(result[0].isCross).toBe(false);
      expect(result[0].sourceClusterId).toBe("backend");
      expect(result[0].targetClusterId).toBe("backend");
    });

    it("trusts server flag even if client-side would disagree", () => {
      // Edge between same cluster but server says cross-cluster
      const edges: Edge[] = [
        {
          source: "file:backend/main.py",
          target: "file:backend/utils.py",
          type: "calls",
          isCrossCluster: true, // Server says cross (maybe cluster config changed)
        },
      ];

      const result = detectCrossGlobeArcs(edges, nodeClusterMap);
      expect(result[0].isCross).toBe(true);
    });
  });

  describe("with client-side fallback (no isCrossCluster flag)", () => {
    it("detects cross-cluster edges by comparing clusterIds", () => {
      const edges: Edge[] = [
        {
          source: "file:backend/main.py",
          target: "file:services/api.ts",
          type: "imports",
          // No isCrossCluster field
        },
      ];

      const result = detectCrossGlobeArcs(edges, nodeClusterMap);

      expect(result).toHaveLength(1);
      expect(result[0].isCross).toBe(true);
    });

    it("identifies same-cluster edges by comparing clusterIds", () => {
      const edges: Edge[] = [
        {
          source: "file:backend/main.py",
          target: "file:backend/utils.py",
          type: "defines",
          // No isCrossCluster field
        },
      ];

      const result = detectCrossGlobeArcs(edges, nodeClusterMap);

      expect(result).toHaveLength(1);
      expect(result[0].isCross).toBe(false);
    });
  });

  describe("mixed edges", () => {
    it("correctly classifies a mix of cross and same-cluster edges", () => {
      const edges: Edge[] = [
        {
          source: "file:backend/main.py",
          target: "file:backend/utils.py",
          type: "imports",
          isCrossCluster: false,
        },
        {
          source: "file:backend/main.py",
          target: "file:frontend/App.tsx",
          type: "calls",
          isCrossCluster: true,
        },
        {
          source: "file:frontend/App.tsx",
          target: "file:services/api.ts",
          type: "imports",
          isCrossCluster: true,
        },
      ];

      const result = detectCrossGlobeArcs(edges, nodeClusterMap);

      expect(result).toHaveLength(3);
      expect(result[0].isCross).toBe(false);
      expect(result[1].isCross).toBe(true);
      expect(result[2].isCross).toBe(true);
    });

    it("handles edges with unknown nodes gracefully", () => {
      const edges: Edge[] = [
        {
          source: "file:unknown/file.ts",
          target: "file:backend/main.py",
          type: "imports",
          // No isCrossCluster, source not in map
        },
      ];

      const result = detectCrossGlobeArcs(edges, nodeClusterMap);

      expect(result).toHaveLength(1);
      // "unknown" !== "backend" → cross
      expect(result[0].sourceClusterId).toBe("unknown");
      expect(result[0].targetClusterId).toBe("backend");
    });
  });

  describe("edge types", () => {
    it("preserves edge type in the result ID", () => {
      const edges: Edge[] = [
        {
          source: "file:backend/main.py",
          target: "file:frontend/App.tsx",
          type: "calls",
          isCrossCluster: true,
        },
      ];

      const result = detectCrossGlobeArcs(edges, nodeClusterMap);
      expect(result[0].edgeId).toBe("file:backend/main.py-file:frontend/App.tsx-calls");
    });
  });

  describe("empty inputs", () => {
    it("returns empty array for no edges", () => {
      const result = detectCrossGlobeArcs([], nodeClusterMap);
      expect(result).toHaveLength(0);
    });

    it("handles empty node cluster map", () => {
      const edges: Edge[] = [
        {
          source: "file:a.ts",
          target: "file:b.ts",
          type: "imports",
        },
      ];

      const result = detectCrossGlobeArcs(edges, new Map());
      expect(result).toHaveLength(1);
      // Both unknown → "unknown" === "unknown" → not cross
      expect(result[0].isCross).toBe(false);
    });
  });
});
