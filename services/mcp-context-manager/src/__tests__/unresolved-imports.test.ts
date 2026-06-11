import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { GraphStore } from "../graph/graph-store.js";
import { IncrementalIndexer } from "../indexer/incremental-indexer.js";
import { HttpApiServer } from "../api.js";
import { ClusterConfigLoader } from "../cluster/cluster-config-loader.js";
import type { FileParseResult, UnresolvedImportEntry } from "../types/schema.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "unresolved-imports-test-"));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

function makeFileResult(
  filePath: string,
  unresolvedImports?: UnresolvedImportEntry[],
  resolvedImports: string[] = [],
): FileParseResult {
  return {
    filePath,
    language: "typescript",
    hash: `hash-${filePath}`,
    symbols: [],
    relations: [],
    parsedImports: [],
    resolvedImports,
    parseErrors: [],
    unresolvedImports,
  };
}

function makeMockClusterConfig(): ClusterConfigLoader {
  return {
    getClusters: vi.fn().mockReturnValue([]),
    getClusterForFile: vi.fn().mockReturnValue(undefined),
    startWatching: vi.fn(),
    stopWatching: vi.fn(),
  } as unknown as ClusterConfigLoader;
}

// ─── GraphStore unit tests ────────────────────────────────────────────────────

describe("GraphStore — unresolved import storage", () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();
  });

  it("stores unresolvedImports when upsertFileResult is called with them", () => {
    store.upsertFileResult(
      makeFileResult("src/foo.ts", [{ specifier: "@/bar", reason: "alias-no-tsconfig" }]),
    );
    const results = store.getUnresolvedImports();
    expect(results).toHaveLength(1);
    expect(results[0].filePath).toBe("src/foo.ts");
    expect(results[0].unresolved[0].specifier).toBe("@/bar");
  });

  it("clears unresolvedImports when file is re-indexed with no unresolved", () => {
    store.upsertFileResult(
      makeFileResult("src/foo.ts", [{ specifier: "@/bar", reason: "alias-no-tsconfig" }]),
    );
    // Re-index with no unresolved
    store.upsertFileResult(makeFileResult("src/foo.ts", []));
    const results = store.getUnresolvedImports();
    expect(results).toHaveLength(0);
  });

  it("clears unresolvedImports when file is removed", () => {
    store.upsertFileResult(
      makeFileResult("src/foo.ts", [{ specifier: "@/bar", reason: "alias-no-tsconfig" }]),
    );
    store.removeFile("src/foo.ts");
    expect(store.getUnresolvedImports()).toHaveLength(0);
  });

  it("getUnresolvedImports filters by file_pattern glob", () => {
    store.upsertFileResult(
      makeFileResult("src/a.ts", [{ specifier: "@/x", reason: "alias-no-match" }]),
    );
    store.upsertFileResult(
      makeFileResult("lib/b.ts", [{ specifier: "@/y", reason: "alias-no-match" }]),
    );
    const results = store.getUnresolvedImports("src/**");
    expect(results).toHaveLength(1);
    expect(results[0].filePath).toBe("src/a.ts");
  });

  it("getUnresolvedSummary counts resolved edges and unresolved specifiers", () => {
    store.upsertFileResult(
      makeFileResult(
        "src/a.ts",
        [{ specifier: "@/missing", reason: "alias-no-match" }],
        ["src/b.ts"],
      ),
    );
    store.upsertFileResult(makeFileResult("src/b.ts", []));

    const summary = store.getUnresolvedSummary();
    expect(summary.resolvedEdges).toBe(1);
    expect(summary.unresolvedSpecifiers).toBe(1);
    expect(summary.topUnresolvedReasons["alias-no-match"]).toBe(1);
  });

  it("getUnresolvedSummary returns zero counts when nothing is unresolved", () => {
    store.upsertFileResult(makeFileResult("src/a.ts", [], ["src/b.ts"]));
    const summary = store.getUnresolvedSummary();
    expect(summary.unresolvedSpecifiers).toBe(0);
    expect(summary.resolvedEdges).toBe(1);
  });

  it("stores multiple unresolved entries per file", () => {
    store.upsertFileResult(
      makeFileResult("src/a.ts", [
        { specifier: "@/x", reason: "alias-no-match" },
        { specifier: "./missing", reason: "missing-file" },
      ]),
    );
    const results = store.getUnresolvedImports();
    expect(results[0].unresolved).toHaveLength(2);
  });
});

// ─── IncrementalIndexer integration tests ────────────────────────────────────

