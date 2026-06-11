import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpApiServer } from "../api.js";
import { GraphStore } from "../graph/graph-store.js";
import { ClusterConfigLoader } from "../cluster/cluster-config-loader.js";
import type { FileParseResult } from "../types/schema.js";

/**
 * Issue #4 Regression Test:
 *
 * Node filePath values in the graph use absolute Docker paths
 * (e.g., /workspace/backend/app/main.py), but getClusterForFile()
 * uses longest-prefix matching against relative cluster paths
 * (e.g., backend/). The fix strips WORKSPACE_ROOT before matching.
 *
 * Without the fix: all nodes get clusterId "root", isCrossCluster is always false.
 * With the fix: nodes get correct cluster IDs, cross-cluster edges are detected.
 */

function makeFileResult(
  filePath: string,
  language: "python" | "typescript",
  imports: string[] = [],
): FileParseResult {
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

describe("Issue #4: Absolute Docker path → relative path stripping for cluster matching", () => {
  let graphStore: GraphStore;
  let clusterConfig: ClusterConfigLoader;
  let originalWorkspaceRoot: string | undefined;

  beforeEach(() => {
    // Save and set WORKSPACE_ROOT to simulate Docker environment
    originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
    process.env.WORKSPACE_ROOT = "/workspace";

    graphStore = new GraphStore();

    // Use a real-behavior mock that does longest-prefix matching on relative paths
    // (same logic as the real ClusterConfigLoader)
    clusterConfig = {
      getClusters: vi.fn().mockReturnValue([
        { id: "backend", path: "backend/", label: "Backend Services", color: "#4A90E2" },
        { id: "frontend", path: "frontend/", label: "Frontend Application", color: "#E24A4A" },
        { id: "mcp-services", path: "services/", label: "MCP Services", color: "#4AE290" },
      ]),
      getClusterForFile: vi.fn().mockImplementation((filePath: string) => {
        // This mock mirrors the real ClusterConfigLoader behavior:
        // longest-prefix match against RELATIVE paths
        if (filePath.startsWith("backend/")) {
          return { id: "backend", path: "backend/", label: "Backend Services", color: "#4A90E2" };
        }
        if (filePath.startsWith("frontend/")) {
          return { id: "frontend", path: "frontend/", label: "Frontend Application", color: "#E24A4A" };
        }
        if (filePath.startsWith("services/")) {
          return { id: "mcp-services", path: "services/", label: "MCP Services", color: "#4AE290" };
        }
        // Fallback — this is what happened before the fix for ALL nodes
        return { id: "root", path: "", label: "Root", color: "#4A90E2" };
      }),
      startWatching: vi.fn(),
      stopWatching: vi.fn(),
    } as unknown as ClusterConfigLoader;
  });

  afterEach(() => {
    // Restore original WORKSPACE_ROOT
    if (originalWorkspaceRoot === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
    }
  });

  it("should assign correct clusterId when node filePaths are absolute Docker paths", async () => {
    // Simulate Docker environment: graph stores ABSOLUTE paths
    graphStore.upsertFileResult(makeFileResult("/workspace/backend/app/main.py", "python"));
    graphStore.upsertFileResult(makeFileResult("/workspace/frontend/src/App.tsx", "typescript"));
    graphStore.upsertFileResult(makeFileResult("/workspace/services/mcp-context-manager/src/server.ts", "typescript"));

    const port = 18100 + Math.floor(Math.random() * 900);
    const httpApi = new HttpApiServer(graphStore, clusterConfig, port);
    await httpApi.start();

    try {
      const response = await fetch(`http://localhost:${port}/api/v1/mcp/graph?scope=repo`);
      const data = await response.json();

      // Collect clusterIds from file nodes
      const fileNodes = data.nodes.filter((n: any) => n.type === "file");
      const clusterIds = fileNodes.map((n: any) => n.clusterId);

      // CRITICAL: No node should have clusterId "root" — that was the bug
      expect(clusterIds).not.toContain("root");
      expect(clusterIds).not.toContain(undefined);

      // Verify specific cluster assignments
      const backendNode = fileNodes.find((n: any) => n.filePath?.includes("backend/"));
      expect(backendNode?.clusterId).toBe("backend");

      const frontendNode = fileNodes.find((n: any) => n.filePath?.includes("frontend/"));
      expect(frontendNode?.clusterId).toBe("frontend");

      const servicesNode = fileNodes.find((n: any) => n.filePath?.includes("services/"));
      expect(servicesNode?.clusterId).toBe("mcp-services");
    } finally {
      await httpApi.stop();
    }
  });

  it("should detect cross-cluster edges when filePaths are absolute Docker paths", async () => {
    // Backend file imports a services file → cross-cluster edge
    graphStore.upsertFileResult(
      makeFileResult("/workspace/services/mcp-context-manager/src/server.ts", "typescript"),
    );
    graphStore.upsertFileResult(
      makeFileResult("/workspace/backend/app/main.py", "python", [
        "/workspace/services/mcp-context-manager/src/server.ts",
      ]),
    );

    const port = 18200 + Math.floor(Math.random() * 900);
    const httpApi = new HttpApiServer(graphStore, clusterConfig, port);
    await httpApi.start();

    try {
      const response = await fetch(`http://localhost:${port}/api/v1/mcp/graph?scope=repo`);
      const data = await response.json();

      // There should be at least one cross-cluster edge
      const crossEdges = data.edges.filter((e: any) => e.isCrossCluster === true);
      expect(crossEdges.length).toBeGreaterThan(0);

      // Verify the cross-cluster edge connects nodes from different clusters
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

  it("should handle paths that are already relative (no WORKSPACE_ROOT prefix)", async () => {
    // Some paths might already be relative — the fix should not break them
    graphStore.upsertFileResult(makeFileResult("backend/app/main.py", "python"));

    const port = 18300 + Math.floor(Math.random() * 900);
    const httpApi = new HttpApiServer(graphStore, clusterConfig, port);
    await httpApi.start();

    try {
      const response = await fetch(`http://localhost:${port}/api/v1/mcp/graph?scope=repo`);
      const data = await response.json();

      const fileNodes = data.nodes.filter((n: any) => n.type === "file");
      const backendNode = fileNodes.find((n: any) => n.filePath?.includes("backend/"));
      expect(backendNode?.clusterId).toBe("backend");
    } finally {
      await httpApi.stop();
    }
  });

  it("should handle WORKSPACE_ROOT with trailing slash", async () => {
    process.env.WORKSPACE_ROOT = "/workspace/";

    graphStore.upsertFileResult(makeFileResult("/workspace/backend/app/main.py", "python"));

    const port = 18400 + Math.floor(Math.random() * 900);
    const httpApi = new HttpApiServer(graphStore, clusterConfig, port);
    await httpApi.start();

    try {
      const response = await fetch(`http://localhost:${port}/api/v1/mcp/graph?scope=repo`);
      const data = await response.json();

      const fileNodes = data.nodes.filter((n: any) => n.type === "file");
      const backendNode = fileNodes.find((n: any) => n.filePath?.includes("backend/"));
      expect(backendNode?.clusterId).toBe("backend");
    } finally {
      await httpApi.stop();
    }
  });

  it("should handle empty WORKSPACE_ROOT gracefully", async () => {
    delete process.env.WORKSPACE_ROOT;

    // With no WORKSPACE_ROOT, absolute paths won't be stripped
    // but relative paths should still work
    graphStore.upsertFileResult(makeFileResult("backend/app/main.py", "python"));

    const port = 18500 + Math.floor(Math.random() * 900);
    const httpApi = new HttpApiServer(graphStore, clusterConfig, port);
    await httpApi.start();

    try {
      const response = await fetch(`http://localhost:${port}/api/v1/mcp/graph?scope=repo`);
      const data = await response.json();

      const fileNodes = data.nodes.filter((n: any) => n.type === "file");
      const backendNode = fileNodes.find((n: any) => n.filePath?.includes("backend/"));
      expect(backendNode?.clusterId).toBe("backend");
    } finally {
      await httpApi.stop();
    }
  });

  it("should verify getClusterForFile receives relative paths, not absolute", async () => {
    graphStore.upsertFileResult(makeFileResult("/workspace/backend/app/main.py", "python"));
    graphStore.upsertFileResult(makeFileResult("/workspace/frontend/src/App.tsx", "typescript"));

    const port = 18600 + Math.floor(Math.random() * 900);
    const httpApi = new HttpApiServer(graphStore, clusterConfig, port);
    await httpApi.start();

    try {
      await fetch(`http://localhost:${port}/api/v1/mcp/graph?scope=repo`);

      // Verify that getClusterForFile was called with RELATIVE paths
      const calls = (clusterConfig.getClusterForFile as ReturnType<typeof vi.fn>).mock.calls;
      for (const [arg] of calls) {
        expect(arg).not.toMatch(/^\/workspace\//);
        // Should be relative: "backend/..." or "frontend/..."
        expect(arg).toMatch(/^(backend|frontend|services)\//);
      }
    } finally {
      await httpApi.stop();
    }
  });

  it("extension-style alias: resolvedImports from @/* alias are treated as workspace edges", async () => {
    // Simulate a file that had its @/* alias resolved to an extension/src path
    // (as TsconfigResolver would produce). The graph should contain the edge.
    process.env.WORKSPACE_ROOT = "/workspace";

    graphStore.upsertFileResult(
      makeFileResult("/workspace/extension/src/bridge/supabase.ts", "typescript"),
    );
    graphStore.upsertFileResult(
      makeFileResult(
        "/workspace/extension/src/ui/foo.ts",
        "typescript",
        ["/workspace/extension/src/bridge/supabase.ts"],
      ),
    );

    const port = 18700 + Math.floor(Math.random() * 900);
    const httpApi = new HttpApiServer(graphStore, clusterConfig, port);
    await httpApi.start();

    try {
      const response = await fetch(`http://localhost:${port}/api/v1/mcp/graph?scope=repo`);
      const data = await response.json();

      // Both files should be present as nodes
      const filePaths = data.nodes
        .filter((n: any) => n.type === "file")
        .map((n: any) => n.filePath as string);

      expect(filePaths.some((p: string) => p.includes("bridge/supabase"))).toBe(true);
      expect(filePaths.some((p: string) => p.includes("ui/foo"))).toBe(true);

      // The import edge should exist
      expect(data.edges.length).toBeGreaterThan(0);
    } finally {
      await httpApi.stop();
    }
  });
});
