import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { resolveGlobPatterns } from "../indexer/incremental-indexer.js";
import { resolveWatchPaths } from "../watcher/file-watcher.js";
import { splitCsvRespectingBraces, resolveIgnorePatterns, DEFAULT_IGNORE_PATTERNS } from "../utils/glob-utils.js";

// ─── splitCsvRespectingBraces ────────────────────────────────────────────────

describe("splitCsvRespectingBraces", () => {
  it("splits simple comma-separated values", () => {
    expect(splitCsvRespectingBraces("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("preserves braces — does not split on commas inside {}", () => {
    expect(splitCsvRespectingBraces("app/**/*.{ts,tsx},lib/**/*.{ts,tsx}")).toEqual([
      "app/**/*.{ts,tsx}",
      "lib/**/*.{ts,tsx}",
    ]);
  });

  it("handles nested braces", () => {
    expect(splitCsvRespectingBraces("a/{b,c}/{d,e},f")).toEqual(["a/{b,c}/{d,e}", "f"]);
  });

  it("trims whitespace around tokens", () => {
    expect(splitCsvRespectingBraces(" a , b , c ")).toEqual(["a", "b", "c"]);
  });

  it("returns single-element array for no commas", () => {
    expect(splitCsvRespectingBraces("**/*.py")).toEqual(["**/*.py"]);
  });

  it("filters empty tokens", () => {
    expect(splitCsvRespectingBraces("a,,b")).toEqual(["a", "b"]);
  });
});

// ─── resolveGlobPatterns ─────────────────────────────────────────────────────

describe("resolveGlobPatterns", () => {
  let originalPython: string | undefined;
  let originalTs: string | undefined;

  beforeEach(() => {
    originalPython = process.env.PYTHON_WATCH_GLOBS;
    originalTs = process.env.TS_WATCH_GLOBS;
    delete process.env.PYTHON_WATCH_GLOBS;
    delete process.env.TS_WATCH_GLOBS;
  });

  afterEach(() => {
    if (originalPython === undefined) delete process.env.PYTHON_WATCH_GLOBS;
    else process.env.PYTHON_WATCH_GLOBS = originalPython;
    if (originalTs === undefined) delete process.env.TS_WATCH_GLOBS;
    else process.env.TS_WATCH_GLOBS = originalTs;
  });

  it("returns workspace-wide Python default when PYTHON_WATCH_GLOBS is unset", () => {
    const { pythonPatterns } = resolveGlobPatterns();
    expect(pythonPatterns).toEqual(["**/*.py"]);
  });

  it("returns workspace-wide TS default when TS_WATCH_GLOBS is unset", () => {
    const { tsPatterns } = resolveGlobPatterns();
    expect(tsPatterns).toEqual(["**/*.{ts,tsx,js,jsx}"]);
  });

  it("returns custom Python pattern when PYTHON_WATCH_GLOBS=src/**/*.py", () => {
    process.env.PYTHON_WATCH_GLOBS = "src/**/*.py";
    const { pythonPatterns } = resolveGlobPatterns();
    expect(pythonPatterns).toEqual(["src/**/*.py"]);
  });

  it("returns custom TS patterns when TS_WATCH_GLOBS=app/**/*.ts,lib/**/*.ts", () => {
    process.env.TS_WATCH_GLOBS = "app/**/*.ts,lib/**/*.ts";
    const { tsPatterns } = resolveGlobPatterns();
    expect(tsPatterns).toEqual(["app/**/*.ts", "lib/**/*.ts"]);
  });

  it("preserves braces in TS_WATCH_GLOBS — brace-aware split", () => {
    process.env.TS_WATCH_GLOBS = "app/**/*.{ts,tsx},lib/**/*.{ts,tsx}";
    const { tsPatterns } = resolveGlobPatterns();
    expect(tsPatterns).toEqual(["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"]);
  });
});

// ─── resolveIgnorePatterns ───────────────────────────────────────────────────

describe("resolveIgnorePatterns", () => {
  let originalIgnores: string | undefined;

  beforeEach(() => {
    originalIgnores = process.env.WATCH_IGNORES;
    delete process.env.WATCH_IGNORES;
  });

  afterEach(() => {
    if (originalIgnores === undefined) delete process.env.WATCH_IGNORES;
    else process.env.WATCH_IGNORES = originalIgnores;
  });

  it("returns DEFAULT_IGNORE_PATTERNS when WATCH_IGNORES is unset", () => {
    expect(resolveIgnorePatterns()).toEqual(DEFAULT_IGNORE_PATTERNS);
  });

  it("returns DEFAULT_IGNORE_PATTERNS when WATCH_IGNORES is empty string", () => {
    process.env.WATCH_IGNORES = "";
    expect(resolveIgnorePatterns()).toEqual(DEFAULT_IGNORE_PATTERNS);
  });

  it("returns custom patterns when WATCH_IGNORES is set", () => {
    process.env.WATCH_IGNORES = "custom/**,other/**";
    expect(resolveIgnorePatterns()).toEqual(["custom/**", "other/**"]);
  });

  it("preserves braces in WATCH_IGNORES", () => {
    process.env.WATCH_IGNORES = "**/dist/**,**/.{next,turbo}/**";
    expect(resolveIgnorePatterns()).toEqual(["**/dist/**", "**/.{next,turbo}/**"]);
  });

  it("DEFAULT_IGNORE_PATTERNS includes node_modules, .git, and mcp-context-* excludes", () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain("**/node_modules/**");
    expect(DEFAULT_IGNORE_PATTERNS).toContain("**/.git/**");
    expect(DEFAULT_IGNORE_PATTERNS).toContain("**/.tools/mcp-context-*/**");
    expect(DEFAULT_IGNORE_PATTERNS).toContain("**/services/mcp-context-*/**");
  });
});

// ─── resolveWatchPaths ───────────────────────────────────────────────────────

describe("resolveWatchPaths", () => {
  let originalPython: string | undefined;
  let originalTs: string | undefined;

  beforeEach(() => {
    originalPython = process.env.PYTHON_WATCH_GLOBS;
    originalTs = process.env.TS_WATCH_GLOBS;
    delete process.env.PYTHON_WATCH_GLOBS;
    delete process.env.TS_WATCH_GLOBS;
  });

  afterEach(() => {
    if (originalPython === undefined) delete process.env.PYTHON_WATCH_GLOBS;
    else process.env.PYTHON_WATCH_GLOBS = originalPython;
    if (originalTs === undefined) delete process.env.TS_WATCH_GLOBS;
    else process.env.TS_WATCH_GLOBS = originalTs;
  });

  it("returns default watch dirs when no env vars set", () => {
    const paths = resolveWatchPaths("/workspace");
    expect(paths).toEqual(["/workspace"]);
  });

  it("extracts top-level dir from PYTHON_WATCH_GLOBS", () => {
    process.env.PYTHON_WATCH_GLOBS = "src/**/*.py";
    const paths = resolveWatchPaths("/workspace");
    expect(paths).toContain("/workspace/src");
  });

  it("extracts multi-segment prefix from TS_WATCH_GLOBS (frontend/src)", () => {
    process.env.TS_WATCH_GLOBS = "frontend/src/**/*.{ts,tsx}";
    const paths = resolveWatchPaths("/workspace");
    expect(paths).toContain("/workspace/frontend/src");
  });

  it("deduplicates overlapping glob prefixes", () => {
    process.env.TS_WATCH_GLOBS = "app/**/*.ts,app/**/*.tsx";
    const paths = resolveWatchPaths("/workspace");
    expect(paths.filter((p) => p.endsWith("/app"))).toHaveLength(1);
  });

  it("correctly extracts prefix from brace-expansion glob", () => {
    process.env.TS_WATCH_GLOBS = "app/**/*.{ts,tsx},lib/**/*.{ts,tsx}";
    const paths = resolveWatchPaths("/workspace");
    expect(paths).toContain("/workspace/app");
    expect(paths).toContain("/workspace/lib");
  });
});
