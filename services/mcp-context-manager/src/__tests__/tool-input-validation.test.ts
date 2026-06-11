import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HttpApiServer } from "../api.js";
import { GraphStore } from "../graph/graph-store.js";
import { ClusterConfigLoader } from "../cluster/cluster-config-loader.js";
import { validateGlob, validateRegex } from "../utils/glob-utils.js";
import { ToolInputError } from "../utils/tool-input-error.js";
import type { FileParseResult } from "../types/schema.js";

function makeFileResult(filePath: string): FileParseResult {
  return {
    filePath,
    language: "typescript",
    hash: `hash-${filePath}`,
    symbols: [],
    relations: [],
    parsedImports: [],
    resolvedImports: [],
    parseErrors: [],
  };
}

const fakeCluster = {
  getClusters: () => [{ id: "root", path: "./", label: "Root", color: "#000" }],
  getClusterForFile: () => ({ id: "root", path: "./", label: "Root", color: "#000" }),
  startWatching: () => {},
  stopWatching: () => {},
} as unknown as ClusterConfigLoader;

// ─── Unit tests: validateGlob ────────────────────────────────────────────────

describe("validateGlob", () => {
  it("rejects comma-separated glob without brace-expansion", () => {
    expect(() => validateGlob("*.ts,*.tsx")).toThrow(ToolInputError);
    expect(() => validateGlob("*.ts,*.tsx")).toThrow(/brace-expansion/);
  });

  it("accepts brace-expansion glob", () => {
    expect(() => validateGlob("*.{ts,tsx}")).not.toThrow();
  });

  it("accepts comma inside braces (brace-expansion with comma)", () => {
    expect(() => validateGlob("src/**/*.{ts,tsx,js}")).not.toThrow();
  });

  it("rejects absolute path (Unix-style)", () => {
    expect(() => validateGlob("/absolute/path/**/*.ts")).toThrow(ToolInputError);
    expect(() => validateGlob("/absolute/path/**/*.ts")).toThrow(/Absolute paths/);
  });

  it("rejects absolute path (Windows-style)", () => {
    expect(() => validateGlob("C:/Users/foo/**/*.ts")).toThrow(ToolInputError);
  });

  it("accepts relative glob without comma", () => {
    expect(() => validateGlob("src/**/*.ts")).not.toThrow();
  });
});

// ─── Unit tests: validateRegex ───────────────────────────────────────────────

describe("validateRegex", () => {
  it("returns a RegExp for a valid pattern", () => {
    const re = validateRegex("function\\s+\\w+");
    expect(re).toBeInstanceOf(RegExp);
  });

  it("throws ToolInputError with character-class hint for unclosed class", () => {
    expect(() => validateRegex("[a-z")).toThrow(ToolInputError);
    expect(() => validateRegex("[a-z")).toThrow(/Hint.*\\\[/);
  });

  it("throws ToolInputError with parens hint for unterminated group", () => {
    expect(() => validateRegex("(foo")).toThrow(ToolInputError);
    expect(() => validateRegex("(foo")).toThrow(/Hint.*parentheses/);
  });

  it("includes the original pattern in the error message", () => {
    try {
      validateRegex("[unclosed");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as ToolInputError).message).toContain("[unclosed");
    }
  });
});

// ─── HTTP handler tests ───────────────────────────────────────────────────────