describe("IncrementalIndexer — resolveTypeScriptImportTagged", () => {
  let tmpDir: string;
  let store: GraphStore;
  let indexer: IncrementalIndexer;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    store = new GraphStore();
    indexer = new IncrementalIndexer(tmpDir, store);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("relative import to existing file → resolved, no unresolved entry", async () => {
    await writeFile(path.join(tmpDir, "src/b.ts"), "export const b = 1;");
    await writeFile(
      path.join(tmpDir, "src/a.ts"),
      'import { b } from "./b";',
    );

    await indexer.buildInitialGraph();

    const unresolved = store.getUnresolvedImports();
    const aEntry = unresolved.find((e) => e.filePath.includes("src/a.ts"));
    expect(aEntry).toBeUndefined();

    const summary = store.getUnresolvedSummary();
    expect(summary.resolvedEdges).toBeGreaterThan(0);
  });

  it("relative import to missing file → reason: missing-file", async () => {
    await writeFile(
      path.join(tmpDir, "src/a.ts"),
      'import { x } from "./does-not-exist";',
    );

    await indexer.buildInitialGraph();

    const unresolved = store.getUnresolvedImports();
    const aEntry = unresolved.find((e) => e.filePath.includes("src/a.ts"));
    expect(aEntry).toBeDefined();
    expect(aEntry!.unresolved[0].reason).toBe("missing-file");
    expect(aEntry!.unresolved[0].specifier).toBe("./does-not-exist");
  });

  it("alias specifier with no tsconfig in tree → reason: alias-no-tsconfig", async () => {
    await writeFile(
      path.join(tmpDir, "src/a.ts"),
      'import { x } from "@/components/Button";',
    );

    await indexer.buildInitialGraph();

    const unresolved = store.getUnresolvedImports();
    const aEntry = unresolved.find((e) => e.filePath.includes("src/a.ts"));
    expect(aEntry).toBeDefined();
    expect(aEntry!.unresolved[0].reason).toBe("alias-no-tsconfig");
  });

  it("alias specifier with tsconfig but no matching path → reason: alias-no-match", async () => {
    await writeFile(
      path.join(tmpDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["lib/*"] } } }),
    );
    await writeFile(
      path.join(tmpDir, "src/a.ts"),
      'import { x } from "@/components/Button";',
    );

    await indexer.buildInitialGraph();

    const unresolved = store.getUnresolvedImports();
    const aEntry = unresolved.find((e) => e.filePath.includes("src/a.ts"));
    expect(aEntry).toBeDefined();
    // tsconfig exists but has no matching alias for @/components/* → alias-no-match
    expect(aEntry!.unresolved[0].reason).toBe("alias-no-match");
  });

  it("bare specifier like 'react' → skipped-external, no unresolved entry", async () => {
    await writeFile(
      path.join(tmpDir, "src/a.ts"),
      'import React from "react";',
    );

    await indexer.buildInitialGraph();

    const unresolved = store.getUnresolvedImports();
    const aEntry = unresolved.find((e) => e.filePath.includes("src/a.ts"));
    expect(aEntry).toBeUndefined();
  });

  it("mix of resolved + unresolved in one file → both populated correctly", async () => {
    await writeFile(path.join(tmpDir, "src/b.ts"), "export const b = 1;");
    await writeFile(
      path.join(tmpDir, "src/a.ts"),
      `import { b } from "./b";\nimport { x } from "./missing";`,
    );

    await indexer.buildInitialGraph();

    const summary = store.getUnresolvedSummary();
    expect(summary.resolvedEdges).toBeGreaterThan(0);
    expect(summary.unresolvedSpecifiers).toBeGreaterThan(0);

    const unresolved = store.getUnresolvedImports();
    const aEntry = unresolved.find((e) => e.filePath.includes("src/a.ts"));
    expect(aEntry).toBeDefined();
    expect(aEntry!.unresolved[0].reason).toBe("missing-file");
  });
});

// ─── HTTP API tests ───────────────────────────────────────────────────────────

