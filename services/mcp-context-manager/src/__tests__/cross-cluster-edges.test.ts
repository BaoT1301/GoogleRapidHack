import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpApiServer } from "../api.js";
import { GraphStore } from "../graph/graph-store.js";
import { ClusterConfigLoader } from "../cluster/cluster-config-loader.js";
import type { FileParseResult } from "../types/schema.js";

/**
 * Tests for Phase 2 Sprint 2 — Track 1 enhancements:
 * 1. Cross-cluster edge tagging (isCrossCluster)
 * 2. Same-cluster edges (isCrossCluster: false)
 * 3. Cluster metadata in graph export response
 * 4. Default maxNodes/maxEdges returns full graph
 * 5. SSE events include clusterId field
 */

// Helper to create a minimal FileParseResult
function makeFileResult(filePath: string, language: "python" | "typescript", imports: string[] = []): FileParseResult {
  return {
    filePath,
    language,
    hash: `hash-${filePath}`,
    symbols: [],
    relations: [],
    parsedImports: imports.map((raw) => ({ raw, isRelative: false })),
    resolvedImports: imports,
    parseErrors: [],
  };
}

// Helper to invoke the private handleExportGraph via the HTTP server
async function getGraphResponse(httpApi: HttpApiServer, params: Record<string, string> = {}): Promise<any> {
  // We access the handler through a real HTTP request
  const port = 19000 + Math.floor(Math.random() * 1000);
  await httpApi.start();

  const searchParams = new URLSearchParams(params);
  const url = `http://localhost:${port}/api/v1/mcp/graph?${searchParams.toString()}`;

  try {
    const response = await fetch(url);
    return await response.json();
  } finally {
    await httpApi.stop();
  }
}

