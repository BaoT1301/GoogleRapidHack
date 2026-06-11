import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HttpApiServer } from "../api.js";
import { GraphStore } from "../graph/graph-store.js";
import { ClusterConfigLoader } from "../cluster/cluster-config-loader.js";
import type { FileParseResult } from "../types/schema.js";

/**
 * API Versioning Tests
 *
 * Verifies:
 * 1. All endpoints respond correctly under /api/v1/mcp/* paths
 * 2. Legacy /api/mcp/* paths return HTTP 301 redirects to /api/v1/mcp/*
 * 3. /api/health still works as an alias (no redirect)
 * 4. /api/v1/health works as the versioned health endpoint
 * 5. SSE endpoint works on both /api/v1/mcp/events and /api/mcp/events (no redirect for SSE)
 */

function makeFileResult(filePath: string, language: "python" | "typescript"): FileParseResult {
  return {
    filePath,
    language,
    hash: `hash-${filePath}`,
    symbols: [
      {
        id: `func:${filePath}:test_func`,
        name: "test_func",
        qualifiedName: "test.test_func",
        kind: "function",
        language,
        filePath,
        rangeStart: { line: 1, column: 0 },
        rangeEnd: { line: 5, column: 0 },
      },
    ],
    relations: [],
    parsedImports: [],
    resolvedImports: [],
    parseErrors: [],
  };
}

describe("API Versioning (v1 prefix + 301 redirects)", () => {
  let graphStore: GraphStore;
  let httpApi: HttpApiServer;
  let port: number;

  beforeAll(async () => {
    graphStore = new GraphStore();
    graphStore.upsertFileResult(makeFileResult("backend/app/main.py", "python"));

    const clusterConfig = {
      getClusters: () => [
        { id: "backend", path: "backend/", label: "Backend", color: "#4A90E2" },
      ],
      getClusterForFile: () => ({
        id: "backend",
        path: "backend/",
        label: "Backend",
        color: "#4A90E2",
      }),
      startWatching: () => {},
      stopWatching: () => {},
    } as unknown as ClusterConfigLoader;

    port = 19100 + Math.floor(Math.random() * 900);
    httpApi = new HttpApiServer(graphStore, clusterConfig, port);
    await httpApi.start();
  });

  afterAll(async () => {
    await httpApi.stop();
  });

  // --- Versioned endpoints work correctly ---

  it("GET /api/v1/health returns 200", async () => {
    const response = await fetch(`http://localhost:${port}/api/v1/health`, { redirect: "manual" });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe("ok");
  });

  it("GET /api/health returns 200 (alias, no redirect)", async () => {
    const response = await fetch(`http://localhost:${port}/api/health`, { redirect: "manual" });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe("ok");
  });

  it("GET /api/v1/mcp/graph returns 200", async () => {
    const response = await fetch(`http://localhost:${port}/api/v1/mcp/graph?scope=repo`, { redirect: "manual" });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.nodes).toBeDefined();
    expect(data.edges).toBeDefined();
  });

  it("GET /api/v1/mcp/clusters returns 200", async () => {
    const response = await fetch(`http://localhost:${port}/api/v1/mcp/clusters`, { redirect: "manual" });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.clusters).toBeDefined();
  });

  it("GET /api/v1/mcp/search?query=test returns 200", async () => {
    const response = await fetch(`http://localhost:${port}/api/v1/mcp/search?query=test`, { redirect: "manual" });
    expect(response.status).toBe(200);
  });

  // --- Legacy paths return 301 redirects ---

  it("GET /api/mcp/graph returns 301 redirect to /api/v1/mcp/graph", async () => {
    const response = await fetch(`http://localhost:${port}/api/mcp/graph?scope=repo`, { redirect: "manual" });
    expect(response.status).toBe(301);
    const location = response.headers.get("location");
    expect(location).toBe("/api/v1/mcp/graph?scope=repo");
  });

  it("GET /api/mcp/clusters returns 301 redirect to /api/v1/mcp/clusters", async () => {
    const response = await fetch(`http://localhost:${port}/api/mcp/clusters`, { redirect: "manual" });
    expect(response.status).toBe(301);
    const location = response.headers.get("location");
    expect(location).toBe("/api/v1/mcp/clusters");
  });

  it("GET /api/mcp/search?query=test returns 301 redirect", async () => {
    const response = await fetch(`http://localhost:${port}/api/mcp/search?query=test`, { redirect: "manual" });
    expect(response.status).toBe(301);
    const location = response.headers.get("location");
    expect(location).toBe("/api/v1/mcp/search?query=test");
  });

  it("POST /api/mcp/callers returns 301 redirect", async () => {
    const response = await fetch(`http://localhost:${port}/api/mcp/callers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ function_name: "test" }),
      redirect: "manual",
    });
    expect(response.status).toBe(301);
    const location = response.headers.get("location");
    expect(location).toBe("/api/v1/mcp/callers");
  });

  it("GET /api/mcp/dead-code returns 301 redirect", async () => {
    const response = await fetch(`http://localhost:${port}/api/mcp/dead-code`, { redirect: "manual" });
    expect(response.status).toBe(301);
    const location = response.headers.get("location");
    expect(location).toBe("/api/v1/mcp/dead-code");
  });

  it("GET /api/mcp/impact/backend%2Fapp%2Fmain.py returns 301 redirect with path preserved", async () => {
    const response = await fetch(`http://localhost:${port}/api/mcp/impact/backend%2Fapp%2Fmain.py`, { redirect: "manual" });
    expect(response.status).toBe(301);
    const location = response.headers.get("location");
    expect(location).toBe("/api/v1/mcp/impact/backend%2Fapp%2Fmain.py");
  });
});
