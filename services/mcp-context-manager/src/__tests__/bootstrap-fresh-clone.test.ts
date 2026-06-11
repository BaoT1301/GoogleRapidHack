/**
 * Track 5 — Fresh-clone bootstrap integration test on collab-guard fixture.
 *
 * Exercises IncrementalIndexer.buildInitialGraph() end-to-end against the
 * collab-guard-tree fixture, which mirrors the nested-template layout:
 *
 *   .tools/mcp-context-manager/src/**  ← EXCLUDED by default ignores
 *   collab-guard/src/**                ← INCLUDED (7 app files)
 *   extension/**                       ← INCLUDED (1 file)
 *
 * Tests A–C use the indexer directly.
 * Test D spins up HttpApiServer and hits /api/v1/diag to assert cluster hits.
 */
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { IncrementalIndexer } from "../indexer/incremental-indexer.js";
import { GraphStore } from "../graph/graph-store.js";
import { HttpApiServer } from "../api.js";
import { ClusterConfigLoader } from "../cluster/cluster-config-loader.js";

const FIXTURE_ROOT = path.resolve(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "fixtures/collab-guard-tree",
);

// ─── Env helpers ─────────────────────────────────────────────────────────────

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {
    PYTHON_WATCH_GLOBS: process.env.PYTHON_WATCH_GLOBS,
    TS_WATCH_GLOBS: process.env.TS_WATCH_GLOBS,
    WATCH_IGNORES: process.env.WATCH_IGNORES,
  };
  delete process.env.PYTHON_WATCH_GLOBS;
  delete process.env.TS_WATCH_GLOBS;
  delete process.env.WATCH_IGNORES;
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIndexer(workspaceRoot: string = FIXTURE_ROOT): { indexer: IncrementalIndexer; store: GraphStore } {
  const store = new GraphStore();
  const indexer = new IncrementalIndexer(workspaceRoot, store);
  return { indexer, store };
}

function makeClusterConfig(clusters: { id: string; path: string }[]): ClusterConfigLoader {
  return {
    getClusters: () => clusters.map((c) => ({ ...c, label: c.id, color: "#000" })),
    getClusterForFile: (fp: string) => {
      // Match by relative path segment (absolute paths contain the fixture root prefix)
      const rel = fp.replace(FIXTURE_ROOT, "").replace(/^\//, "");
      const match = clusters.find((c) => rel.startsWith(c.path));
      return match ? { ...match, label: match.id, color: "#000" } : undefined;
    },
    startWatching: () => {},
    stopWatching: () => {},
  } as unknown as ClusterConfigLoader;
}

// ─── Test A: default globs index app code, exclude template source ────────────

describe("bootstrap-fresh-clone — Test A: default globs", () => {
  it("indexes 7 app files and excludes .tools/mcp-context-manager template source", async () => {
    const { indexer, store } = makeIndexer();
    const { indexedFiles } = await indexer.buildInitialGraph();

    // 7 app files: Button.tsx, App.tsx, routes.ts, agent.ts, core.ts, types.ts, extension.ts
    expect(indexedFiles).toBe(7);

    const indexed = store.getIndexedFilePaths();

    // App code is present
    expect(indexed.some((f) => f.includes("collab-guard/"))).toBe(true);
    expect(indexed.some((f) => f.includes("extension/"))).toBe(true);

    // Template source is excluded
    expect(indexed.some((f) => f.includes(".tools/mcp-context-manager"))).toBe(false);
  });
});

// ─── Test B: brace-expansion TS_WATCH_GLOBS ──────────────────────────────────

describe("bootstrap-fresh-clone — Test B: brace-expansion TS_WATCH_GLOBS", () => {
  it("indexes only collab-guard/src files when TS_WATCH_GLOBS scoped to that subtree", async () => {
    process.env.TS_WATCH_GLOBS = "collab-guard/src/**/*.{ts,tsx}";

    const { indexer, store } = makeIndexer();
    const { indexedFiles } = await indexer.buildInitialGraph();

    expect(indexedFiles).toBeGreaterThan(0);

    const indexed = store.getIndexedFilePaths();

    // All indexed files are under collab-guard/src/
    expect(indexed.every((f) => f.includes("collab-guard/src/"))).toBe(true);

    // extension/ is not indexed (outside the scoped glob)
    expect(indexed.some((f) => f.includes("extension/"))).toBe(false);
  });
});

// ─── Test C: WATCH_IGNORES override excludes extension files ─────────────────

describe("bootstrap-fresh-clone — Test C: WATCH_IGNORES override", () => {
  it("excludes extension/ when WATCH_IGNORES=**/extension/**", async () => {
    process.env.WATCH_IGNORES = "**/extension/**";

    const { indexer, store } = makeIndexer();
    await indexer.buildInitialGraph();

    const indexed = store.getIndexedFilePaths();

    // extension/ is excluded by the custom ignore
    expect(indexed.some((f) => f.includes("extension/"))).toBe(false);

    // collab-guard/ is still indexed
    expect(indexed.some((f) => f.includes("collab-guard/"))).toBe(true);
  });
});

// ─── Test D: cluster hits via /api/v1/diag ───────────────────────────────────

describe("bootstrap-fresh-clone — Test D: cluster hits via /api/v1/diag", () => {
  let httpApi: HttpApiServer;
  let port: number;

  it("reports correct per-cluster file counts for collab-guard subtrees", async () => {
    const { indexer, store } = makeIndexer();
    await indexer.buildInitialGraph();

    const clusterConfig = makeClusterConfig([
      { id: "client", path: "collab-guard/src/client/" },
      { id: "server", path: "collab-guard/src/server/" },
      { id: "shared", path: "collab-guard/src/shared/" },
      { id: "extension", path: "extension/" },
    ]);

    port = 3900 + Math.floor(Math.random() * 99);
    httpApi = new HttpApiServer(store, clusterConfig, port);
    httpApi.setWorkspaceRoot(FIXTURE_ROOT);
    await httpApi.start();

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/diag`);
      expect(res.status).toBe(200);

      const body = await res.json() as {
        fileCount: { total: number; python: number; ts: number };
        clusterHits: Record<string, number>;
        degraded: boolean;
      };

      // Total file count matches what the indexer reported
      expect(body.fileCount.total).toBe(7);
      expect(body.fileCount.ts).toBe(7);
      expect(body.fileCount.python).toBe(0);

      // Each app cluster has at least one hit
      expect(body.clusterHits["client"]).toBeGreaterThan(0);   // Button.tsx, App.tsx
      expect(body.clusterHits["server"]).toBeGreaterThan(0);   // routes.ts, agent.ts, core.ts
      expect(body.clusterHits["shared"]).toBeGreaterThan(0);   // types.ts
      expect(body.clusterHits["extension"]).toBeGreaterThan(0); // extension.ts

      // Template code produced no cluster hits (it was excluded from indexing)
      const allHitPaths = Object.keys(body.clusterHits);
      expect(allHitPaths.some((id) => id.includes("mcp-context"))).toBe(false);

      // Not degraded — we indexed 7 files
      expect(body.degraded).toBe(false);
    } finally {
      await httpApi.stop();
    }
  });
});