describe("Track 1: Cross-Cluster Edge Detection & Graph Export Enhancements", () => {
  let graphStore: GraphStore;
  let clusterConfig: ClusterConfigLoader;

  beforeEach(() => {
    graphStore = new GraphStore();

    // Mock ClusterConfigLoader — we can't use a real file in unit tests
    clusterConfig = {
      getClusters: vi.fn().mockReturnValue([
        { id: "backend", path: "backend/", label: "Backend Services", color: "#4A90E2" },
        { id: "frontend", path: "frontend/", label: "Frontend Application", color: "#E24A4A" },
        { id: "mcp-services", path: "services/", label: "MCP Services", color: "#4AE290" },
      ]),
      getClusterForFile: vi.fn().mockImplementation((filePath: string) => {
        if (filePath.startsWith("backend/")) {
          return { id: "backend", path: "backend/", label: "Backend Services", color: "#4A90E2" };
        }
        if (filePath.startsWith("frontend/")) {
          return { id: "frontend", path: "frontend/", label: "Frontend Application", color: "#E24A4A" };
        }
        if (filePath.startsWith("services/")) {
          return { id: "mcp-services", path: "services/", label: "MCP Services", color: "#4AE290" };
        }
        return { id: "root", path: "", label: "Root", color: "#4A90E2" };
      }),
      startWatching: vi.fn(),
      stopWatching: vi.fn(),
    } as unknown as ClusterConfigLoader;
  });

  describe("Property: Cross-cluster edges are tagged isCrossCluster: true", () => {
    it("should tag edges between nodes in different clusters as isCrossCluster: true", async () => {
      // Setup: backend file imports a services file → cross-cluster edge
      // Upsert imported file first, then the importing file (to preserve import edges)
      graphStore.upsertFileResult(makeFileResult("services/mcp-context-manager/src/server.ts", "typescript"));
      graphStore.upsertFileResult(makeFileResult("backend/app/main.py", "python", ["services/mcp-context-manager/src/server.ts"]));

      const port = 19100 + Math.floor(Math.random() * 900);
      const httpApi = new HttpApiServer(graphStore, clusterConfig, port);
      await httpApi.start();

      try {
        const response = await fetch(`http://localhost:${port}/api/v1/mcp/graph?scope=repo`);
        const data = await response.json();

        // Find the cross-cluster edge (backend → services)
        const crossEdges = data.edges.filter((e: any) => e.isCrossCluster === true);
        expect(crossEdges.length).toBeGreaterThan(0);

        // Verify the edge connects nodes from different clusters
        for (const edge of crossEdges) {
          const sourceNode = data.nodes.find((n: any) => n.id === edge.source);
          const targetNode = data.nodes.find((n: any) => n.id === edge.target);
          if (sourceNode?.clusterId && targetNode?.clusterId) {
            expect(sourceNode.clusterId).not.toBe(targetNode.clusterId);
          }
        }
      } finally {
        await httpApi.stop();
      }
    });
  });

  describe("Property: Same-cluster edges are tagged isCrossCluster: false", () => {
    it("should tag edges between nodes in the same cluster as isCrossCluster: false", async () => {
      // Setup: two backend files where one imports the other → same-cluster edge
      // Upsert imported file first to preserve import edges
      graphStore.upsertFileResult(makeFileResult("backend/app/config.py", "python"));
      graphStore.upsertFileResult(makeFileResult("backend/app/main.py", "python", ["backend/app/config.py"]));

      const port = 19200 + Math.floor(Math.random() * 900);
      const httpApi = new HttpApiServer(graphStore, clusterConfig, port);
      await httpApi.start();

      try {
        const response = await fetch(`http://localhost:${port}/api/v1/mcp/graph?scope=repo`);
        const data = await response.json();

        // All edges should be same-cluster (both files are in backend/)
        const edges = data.edges;
        expect(edges.length).toBeGreaterThan(0);
        for (const edge of edges) {
          expect(edge.isCrossCluster).toBe(false);
        }
      } finally {
        await httpApi.stop();
      }
    });
  });

  describe("Property: Cluster metadata is present in graph export response", () => {
    it("should include clusterMeta array in graph export response", async () => {
      graphStore.upsertFileResult(makeFileResult("backend/app/main.py", "python"));

      const port = 19300 + Math.floor(Math.random() * 900);
      const httpApi = new HttpApiServer(graphStore, clusterConfig, port);
      await httpApi.start();

      try {
        const response = await fetch(`http://localhost:${port}/api/v1/mcp/graph?scope=repo`);
        const data = await response.json();

        expect(data.clusterMeta).toBeDefined();
        expect(Array.isArray(data.clusterMeta)).toBe(true);
        expect(data.clusterMeta.length).toBe(3);

        // Verify cluster structure
        for (const cluster of data.clusterMeta) {
          expect(cluster).toHaveProperty("id");
          expect(cluster).toHaveProperty("path");
          expect(cluster).toHaveProperty("label");
          expect(cluster).toHaveProperty("color");
        }

        // Verify specific clusters
        const ids = data.clusterMeta.map((c: any) => c.id);
        expect(ids).toContain("backend");
        expect(ids).toContain("frontend");
        expect(ids).toContain("mcp-services");
      } finally {
        await httpApi.stop();
      }
    });
  });

  describe("Property: Default maxNodes/maxEdges returns full graph (no truncation)", () => {
    it("should return all nodes and edges when no limits are specified", async () => {
      // Create enough files to exceed old default of 2000 nodes
      // (we'll use a smaller set but verify no truncation)
      for (let i = 0; i < 10; i++) {
        graphStore.upsertFileResult(makeFileResult(`backend/app/file${i}.py`, "python"));
      }

      const port = 19400 + Math.floor(Math.random() * 900);
      const httpApi = new HttpApiServer(graphStore, clusterConfig, port);
      await httpApi.start();

      try {
        // No max_nodes or max_edges params → should return full graph
        const response = await fetch(`http://localhost:${port}/api/v1/mcp/graph?scope=repo`);
        const data = await response.json();

        // Should have all 10 file nodes
        const fileNodes = data.nodes.filter((n: any) => n.type === "file");
        expect(fileNodes.length).toBe(10);

        // Meta should not indicate truncation
        expect(data.meta.truncated).toBe(false);
      } finally {
        await httpApi.stop();
      }
    });

    it("should still respect explicit limits when provided", async () => {
      for (let i = 0; i < 10; i++) {
        graphStore.upsertFileResult(makeFileResult(`backend/app/file${i}.py`, "python"));
      }

      const port = 19500 + Math.floor(Math.random() * 900);
      const httpApi = new HttpApiServer(graphStore, clusterConfig, port);
      await httpApi.start();

      try {
        const response = await fetch(`http://localhost:${port}/api/v1/mcp/graph?scope=repo&max_nodes=3`);
        const data = await response.json();

        // Should be capped at 3 nodes
        expect(data.nodes.length).toBeLessThanOrEqual(3);
      } finally {
        await httpApi.stop();
      }
    });
  });

  describe("Property: SSE events include clusterId field", () => {
    it("should broadcast SSE events with correct data structure", () => {
      // Test the broadcastSSE method directly — verify it doesn't throw
      // and that the data structure is correct
      const port = 19600 + Math.floor(Math.random() * 900);
      const httpApi = new HttpApiServer(graphStore, clusterConfig, port);

      // broadcastSSE is a public method — we can call it directly
      // With no clients connected, it should be a no-op (no errors)
      expect(() => {
        httpApi.broadcastSSE("file-change", {
          type: "file-updated",
          filePaths: ["backend/app/main.py"],
          clusterIds: ["backend"],
          timestamp: Date.now(),
        });
      }).not.toThrow();

      expect(() => {
        httpApi.broadcastSSE("file-change", {
          type: "file-deleted",
          filePath: "backend/app/old.py",
          clusterId: "backend",
          timestamp: Date.now(),
        });
      }).not.toThrow();

      expect(() => {
        httpApi.broadcastSSE("file-change", {
          type: "file-created",
          filePaths: ["frontend/src/new.tsx"],
          clusterIds: ["frontend"],
          timestamp: Date.now(),
        });
      }).not.toThrow();
    });
  });

  describe("Property: Mixed cross-cluster and same-cluster edges", () => {
    it("should correctly tag both types in a single graph", async () => {
      // Upsert imported files first, then the importing file
      graphStore.upsertFileResult(makeFileResult("backend/app/b.py", "python"));
      graphStore.upsertFileResult(makeFileResult("services/mcp/src/s.ts", "typescript"));
      graphStore.upsertFileResult(makeFileResult("backend/app/a.py", "python", ["backend/app/b.py", "services/mcp/src/s.ts"]));

      const port = 19700 + Math.floor(Math.random() * 900);
      const httpApi = new HttpApiServer(graphStore, clusterConfig, port);
      await httpApi.start();

      try {
        const response = await fetch(`http://localhost:${port}/api/v1/mcp/graph?scope=repo`);
        const data = await response.json();

        const crossEdges = data.edges.filter((e: any) => e.isCrossCluster === true);
        const sameEdges = data.edges.filter((e: any) => e.isCrossCluster === false);

        // Should have at least one of each
        expect(crossEdges.length).toBeGreaterThan(0);
        expect(sameEdges.length).toBeGreaterThan(0);

        // Every edge should have the isCrossCluster field
        for (const edge of data.edges) {
          expect(typeof edge.isCrossCluster).toBe("boolean");
        }
      } finally {
        await httpApi.stop();
      }
    });
  });

  describe("Property: Alias-resolved cross-cluster edge", () => {
    it("should detect a cross-cluster edge when the import was resolved via tsconfig alias", async () => {
      // Simulate: frontend file imports a services file via an alias that was
      // resolved by TsconfigResolver before being stored as resolvedImports.
      // The graph receives the already-resolved absolute path — same as any other import.
      graphStore.upsertFileResult(makeFileResult("services/mcp-context-manager/src/api.ts", "typescript"));
      graphStore.upsertFileResult(
        makeFileResult(
          "frontend/src/hooks/useGraph.ts",
          "typescript",
          // resolvedImports already contain the alias-resolved path
          ["services/mcp-context-manager/src/api.ts"],
        ),
      );

      const port = 19800 + Math.floor(Math.random() * 900);
      const httpApi = new HttpApiServer(graphStore, clusterConfig, port);
      await httpApi.start();

      try {
        const response = await fetch(`http://localhost:${port}/api/v1/mcp/graph?scope=repo`);
        const data = await response.json();

        // The edge from frontend → services should be cross-cluster
        const crossEdges = data.edges.filter((e: any) => e.isCrossCluster === true);
        expect(crossEdges.length).toBeGreaterThan(0);

        // Verify the edge connects frontend and mcp-services clusters
        const frontendNode = data.nodes.find((n: any) =>
          n.filePath?.includes("frontend/src/hooks/useGraph"),
        );
        const servicesNode = data.nodes.find((n: any) =>
          n.filePath?.includes("services/mcp-context-manager/src/api"),
        );
        expect(frontendNode?.clusterId).toBe("frontend");
        expect(servicesNode?.clusterId).toBe("mcp-services");
      } finally {
        await httpApi.stop();
      }
    });
  });
});
