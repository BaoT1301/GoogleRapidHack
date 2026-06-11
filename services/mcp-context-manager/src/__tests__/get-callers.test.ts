import { describe, it, expect, beforeEach } from "vitest";
import { GraphStore } from "../graph/graph-store.js";
import type { FileParseResult } from "../types/schema.js";

/**
 * Integration test for the `getCallers()` query tool (Track 3).
 *
 * Builds a small graph with call edges and verifies that `getCallers()`
 * returns the correct reverse call graph at various depths.
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

describe("GraphStore.getCallers() — Track 3", () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();
  });

  it("returns null target when function is not found", () => {
    const result = store.getCallers({ functionName: "nonexistent" });
    expect(result.target).toBeNull();
    expect(result.callers).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("returns empty callers when function has no inbound call edges", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/utils.ts",
      symbols: [
        {
          id: "func:utils:orphan",
          name: "orphan",
          qualifiedName: "src.utils.orphan",
          kind: "function",
          language: "typescript",
          filePath: "src/utils.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        {
          type: "defines",
          sourceSymbolId: "file:src/utils.ts",
          targetSymbolId: "func:utils:orphan",
          filePath: "src/utils.ts",
          confidence: 1,
        },
      ],
    }));

    const result = store.getCallers({ functionName: "orphan" });
    expect(result.target).not.toBeNull();
    expect(result.target!.label).toBe("orphan");
    expect(result.callers).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("returns direct callers (depth 1) for a function with call edges", () => {
    // Build graph: funcA -> funcB -> funcC
    // funcA calls funcB, funcB calls funcC
    store.upsertFileResult(makeFileResult({
      filePath: "src/app.ts",
      symbols: [
        {
          id: "func:app:funcA",
          name: "funcA",
          qualifiedName: "src.app.funcA",
          kind: "function",
          language: "typescript",
          filePath: "src/app.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 5, column: 1 },
        },
        {
          id: "func:app:funcB",
          name: "funcB",
          qualifiedName: "src.app.funcB",
          kind: "function",
          language: "typescript",
          filePath: "src/app.ts",
          rangeStart: { line: 7, column: 1 },
          rangeEnd: { line: 11, column: 1 },
        },
        {
          id: "func:app:funcC",
          name: "funcC",
          qualifiedName: "src.app.funcC",
          kind: "function",
          language: "typescript",
          filePath: "src/app.ts",
          rangeStart: { line: 13, column: 1 },
          rangeEnd: { line: 17, column: 1 },
        },
      ],
      relations: [
        // File defines all three functions
        { type: "defines", sourceSymbolId: "file:src/app.ts", targetSymbolId: "func:app:funcA", filePath: "src/app.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/app.ts", targetSymbolId: "func:app:funcB", filePath: "src/app.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/app.ts", targetSymbolId: "func:app:funcC", filePath: "src/app.ts", confidence: 1 },
        // funcA calls funcB
        { type: "calls", sourceSymbolId: "func:app:funcA", targetSymbolId: "func:app:funcB", filePath: "src/app.ts", confidence: 1 },
        // funcB calls funcC
        { type: "calls", sourceSymbolId: "func:app:funcB", targetSymbolId: "func:app:funcC", filePath: "src/app.ts", confidence: 1 },
      ],
    }));

    // Get callers of funcC with depth 1 — should only return funcB
    const result = store.getCallers({ functionName: "funcC", maxDepth: 1 });
    expect(result.target).not.toBeNull();
    expect(result.target!.label).toBe("funcC");
    expect(result.callers).toHaveLength(1);
    expect(result.callers[0].node.label).toBe("funcB");
    expect(result.callers[0].depth).toBe(1);
    expect(result.callers[0].callEdge.type).toBe("calls");
    expect(result.truncated).toBe(false);
  });

  it("returns transitive callers up to maxDepth", () => {
    // Build graph: funcA -> funcB -> funcC
    store.upsertFileResult(makeFileResult({
      filePath: "src/chain.ts",
      symbols: [
        {
          id: "func:chain:funcA",
          name: "funcA",
          qualifiedName: "src.chain.funcA",
          kind: "function",
          language: "typescript",
          filePath: "src/chain.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
        {
          id: "func:chain:funcB",
          name: "funcB",
          qualifiedName: "src.chain.funcB",
          kind: "function",
          language: "typescript",
          filePath: "src/chain.ts",
          rangeStart: { line: 5, column: 1 },
          rangeEnd: { line: 7, column: 1 },
        },
        {
          id: "func:chain:funcC",
          name: "funcC",
          qualifiedName: "src.chain.funcC",
          kind: "function",
          language: "typescript",
          filePath: "src/chain.ts",
          rangeStart: { line: 9, column: 1 },
          rangeEnd: { line: 11, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/chain.ts", targetSymbolId: "func:chain:funcA", filePath: "src/chain.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/chain.ts", targetSymbolId: "func:chain:funcB", filePath: "src/chain.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/chain.ts", targetSymbolId: "func:chain:funcC", filePath: "src/chain.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: "func:chain:funcA", targetSymbolId: "func:chain:funcB", filePath: "src/chain.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: "func:chain:funcB", targetSymbolId: "func:chain:funcC", filePath: "src/chain.ts", confidence: 1 },
      ],
    }));

    // Get callers of funcC with depth 3 — should return funcB (depth 1) and funcA (depth 2)
    const result = store.getCallers({ functionName: "funcC", maxDepth: 3 });
    expect(result.target).not.toBeNull();
    expect(result.callers).toHaveLength(2);

    const callerLabels = result.callers.map((c) => c.node.label);
    expect(callerLabels).toContain("funcB");
    expect(callerLabels).toContain("funcA");

    const funcBCaller = result.callers.find((c) => c.node.label === "funcB")!;
    const funcACaller = result.callers.find((c) => c.node.label === "funcA")!;
    expect(funcBCaller.depth).toBe(1);
    expect(funcACaller.depth).toBe(2);
  });

  it("respects maxResults limit and sets truncated flag", () => {
    // Build graph: many functions all calling the same target
    const symbols = [
      {
        id: "func:fan:target",
        name: "target",
        qualifiedName: "src.fan.target",
        kind: "function" as const,
        language: "typescript" as const,
        filePath: "src/fan.ts",
        rangeStart: { line: 1, column: 1 },
        rangeEnd: { line: 3, column: 1 },
      },
    ];
    const relations: FileParseResult["relations"] = [
      { type: "defines", sourceSymbolId: "file:src/fan.ts", targetSymbolId: "func:fan:target", filePath: "src/fan.ts", confidence: 1 },
    ];

    for (let i = 0; i < 10; i++) {
      const id = `func:fan:caller${i}`;
      symbols.push({
        id,
        name: `caller${i}`,
        qualifiedName: `src.fan.caller${i}`,
        kind: "function",
        language: "typescript",
        filePath: "src/fan.ts",
        rangeStart: { line: 5 + i * 3, column: 1 },
        rangeEnd: { line: 7 + i * 3, column: 1 },
      });
      relations.push(
        { type: "defines", sourceSymbolId: "file:src/fan.ts", targetSymbolId: id, filePath: "src/fan.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: id, targetSymbolId: "func:fan:target", filePath: "src/fan.ts", confidence: 1 },
      );
    }

    store.upsertFileResult(makeFileResult({
      filePath: "src/fan.ts",
      symbols,
      relations,
    }));

    // Request only 3 results
    const result = store.getCallers({ functionName: "target", maxResults: 3 });
    expect(result.target).not.toBeNull();
    expect(result.callers).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("filters by filePath when provided", () => {
    // Two functions named "handler" in different files
    store.upsertFileResult(makeFileResult({
      filePath: "src/a.ts",
      symbols: [
        {
          id: "func:a:handler",
          name: "handler",
          qualifiedName: "src.a.handler",
          kind: "function",
          language: "typescript",
          filePath: "src/a.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/a.ts", targetSymbolId: "func:a:handler", filePath: "src/a.ts", confidence: 1 },
      ],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/b.ts",
      symbols: [
        {
          id: "func:b:handler",
          name: "handler",
          qualifiedName: "src.b.handler",
          kind: "function",
          language: "typescript",
          filePath: "src/b.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
        {
          id: "func:b:caller",
          name: "caller",
          qualifiedName: "src.b.caller",
          kind: "function",
          language: "typescript",
          filePath: "src/b.ts",
          rangeStart: { line: 5, column: 1 },
          rangeEnd: { line: 7, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/b.ts", targetSymbolId: "func:b:handler", filePath: "src/b.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/b.ts", targetSymbolId: "func:b:caller", filePath: "src/b.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: "func:b:caller", targetSymbolId: "func:b:handler", filePath: "src/b.ts", confidence: 1 },
      ],
    }));

    // Without filePath — picks first match (src/a.ts handler, which has no callers)
    const resultA = store.getCallers({ functionName: "handler", filePath: "src/a.ts" });
    expect(resultA.target).not.toBeNull();
    expect(resultA.target!.filePath).toBe("src/a.ts");
    expect(resultA.callers).toHaveLength(0);

    // With filePath for src/b.ts — should find the caller
    const resultB = store.getCallers({ functionName: "handler", filePath: "src/b.ts" });
    expect(resultB.target).not.toBeNull();
    expect(resultB.target!.filePath).toBe("src/b.ts");
    expect(resultB.callers).toHaveLength(1);
    expect(resultB.callers[0].node.label).toBe("caller");
  });

  it("respects AbortSignal for early termination", () => {
    // Build a chain: A -> B -> C -> D
    store.upsertFileResult(makeFileResult({
      filePath: "src/abort.ts",
      symbols: ["A", "B", "C", "D"].map((name, i) => ({
        id: `func:abort:${name}`,
        name,
        qualifiedName: `src.abort.${name}`,
        kind: "function" as const,
        language: "typescript" as const,
        filePath: "src/abort.ts",
        rangeStart: { line: 1 + i * 3, column: 1 },
        rangeEnd: { line: 3 + i * 3, column: 1 },
      })),
      relations: [
        ...["A", "B", "C", "D"].map((name) => ({
          type: "defines" as const,
          sourceSymbolId: "file:src/abort.ts",
          targetSymbolId: `func:abort:${name}`,
          filePath: "src/abort.ts",
          confidence: 1,
        })),
        { type: "calls" as const, sourceSymbolId: "func:abort:A", targetSymbolId: "func:abort:B", filePath: "src/abort.ts", confidence: 1 },
        { type: "calls" as const, sourceSymbolId: "func:abort:B", targetSymbolId: "func:abort:C", filePath: "src/abort.ts", confidence: 1 },
        { type: "calls" as const, sourceSymbolId: "func:abort:C", targetSymbolId: "func:abort:D", filePath: "src/abort.ts", confidence: 1 },
      ],
    }));

    // Abort immediately
    const controller = new AbortController();
    controller.abort();

    const result = store.getCallers({ functionName: "D", maxDepth: 10, signal: controller.signal });
    expect(result.target).not.toBeNull();
    // Should have 0 callers because signal was already aborted
    expect(result.callers).toHaveLength(0);
  });

  it("does not include non-function nodes as callers", () => {
    // A class node has an inbound calls edge to a function — should be excluded
    store.upsertFileResult(makeFileResult({
      filePath: "src/mixed.ts",
      symbols: [
        {
          id: "func:mixed:target",
          name: "target",
          qualifiedName: "src.mixed.target",
          kind: "function",
          language: "typescript",
          filePath: "src/mixed.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
        {
          id: "class:mixed:MyClass",
          name: "MyClass",
          qualifiedName: "src.mixed.MyClass",
          kind: "class",
          language: "typescript",
          filePath: "src/mixed.ts",
          rangeStart: { line: 5, column: 1 },
          rangeEnd: { line: 10, column: 1 },
        },
        {
          id: "func:mixed:realCaller",
          name: "realCaller",
          qualifiedName: "src.mixed.realCaller",
          kind: "function",
          language: "typescript",
          filePath: "src/mixed.ts",
          rangeStart: { line: 12, column: 1 },
          rangeEnd: { line: 15, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/mixed.ts", targetSymbolId: "func:mixed:target", filePath: "src/mixed.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/mixed.ts", targetSymbolId: "class:mixed:MyClass", filePath: "src/mixed.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/mixed.ts", targetSymbolId: "func:mixed:realCaller", filePath: "src/mixed.ts", confidence: 1 },
        // Class "calls" target (edge case — should be filtered out)
        { type: "calls", sourceSymbolId: "class:mixed:MyClass", targetSymbolId: "func:mixed:target", filePath: "src/mixed.ts", confidence: 1 },
        // Function calls target (should be included)
        { type: "calls", sourceSymbolId: "func:mixed:realCaller", targetSymbolId: "func:mixed:target", filePath: "src/mixed.ts", confidence: 1 },
      ],
    }));

    const result = store.getCallers({ functionName: "target" });
    expect(result.callers).toHaveLength(1);
    expect(result.callers[0].node.label).toBe("realCaller");
  });
});