describe("HTTP handlers — glob validation", () => {
  let graphStore: GraphStore;
  let httpApi: HttpApiServer;
  let port: number;

  beforeAll(async () => {
    graphStore = new GraphStore();
    graphStore.upsertFileResult(makeFileResult("src/app.ts"));
    port = 19200 + Math.floor(Math.random() * 800);
    httpApi = new HttpApiServer(graphStore, fakeCluster, port);
    await httpApi.start();
  });

  afterAll(async () => {
    await httpApi.stop();
  });

  it("GET /api/v1/mcp/dead-code rejects comma glob", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/mcp/dead-code?file_pattern=*.ts,*.tsx`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_PARAMS");
    expect(body.error).toMatch(/brace-expansion/);
  });

  it("POST /api/v1/mcp/dead-code rejects comma glob", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/mcp/dead-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_pattern: "*.ts,*.tsx" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_PARAMS");
  });

  it("GET /api/v1/mcp/dead-code accepts brace-expansion glob", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/mcp/dead-code?file_pattern=*.{ts,tsx}`);
    expect(res.status).toBe(200);
  });

  it("GET /api/v1/mcp/hotspots rejects absolute path glob", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/mcp/hotspots?file_pattern=/src/**/*.ts`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_PARAMS");
    expect(body.error).toMatch(/Absolute paths/);
  });

  it("GET /api/v1/mcp/circular-deps rejects comma glob", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/mcp/circular-deps?file_pattern=*.ts,*.tsx`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_PARAMS");
  });

  it("GET /api/v1/mcp/complexity rejects absolute path glob", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/mcp/complexity?file_path=/workspace/src/app.ts`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_PARAMS");
  });
});

describe("HTTP handlers — regex validation", () => {
  let graphStore: GraphStore;
  let httpApi: HttpApiServer;
  let port: number;

  beforeAll(async () => {
    graphStore = new GraphStore();
    graphStore.upsertFileResult(makeFileResult("src/app.ts"));
    port = 19000 + Math.floor(Math.random() * 800);
    httpApi = new HttpApiServer(graphStore, fakeCluster, port);
    await httpApi.start();
  });

  afterAll(async () => {
    await httpApi.stop();
  });

  it("GET /api/v1/mcp/search rejects unclosed character class when use_regex=true", async () => {
    const res = await fetch(
      `http://localhost:${port}/api/v1/mcp/search?query=${encodeURIComponent("[a-z")}&use_regex=true`,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_PARAMS");
    expect(body.error).toMatch(/Hint.*\\\[/);
  });

  it("POST /api/v1/mcp/search rejects unterminated group when use_regex=true", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/mcp/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "(foo", use_regex: true }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_PARAMS");
    expect(body.error).toMatch(/Hint.*parentheses/);
  });

  it("GET /api/v1/mcp/search does NOT validate regex when use_regex=false", async () => {
    // "(foo" is a valid literal search string — should not be rejected
    const res = await fetch(
      `http://localhost:${port}/api/v1/mcp/search?query=${encodeURIComponent("(foo")}&use_regex=false`,
    );
    expect(res.status).toBe(200);
  });
});

// ─── Zero-results reason field ────────────────────────────────────────────────

describe("Zero-results reason field", () => {
  let graphStore: GraphStore;
  let httpApi: HttpApiServer;
  let port: number;

  beforeAll(async () => {
    graphStore = new GraphStore();
    // Seed one file so the store is non-empty, but use a pattern that won't match
    graphStore.upsertFileResult(makeFileResult("src/app.ts"));
    port = 18900 + Math.floor(Math.random() * 800);
    httpApi = new HttpApiServer(graphStore, fakeCluster, port);
    await httpApi.start();
  });

  afterAll(async () => {
    await httpApi.stop();
  });

  it("dead-code: reason field present when totalScanned=0 and file_pattern is set", async () => {
    // Use a pattern that matches no indexed files
    const res = await fetch(`http://localhost:${port}/api/v1/mcp/dead-code?file_pattern=nonexistent/**/*.ts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalScanned).toBe(0);
    expect(body.reason).toBeDefined();
    expect(body.reason).toMatch(/nonexistent/);
  });

  it("dead-code: NO reason field when totalScanned=0 but no file_pattern", async () => {
    // Empty store — no pattern provided
    const emptyStore = new GraphStore();
    const emptyPort = 18800 + Math.floor(Math.random() * 100);
    const emptyApi = new HttpApiServer(emptyStore, fakeCluster, emptyPort);
    await emptyApi.start();
    try {
      const res = await fetch(`http://localhost:${emptyPort}/api/v1/mcp/dead-code`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.reason).toBeUndefined();
    } finally {
      await emptyApi.stop();
    }
  });

  it("dead-code: NO reason field when totalScanned > 0 (legitimate empty result)", async () => {
    // src/app.ts is indexed but has no symbols → totalScanned > 0, deadSymbols = []
    const res = await fetch(`http://localhost:${port}/api/v1/mcp/dead-code?file_pattern=src/**/*.ts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // totalScanned may be 0 if no symbols — only assert reason absent when totalScanned > 0
    if (body.totalScanned > 0) {
      expect(body.reason).toBeUndefined();
    }
  });

  it("circular-deps: reason field present when totalFilesScanned=0 and file_pattern is set", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/mcp/circular-deps?file_pattern=nonexistent/**/*.ts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalFilesScanned).toBe(0);
    expect(body.reason).toBeDefined();
    expect(body.reason).toMatch(/nonexistent/);
  });

  it("complexity: reason field present when totalScanned=0 and file_path is set", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/mcp/complexity?file_path=nonexistent/app.ts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalScanned).toBe(0);
    expect(body.reason).toBeDefined();
    expect(body.reason).toMatch(/nonexistent/);
  });
});