describe("HTTP API — /api/v1/diag importResolution block", () => {
  let store: GraphStore;
  let httpApi: HttpApiServer;
  let port: number;

  beforeEach(async () => {
    store = new GraphStore();
    port = 21000 + Math.floor(Math.random() * 900);
    httpApi = new HttpApiServer(store, makeMockClusterConfig(), port);
    await httpApi.start();
  });

  afterEach(async () => {
    await httpApi.stop();
  });

  it("/api/v1/diag includes importResolution block", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(data).toHaveProperty("importResolution");
    expect(data.importResolution).toHaveProperty("resolvedEdges");
    expect(data.importResolution).toHaveProperty("unresolvedSpecifiers");
    expect(data.importResolution).toHaveProperty("skippedExternals");
    expect(data.importResolution).toHaveProperty("topUnresolvedReasons");
  });

  it("/api/v1/diag importResolution.unresolvedSpecifiers matches stored unresolved", async () => {
    store.upsertFileResult(
      makeFileResult("src/a.ts", [
        { specifier: "@/x", reason: "alias-no-match" },
        { specifier: "@/y", reason: "alias-no-match" },
      ]),
    );

    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(data.importResolution.unresolvedSpecifiers).toBe(2);
    expect(data.importResolution.topUnresolvedReasons["alias-no-match"]).toBe(2);
  });

  it("degraded flag triggers when unresolvedSpecifiers > 10 and ratio > 25%", async () => {
    // 11 unresolved, 0 resolved → ratio = 100% > 25%
    const unresolved: UnresolvedImportEntry[] = Array.from({ length: 11 }, (_, i) => ({
      specifier: `@/missing${i}`,
      reason: "alias-no-match" as const,
    }));
    store.upsertFileResult(makeFileResult("src/a.ts", unresolved, []));

    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(data.degraded).toBe(true);
    expect(data.reasons).toContain("high-unresolved-import-ratio");
  });

  it("degraded flag does NOT trigger when unresolvedSpecifiers <= 10", async () => {
    const unresolved: UnresolvedImportEntry[] = Array.from({ length: 5 }, (_, i) => ({
      specifier: `@/missing${i}`,
      reason: "alias-no-match" as const,
    }));
    store.upsertFileResult(makeFileResult("src/a.ts", unresolved, []));

    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(data.degraded).toBe(false);
  });

  it("degraded flag does NOT trigger when ratio <= 25% even with n > 10", async () => {
    // 11 unresolved, 100 resolved → ratio ~10% < 25%
    const resolved = Array.from({ length: 100 }, (_, i) => `src/file${i}.ts`);
    const unresolved: UnresolvedImportEntry[] = Array.from({ length: 11 }, (_, i) => ({
      specifier: `@/missing${i}`,
      reason: "alias-no-match" as const,
    }));
    store.upsertFileResult(makeFileResult("src/a.ts", unresolved, resolved));

    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const data = await res.json();
    expect(data.degraded).toBe(false);
  });
});

describe("HTTP API — GET /api/v1/mcp/unresolved_imports", () => {
  let store: GraphStore;
  let httpApi: HttpApiServer;
  let port: number;

  beforeEach(async () => {
    store = new GraphStore();
    port = 21900 + Math.floor(Math.random() * 100);
    httpApi = new HttpApiServer(store, makeMockClusterConfig(), port);
    await httpApi.start();
  });

  afterEach(async () => {
    await httpApi.stop();
  });

  it("returns empty result when no unresolved imports", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/mcp/unresolved_imports`);
    const data = await res.json();
    expect(data.totalFiles).toBe(0);
    expect(data.totalSpecifiers).toBe(0);
    expect(data.entries).toHaveLength(0);
    expect(data.truncated).toBe(false);
  });

  it("returns all unresolved imports", async () => {
    store.upsertFileResult(
      makeFileResult("src/a.ts", [{ specifier: "@/x", reason: "alias-no-match" }]),
    );
    store.upsertFileResult(
      makeFileResult("src/b.ts", [{ specifier: "./missing", reason: "missing-file" }]),
    );

    const res = await fetch(`http://localhost:${port}/api/v1/mcp/unresolved_imports`);
    const data = await res.json();
    expect(data.totalFiles).toBe(2);
    expect(data.totalSpecifiers).toBe(2);
    expect(data.truncated).toBe(false);
  });

  it("honours file_pattern query param", async () => {
    store.upsertFileResult(
      makeFileResult("src/a.ts", [{ specifier: "@/x", reason: "alias-no-match" }]),
    );
    store.upsertFileResult(
      makeFileResult("lib/b.ts", [{ specifier: "@/y", reason: "alias-no-match" }]),
    );

    const res = await fetch(
      `http://localhost:${port}/api/v1/mcp/unresolved_imports?file_pattern=src/**`,
    );
    const data = await res.json();
    expect(data.totalFiles).toBe(1);
    expect(data.entries[0].filePath).toBe("src/a.ts");
  });

  it("honours reason query param filter", async () => {
    store.upsertFileResult(
      makeFileResult("src/a.ts", [
        { specifier: "@/x", reason: "alias-no-match" },
        { specifier: "./missing", reason: "missing-file" },
      ]),
    );

    const res = await fetch(
      `http://localhost:${port}/api/v1/mcp/unresolved_imports?reason=missing-file`,
    );
    const data = await res.json();
    expect(data.totalSpecifiers).toBe(1);
    expect(data.entries[0].unresolved[0].reason).toBe("missing-file");
  });

  it("truncates results when entries exceed limit", async () => {
    for (let i = 0; i < 5; i++) {
      store.upsertFileResult(
        makeFileResult(`src/file${i}.ts`, [{ specifier: "@/x", reason: "alias-no-match" }]),
      );
    }

    const res = await fetch(
      `http://localhost:${port}/api/v1/mcp/unresolved_imports?limit=3`,
    );
    const data = await res.json();
    expect(data.entries).toHaveLength(3);
    expect(data.truncated).toBe(true);
  });

  it("caps limit at 1000", async () => {
    const res = await fetch(
      `http://localhost:${port}/api/v1/mcp/unresolved_imports?limit=99999`,
    );
    expect(res.status).toBe(200);
    // Should not throw — just capped internally
    const data = await res.json();
    expect(data).toHaveProperty("entries");
  });
});
