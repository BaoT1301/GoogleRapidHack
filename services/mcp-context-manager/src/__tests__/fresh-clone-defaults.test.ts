/**
 * Fixture-based integration test for fresh-clone defaults.
 *
 * Uses the collab-guard-tree fixture which mirrors the nested-template layout:
 *   .tools/mcp-context-manager/src/**  ← should be EXCLUDED by default ignores
 *   collab-guard/src/**                ← should be INCLUDED
 *   extension/**                       ← should be INCLUDED (unless overridden)
 */
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fg from "fast-glob";

import { resolveIgnorePatterns, DEFAULT_IGNORE_PATTERNS } from "../utils/glob-utils.js";

const FIXTURE_ROOT = path.resolve(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "fixtures/collab-guard-tree",
);

// Helper: run fast-glob with given patterns + ignores against the fixture root
async function globFixture(patterns: string[], ignore: string[]): Promise<string[]> {
  return fg(patterns, { cwd: FIXTURE_ROOT, onlyFiles: true, ignore });
}

describe("fresh-clone-defaults — collab-guard fixture", () => {
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

  it("Test A — default globs index app code and exclude template source", async () => {
    const files = await globFixture(
      ["**/*.{ts,tsx,js,jsx}", "**/*.py"],
      resolveIgnorePatterns(),
    );

    // App files are present
    expect(files.some((f) => f.startsWith("collab-guard/"))).toBe(true);
    expect(files.some((f) => f.startsWith("extension/"))).toBe(true);

    // Template source is excluded
    expect(files.some((f) => f.includes(".tools/mcp-context-manager"))).toBe(false);

    // Total count: 7 app files (2 client + 3 server + 1 shared + 1 extension)
    expect(files.length).toBe(7);
  });

  it("Test B — brace-expansion TS_WATCH_GLOBS indexes only collab-guard files", async () => {
    process.env.TS_WATCH_GLOBS = "collab-guard/src/**/*.{ts,tsx}";

    const { splitCsvRespectingBraces } = await import("../utils/glob-utils.js");
    const patterns = splitCsvRespectingBraces(process.env.TS_WATCH_GLOBS);

    const files = await globFixture(patterns, resolveIgnorePatterns());

    expect(files.every((f) => f.startsWith("collab-guard/src/"))).toBe(true);
    expect(files.some((f) => f.startsWith("extension/"))).toBe(false);
    expect(files.length).toBeGreaterThan(0);
  });

  it("Test C — WATCH_IGNORES override excludes extension files", async () => {
    process.env.WATCH_IGNORES = "**/extension/**";

    const files = await globFixture(
      ["**/*.{ts,tsx,js,jsx}"],
      resolveIgnorePatterns(),
    );

    expect(files.some((f) => f.startsWith("extension/"))).toBe(false);
    expect(files.some((f) => f.startsWith("collab-guard/"))).toBe(true);
    // Template is NOT excluded by the custom ignore (only extension is), but
    // .tools/mcp-context-manager is still matched by the glob — that's expected
    // when the user overrides ignores. The test verifies the override works.
  });

  it("Test D — DEFAULT_IGNORE_PATTERNS includes both mcp-context-* exclude patterns", () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain("**/.tools/mcp-context-*/**");
    expect(DEFAULT_IGNORE_PATTERNS).toContain("**/services/mcp-context-*/**");
  });
});
