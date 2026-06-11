/**
 * Regression tests for FIX-03 — Multi-Root Workspace Defaults.
 *
 * Verifies that the indexer works correctly on an arbitrary workspace layout
 * that has no `backend/`, `frontend/src/`, or `services/` directories.
 *
 * Fixture layout:
 *   apps/web/src/index.ts
 *   packages/utils/src/greet.ts
 *   scripts/build.ts
 *   config/settings.ts
 */
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { resolveWatchPaths } from "../watcher/file-watcher.js";
import { IncrementalIndexer } from "../indexer/incremental-indexer.js";
import { GraphStore } from "../graph/graph-store.js";

const FIXTURE_ROOT = path.resolve(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "fixtures/arbitrary-layout",
);

describe("FIX-03 — arbitrary workspace layout", () => {
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv = {
      PYTHON_WATCH_GLOBS: process.env.PYTHON_WATCH_GLOBS,
      TS_WATCH_GLOBS: process.env.TS_WATCH_GLOBS,
    };
    delete process.env.PYTHON_WATCH_GLOBS;
    delete process.env.TS_WATCH_GLOBS;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("resolveWatchPaths defaults to workspace root — no backend/ or frontend/src/", () => {
    const paths = resolveWatchPaths(FIXTURE_ROOT);
    // Must be exactly [workspaceRoot] — no hardcoded subdirectory assumptions
    expect(paths).toEqual([FIXTURE_ROOT]);
    expect(paths).not.toContain(path.join(FIXTURE_ROOT, "backend"));
    expect(paths).not.toContain(path.join(FIXTURE_ROOT, "frontend/src"));
  });

  it("buildInitialGraph indexes all TS files in an arbitrary layout", async () => {
    const graphStore = new GraphStore();
    const indexer = new IncrementalIndexer(FIXTURE_ROOT, graphStore);

    const { indexedFiles } = await indexer.buildInitialGraph();

    // All 4 fixture TS files must be indexed
    expect(indexedFiles).toBe(4);

    const indexed = graphStore.getIndexedFilePaths();
    expect(indexed.some((f) => f.includes("apps/web/src/index.ts"))).toBe(true);
    expect(indexed.some((f) => f.includes("packages/utils/src/greet.ts"))).toBe(true);
    expect(indexed.some((f) => f.includes("scripts/build.ts"))).toBe(true);
    expect(indexed.some((f) => f.includes("config/settings.ts"))).toBe(true);
  });
});
