import { describe, expect, it, vi } from "vitest";
import {
  createMcpContextResolver,
  fetchMcpContext,
  extractGraphSymbols,
} from "./mcp-context-resolver";

/** Build a fake fetch that routes by URL substring to canned JSON responses. */
function fakeFetch(routes: Record<string, { ok?: boolean; body: unknown }>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    const route = key ? routes[key] : undefined;
    return {
      ok: route?.ok ?? true,
      json: async () => route?.body ?? {},
    } as Response;
  });
}

const GRAPH = {
  nodes: [
    {
      id: "symbol:src/run-executor.ts:function:executeRun:10:1",
      type: "function",
      label: "executeRun",
      qualifiedName: "run-executor.executeRun",
      filePath: "src/run-executor.ts",
      metadata: { rangeStart: { line: 10 } },
    },
    {
      id: "symbol:src/process-manager.ts:class:ProcessManager:5:1",
      type: "class",
      label: "ProcessManager",
      qualifiedName: "ProcessManager",
      filePath: "src/process-manager.ts",
      metadata: { rangeStart: { line: 5 } },
    },
    { id: "file:src/run-executor.ts", type: "file", filePath: "src/run-executor.ts", qualifiedName: "x" },
    { id: "symbol:external:mongoose", type: "external", qualifiedName: "mongoose" },
  ],
  edges: [
    {
      source: "symbol:src/run-executor.ts:function:executeRun:10:1",
      target: "symbol:src/process-manager.ts:class:ProcessManager:5:1",
      type: "calls",
    },
  ],
};

describe("fetchMcpContext", () => {
  it("returns undefined when the index is empty (0 files) → caller falls back", async () => {
    const f = fakeFetch({ "/api/v1/diag": { body: { fileCount: { total: 0 }, degraded: true } } });
    expect(await fetchMcpContext("http://mcp", f)).toBeUndefined();
    // the graph must NOT be queried once diag shows an empty index.
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when diag is unreachable", async () => {
    const f = fakeFetch({ "/api/v1/diag": { ok: false, body: {} } });
    expect(await fetchMcpContext("http://mcp", f)).toBeUndefined();
  });

  it("maps diag stats + the dependency graph into a CodebaseContext", async () => {
    const f = fakeFetch({
      "/api/v1/diag": { body: { fileCount: { total: 42, ts: 30, python: 12 } } },
      "/api/v1/mcp/graph": { body: GRAPH },
    });

    const ctx = await fetchMcpContext("http://mcp/", f);
    expect(ctx).toBeDefined();
    expect(ctx?.stats?.fileCount).toBe(42);
    expect(ctx?.stats?.languages).toEqual(
      expect.arrayContaining(["TypeScript/JavaScript", "Python"]),
    );
    // files come from the LOCAL symbol nodes (file/external nodes excluded).
    expect(ctx?.files).toEqual(
      expect.arrayContaining(["src/run-executor.ts", "src/process-manager.ts"]),
    );
    expect(ctx?.symbols?.[0]).toBe("run-executor.executeRun — src/run-executor.ts");
    // external/file nodes are NOT symbols.
    expect(ctx?.symbols?.some((s) => s.includes("mongoose"))).toBe(false);
    // Phase 5: the call edge is translated to names.
    expect(ctx?.edges).toContainEqual({
      from: "run-executor.executeRun",
      to: "ProcessManager",
      type: "calls",
    });
    expect(ctx?.repoSummary).toContain("42 files indexed");
    expect(ctx?.repoSummary).toContain("executeRun");
  });
});

describe("extractGraphSymbols", () => {
  it("keeps only local code symbols (drops file/external/module nodes)", () => {
    const syms = extractGraphSymbols(GRAPH);
    expect(syms.map((s) => s.symbol)).toEqual([
      "run-executor.executeRun — src/run-executor.ts",
      "ProcessManager — src/process-manager.ts",
    ]);
  });

  it("ranks by connectivity (degree) desc", () => {
    const g = {
      nodes: [
        { id: "a", type: "function", qualifiedName: "A", filePath: "a.ts" },
        { id: "b", type: "function", qualifiedName: "B", filePath: "b.ts" },
      ],
      edges: [
        { source: "x", target: "b", type: "calls" },
        { source: "y", target: "b", type: "calls" }, // B has degree 2, A has 0
      ],
    };
    expect(extractGraphSymbols(g).map((s) => s.symbol.split(" — ")[0])).toEqual(["B", "A"]);
  });

  it("recovers the line from the node id when metadata is absent", () => {
    const g = {
      nodes: [
        { id: "symbol:a.ts:function:foo:77:3", type: "function", qualifiedName: "foo", filePath: "a.ts" },
      ],
      edges: [],
    };
    expect(extractGraphSymbols(g)[0].line).toBe(77);
  });

  it("caps to the limit", () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`,
      type: "function",
      qualifiedName: `f${i}`,
      filePath: `${i}.ts`,
    }));
    expect(extractGraphSymbols({ nodes, edges: [] }, 3)).toHaveLength(3);
  });

  it("returns [] for non-object / empty input", () => {
    expect(extractGraphSymbols(null)).toEqual([]);
    expect(extractGraphSymbols({})).toEqual([]);
  });
});

describe("createMcpContextResolver", () => {
  it("never throws — a thrown fetch resolves to undefined", async () => {
    const resolver = createMcpContextResolver({
      baseUrl: "http://mcp",
      fetchImpl: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    await expect(resolver()).resolves.toBeUndefined();
  });
});
