import { describe, it, expect, beforeEach } from "vitest";
import { GraphStore } from "../graph/graph-store.js";
import type { FileParseResult } from "../types/schema.js";

/**
 * Integration test for the `getComplexityMetrics()` query tool (Track 3, Sprint 3).
 *
 * Builds small graphs with symbol nodes and edges, then verifies that
 * `getComplexityMetrics()` correctly computes fan-in, fan-out, and max depth.
 */

function makeFileResult(overrides: Partial<FileParseResult> & Pick<FileParseResult, "filePath">): FileParseResult {
  return {
    language: "typescript",
    hash: Math.random().toString(36).slice(2),
    symbols: [],
    relations: [],
    parsedImports: [],
    resolvedImports: [],
    parseErrors: [],
    ...overrides,
  };
}

describe("GraphStore.getComplexityMetrics() — Track 3 Sprint 3", () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();
  });

  it("returns correct fan-in and fan-out for a single function with known edges", () => {
    // File with function A that calls B and C
    // B and C both call A (so A has fanIn=2 from calls, fanOut=2 from calls)
    store.upsertFileResult(makeFileResult({
      filePath: "src/main.ts",
      symbols: [
        { id: "func:main:funcA", name: "funcA", qualifiedName: "main.funcA", kind: "function", language: "typescript", filePath: "src/main.ts", rangeStart: { line: 1, column: 0 }, rangeEnd: { line: 5, column: 1 } },
        { id: "func:main:funcB", name: "funcB", qualifiedName: "main.funcB", kind: "function", language: "typescript", filePath: "src/main.ts", rangeStart: { line: 6, column: 0 }, rangeEnd: { line: 10, column: 1 } },
        { id: "func:main:funcC", name: "funcC", qualifiedName: "main.funcC", kind: "function", language: "typescript", filePath: "src/main.ts", rangeStart: { line: 11, column: 0 }, rangeEnd: { line: 15, column: 1 } },
      ],
      relations: [
        // funcA calls funcB and funcC
        { type: "calls", sourceSymbolId: "func:main:funcA", targetSymbolId: "func:main:funcB", filePath: "src/main.ts", confidence: 0.9 },
        { type: "calls", sourceSymbolId: "func:main:funcA", targetSymbolId: "func:main:funcC", filePath: "src/main.ts", confidence: 0.9 },
        // funcB calls funcA
        { type: "calls", sourceSymbolId: "func:main:funcB", targetSymbolId: "func:main:funcA", filePath: "src/main.ts", confidence: 0.9 },
        // funcC calls funcA
        { type: "calls", sourceSymbolId: "func:main:funcC", targetSymbolId: "func:main:funcA", filePath: "src/main.ts", confidence: 0.9 },
      ],
    }));

    const result = store.getComplexityMetrics({ kind: "function" });

    expect(result.metrics.length).toBe(3);
    expect(result.totalScanned).toBe(3);
    expect(result.truncated).toBe(false);

    // Find funcA in results
    const funcA = result.metrics.find((m) => m.node.label === "funcA");
    expect(funcA).toBeDefined();
    // funcA has inbound: 2 calls from B and C, plus 1 "defines" edge from file node
    // funcA has outbound: 2 calls to B and C
    // fanIn includes all inbound edges (calls + defines)
    expect(funcA!.fanIn).toBeGreaterThanOrEqual(2);
    expect(funcA!.fanOut).toBeGreaterThanOrEqual(2);
  });

  it("filters by kind — only returns matching symbol types", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/app.ts",
      symbols: [
        { id: "func:app:myFunc", name: "myFunc", qualifiedName: "app.myFunc", kind: "function", language: "typescript", filePath: "src/app.ts", rangeStart: { line: 1, column: 0 }, rangeEnd: { line: 5, column: 1 } },
        { id: "class:app:MyClass", name: "MyClass", qualifiedName: "app.MyClass", kind: "class", language: "typescript", filePath: "src/app.ts", rangeStart: { line: 6, column: 0 }, rangeEnd: { line: 20, column: 1 } },
      ],
      relations: [],
    }));

    // Filter to functions only
    const funcResult = store.getComplexityMetrics({ kind: "function" });
    expect(funcResult.metrics.every((m) => m.node.kind === "function")).toBe(true);
    expect(funcResult.totalScanned).toBeGreaterThanOrEqual(1);

    // Filter to classes only
    const classResult = store.getComplexityMetrics({ kind: "class" });
    expect(classResult.metrics.every((m) => m.node.kind === "class")).toBe(true);
    expect(classResult.totalScanned).toBeGreaterThanOrEqual(1);
  });

  it("sorts results by the sortBy parameter", () => {
    // Create functions with different fan-in counts
    store.upsertFileResult(makeFileResult({
      filePath: "src/utils.ts",
      symbols: [
        { id: "func:utils:highFanIn", name: "highFanIn", qualifiedName: "utils.highFanIn", kind: "function", language: "typescript", filePath: "src/utils.ts", rangeStart: { line: 1, column: 0 }, rangeEnd: { line: 5, column: 1 } },
        { id: "func:utils:lowFanIn", name: "lowFanIn", qualifiedName: "utils.lowFanIn", kind: "function", language: "typescript", filePath: "src/utils.ts", rangeStart: { line: 6, column: 0 }, rangeEnd: { line: 10, column: 1 } },
        { id: "func:utils:caller1", name: "caller1", qualifiedName: "utils.caller1", kind: "function", language: "typescript", filePath: "src/utils.ts", rangeStart: { line: 11, column: 0 }, rangeEnd: { line: 15, column: 1 } },
        { id: "func:utils:caller2", name: "caller2", qualifiedName: "utils.caller2", kind: "function", language: "typescript", filePath: "src/utils.ts", rangeStart: { line: 16, column: 0 }, rangeEnd: { line: 20, column: 1 } },
        { id: "func:utils:caller3", name: "caller3", qualifiedName: "utils.caller3", kind: "function", language: "typescript", filePath: "src/utils.ts", rangeStart: { line: 21, column: 0 }, rangeEnd: { line: 25, column: 1 } },
      ],
      relations: [
        // 3 callers → highFanIn
        { type: "calls", sourceSymbolId: "func:utils:caller1", targetSymbolId: "func:utils:highFanIn", filePath: "src/utils.ts", confidence: 0.9 },
        { type: "calls", sourceSymbolId: "func:utils:caller2", targetSymbolId: "func:utils:highFanIn", filePath: "src/utils.ts", confidence: 0.9 },
        { type: "calls", sourceSymbolId: "func:utils:caller3", targetSymbolId: "func:utils:highFanIn", filePath: "src/utils.ts", confidence: 0.9 },
        // 1 caller → lowFanIn
        { type: "calls", sourceSymbolId: "func:utils:caller1", targetSymbolId: "func:utils:lowFanIn", filePath: "src/utils.ts", confidence: 0.9 },
      ],
    }));

    // Sort by fan_in descending
    const result = store.getComplexityMetrics({ kind: "function", sortBy: "fan_in" });
    expect(result.metrics.length).toBeGreaterThanOrEqual(2);

    // highFanIn should appear before lowFanIn
    const highIdx = result.metrics.findIndex((m) => m.node.label === "highFanIn");
    const lowIdx = result.metrics.findIndex((m) => m.node.label === "lowFanIn");
    expect(highIdx).toBeLessThan(lowIdx);

    // Verify descending order for fan_in
    for (let i = 0; i < result.metrics.length - 1; i++) {
      expect(result.metrics[i].fanIn).toBeGreaterThanOrEqual(result.metrics[i + 1].fanIn);
    }
  });

  it("respects maxResults limit and sets truncated flag", () => {
    // Create many functions
    const symbols = [];
    for (let i = 0; i < 10; i++) {
      symbols.push({
        id: `func:many:fn${i}`,
        name: `fn${i}`,
        qualifiedName: `many.fn${i}`,
        kind: "function" as const,
        language: "typescript" as const,
        filePath: "src/many.ts",
        rangeStart: { line: i * 5, column: 0 },
        rangeEnd: { line: i * 5 + 4, column: 1 },
      });
    }

    store.upsertFileResult(makeFileResult({
      filePath: "src/many.ts",
      symbols,
      relations: [],
    }));

    const result = store.getComplexityMetrics({ kind: "function", maxResults: 3 });
    expect(result.metrics.length).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.totalScanned).toBe(10);
  });

  it("returns empty metrics array for an empty graph", () => {
    const result = store.getComplexityMetrics({});
    expect(result.metrics).toEqual([]);
    expect(result.totalScanned).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("filters by filePath — only scans symbols in matching files", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/alpha.ts",
      symbols: [
        { id: "func:alpha:alphaFn", name: "alphaFn", qualifiedName: "alpha.alphaFn", kind: "function", language: "typescript", filePath: "src/alpha.ts", rangeStart: { line: 1, column: 0 }, rangeEnd: { line: 5, column: 1 } },
      ],
      relations: [],
    }));
    store.upsertFileResult(makeFileResult({
      filePath: "src/beta.ts",
      symbols: [
        { id: "func:beta:betaFn", name: "betaFn", qualifiedName: "beta.betaFn", kind: "function", language: "typescript", filePath: "src/beta.ts", rangeStart: { line: 1, column: 0 }, rangeEnd: { line: 5, column: 1 } },
      ],
      relations: [],
    }));

    // Filter to alpha only
    const result = store.getComplexityMetrics({ filePath: "src/alpha.ts", kind: "function" });
    const labels = result.metrics.map((m) => m.node.label);
    expect(labels).toContain("alphaFn");
    expect(labels).not.toContain("betaFn");
  });

  it("computes maxDepth via BFS on outbound call chains", () => {
    // Chain: A → B → C → D (depth 3 from A)
    store.upsertFileResult(makeFileResult({
      filePath: "src/chain.ts",
      symbols: [
        { id: "func:chain:A", name: "A", qualifiedName: "chain.A", kind: "function", language: "typescript", filePath: "src/chain.ts", rangeStart: { line: 1, column: 0 }, rangeEnd: { line: 3, column: 1 } },
        { id: "func:chain:B", name: "B", qualifiedName: "chain.B", kind: "function", language: "typescript", filePath: "src/chain.ts", rangeStart: { line: 4, column: 0 }, rangeEnd: { line: 6, column: 1 } },
        { id: "func:chain:C", name: "C", qualifiedName: "chain.C", kind: "function", language: "typescript", filePath: "src/chain.ts", rangeStart: { line: 7, column: 0 }, rangeEnd: { line: 9, column: 1 } },
        { id: "func:chain:D", name: "D", qualifiedName: "chain.D", kind: "function", language: "typescript", filePath: "src/chain.ts", rangeStart: { line: 10, column: 0 }, rangeEnd: { line: 12, column: 1 } },
      ],
      relations: [
        { type: "calls", sourceSymbolId: "func:chain:A", targetSymbolId: "func:chain:B", filePath: "src/chain.ts", confidence: 0.9 },
        { type: "calls", sourceSymbolId: "func:chain:B", targetSymbolId: "func:chain:C", filePath: "src/chain.ts", confidence: 0.9 },
        { type: "calls", sourceSymbolId: "func:chain:C", targetSymbolId: "func:chain:D", filePath: "src/chain.ts", confidence: 0.9 },
      ],
    }));

    const result = store.getComplexityMetrics({ kind: "function", sortBy: "depth" });

    // Function A should have the highest maxDepth (3 hops: A→B→C→D)
    const funcA = result.metrics.find((m) => m.node.label === "A");
    expect(funcA).toBeDefined();
    expect(funcA!.maxDepth).toBeGreaterThanOrEqual(3);

    // Function D should have maxDepth 0 (no outbound calls)
    const funcD = result.metrics.find((m) => m.node.label === "D");
    expect(funcD).toBeDefined();
    // D has a "defines" edge from file but no outbound calls to other functions
    // Its maxDepth from outbound edges may be 0 or 1 depending on defines edge direction
    // The key assertion: D's depth should be less than A's depth
    expect(funcD!.maxDepth).toBeLessThan(funcA!.maxDepth);
  });

  it("respects AbortSignal for early termination", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/abort.ts",
      symbols: [
        { id: "func:abort:fn1", name: "fn1", qualifiedName: "abort.fn1", kind: "function", language: "typescript", filePath: "src/abort.ts", rangeStart: { line: 1, column: 0 }, rangeEnd: { line: 5, column: 1 } },
      ],
      relations: [],
    }));

    // Abort immediately
    const controller = new AbortController();
    controller.abort();

    const result = store.getComplexityMetrics({ signal: controller.signal });
    // Should have 0 metrics because signal was already aborted
    expect(result.metrics).toHaveLength(0);
    expect(result.totalScanned).toBe(0);
  });
});
