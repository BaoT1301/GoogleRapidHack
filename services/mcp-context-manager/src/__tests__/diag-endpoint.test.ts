import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { HttpApiServer } from "../api.js";
import { GraphStore } from "../graph/graph-store.js";
import { ClusterConfigLoader } from "../cluster/cluster-config-loader.js";
import type { FileParseResult } from "../types/schema.js";

function makeFileResult(filePath: string, language: "python" | "typescript"): FileParseResult {
  return {
    filePath,
    language,
    hash: `hash-${filePath}`,
    symbols: [],
    relations: [],
    parsedImports: [],
    resolvedImports: [],
    parseErrors: [],
  };
}

function makeClusterConfig(clusters: { id: string; path: string }[]): ClusterConfigLoader {
  return {
    getClusters: () => clusters.map((c) => ({ ...c, label: c.id, color: "#000" })),
    getClusterForFile: (fp: string) => {
      const match = clusters.find((c) => fp.startsWith(c.path) || fp.includes(`/${c.path}`));
      return match ? { ...match, label: match.id, color: "#000" } : { id: "default", path: "", label: "default", color: "#000" };
    },
    startWatching: () => {},
    stopWatching: () => {},
  } as unknown as ClusterConfigLoader;
}

// ─── Test Suite 1: Healthy state ─────────────────────────────────────────────

describe("GET /api/v1/diag — healthy state", () => {
  let graphStore: GraphStore;
  let httpApi: HttpApiServer;
  let port: number;

  beforeAll(async () => {
    graphStore = new GraphStore();
    graphStore.upsertFileResult(makeFileResult("backend/app/main.py", "python"));
    graphStore.upsertFileResult(makeFileResult("backend/app/utils.py", "python"));
    graphStore.upsertFileResult(makeFileResult("frontend/src/App.tsx", "typescript"));
    graphStore.upsertFileResult(makeFileResult("frontend/src/index.ts", "typescript"));

    const clusterConfig = makeClusterConfig([
      { id: "backend", path: "backend/" },
      { id: "frontend", path: "frontend/" },
    ]);

    port = 19200 + Math.floor(Math.random() * 900);
    httpApi = new HttpApiServer(graphStore, clusterConfig, port);
    httpApi.setWorkspaceRoot("/workspace");
    httpApi.setDegradedState(false, []);
    await httpApi.start();
  });

  afterAll(async () => {
    await httpApi.stop();
  });

  it("returns HTTP 200", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    expect(res.status).toBe(200);
  });

  it("response shape matches contract", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();

    expect(data).toHaveProperty("workspaceRoot");
    expect(data).toHaveProperty("resolvedPythonGlobs");
    expect(data).toHaveProperty("resolvedTsGlobs");
    expect(data).toHaveProperty("resolvedIgnores");
    expect(data).toHaveProperty("fileCount");
    expect(data).toHaveProperty("clusterHits");
    expect(data).toHaveProperty("degraded");
    expect(data).toHaveProperty("reasons");
  });

  it("workspaceRoot matches the value set via setWorkspaceRoot", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(data.workspaceRoot).toBe("/workspace");
  });

  it("fileCount.total equals number of indexed files", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(data.fileCount.total).toBe(4);
  });

  it("fileCount.python counts only .py files", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(data.fileCount.python).toBe(2);
  });

  it("fileCount.ts counts only .ts/.tsx files", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(data.fileCount.ts).toBe(2);
  });

  it("clusterHits contains counts for backend and frontend clusters", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(data.clusterHits.backend).toBe(2);
    expect(data.clusterHits.frontend).toBe(2);
  });

  it("degraded is false and reasons is empty when healthy", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(data.degraded).toBe(false);
    expect(data.reasons).toEqual([]);
  });

  it("resolvedPythonGlobs is an array of strings", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(Array.isArray(data.resolvedPythonGlobs)).toBe(true);
    expect(data.resolvedPythonGlobs.length).toBeGreaterThan(0);
  });

  it("resolvedIgnores is an array of strings", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(Array.isArray(data.resolvedIgnores)).toBe(true);
    expect(data.resolvedIgnores.length).toBeGreaterThan(0);
  });
});

// ─── Test Suite 2: Degraded state ────────────────────────────────────────────

describe("GET /api/v1/diag — degraded state (0 files indexed)", () => {
  let graphStore: GraphStore;
  let httpApi: HttpApiServer;
  let port: number;

  beforeAll(async () => {
    graphStore = new GraphStore(); // empty — no files indexed

    const clusterConfig = makeClusterConfig([
      { id: "backend", path: "backend/" },
    ]);

    port = 19300 + Math.floor(Math.random() * 900);
    httpApi = new HttpApiServer(graphStore, clusterConfig, port);
    httpApi.setWorkspaceRoot("/workspace");
    httpApi.setDegradedState(true, ["indexed 0 files"]);
    await httpApi.start();
  });

  afterAll(async () => {
    await httpApi.stop();
  });

  it("returns HTTP 200 even when degraded", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    expect(res.status).toBe(200);
  });

  it("degraded is true when 0 files indexed", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(data.degraded).toBe(true);
  });

  it("reasons contains 'indexed 0 files'", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(data.reasons).toContain("indexed 0 files");
  });

  it("fileCount.total is 0", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(data.fileCount.total).toBe(0);
    expect(data.fileCount.python).toBe(0);
    expect(data.fileCount.ts).toBe(0);
  });

  it("clusterHits is empty when no files indexed", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(Object.keys(data.clusterHits)).toHaveLength(0);
  });
});

// ─── Test Suite 3: Health endpoint mirrors degraded state ────────────────────

describe("GET /api/v1/health — mirrors degraded state", () => {
  let graphStore: GraphStore;
  let httpApi: HttpApiServer;
  let port: number;

  beforeAll(async () => {
    graphStore = new GraphStore();
    const clusterConfig = makeClusterConfig([]);
    port = 19400 + Math.floor(Math.random() * 900);
    httpApi = new HttpApiServer(graphStore, clusterConfig, port);
    httpApi.setWorkspaceRoot("/workspace");
    await httpApi.start();
  });

  afterAll(async () => {
    await httpApi.stop();
  });

  it("returns {status: 'ok'} when not degraded", async () => {
    httpApi.setDegradedState(false, []);
    const res = await fetch(`http://localhost:${port}/api/v1/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.reasons).toBeUndefined();
  });

  it("returns {status: 'degraded', reasons: [...]} when degraded", async () => {
    httpApi.setDegradedState(true, ["indexed 0 files"]);
    const res = await fetch(`http://localhost:${port}/api/v1/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("degraded");
    expect(data.reasons).toEqual(["indexed 0 files"]);
  });

  it("legacy /api/health always returns {status: 'ok'} regardless of degraded state", async () => {
    httpApi.setDegradedState(true, ["indexed 0 files"]);
    const res = await fetch(`http://localhost:${port}/api/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });
});
