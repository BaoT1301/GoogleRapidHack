import { describe, it, expect, beforeEach } from "vitest";
import { GraphStore } from "../graph/graph-store.js";
import type { FileParseResult } from "../types/schema.js";

/**
 * Integration test for the `getCallChain()` query tool (Track 4).
 *
 * Builds a chain A→B→C→D and verifies that `getCallChain()` returns
 * the correct directed subgraph for upstream, downstream, and both directions.
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

describe("GraphStore.getCallChain() — Track 4", () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();
  });

  it("returns null root when function is not found", () => {
    const result = store.getCallChain({ functionName: "nonexistent", direction: "both" });
    expect(result.root).toBeNull();
    expect(result.chain.nodes).toEqual([]);
    expect(result.chain.edges).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("returns only the root node when function has no call edges", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/isolated.ts",
      symbols: [
        {
          id: "func:isolated:lonely",
          name: "lonely",
          qualifiedName: "src.isolated.lonely",
          kind: "function",
          language: "typescript",
          filePath: "src/isolated.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/isolated.ts", targetSymbolId: "func:isolated:lonely", filePath: "src/isolated.ts", confidence: 1 },
      ],
    }));

    const result = store.getCallChain({ functionName: "lonely", direction: "both" });
    expect(result.root).not.toBeNull();
    expect(result.root!.label).toBe("lonely");
    expect(result.chain.nodes).toHaveLength(1);
    expect(result.chain.edges).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it("returns A←B→C→D for getCallChain('B', 'both') on chain A→B→C→D", () => {
    // Build chain: A calls B, B calls C, C calls D
    store.upsertFileResult(makeFileResult({
      filePath: "src/chain.ts",
      symbols: ["A", "B", "C", "D"].map((name, i) => ({
        id: `func:chain:${name}`,
        name,
        qualifiedName: `src.chain.${name}`,
        kind: "function" as const,
        language: "typescript" as const,
        filePath: "src/chain.ts",
        rangeStart: { line: 1 + i * 4, column: 1 },
        rangeEnd: { line: 3 + i * 4, column: 1 },
      })),
      relations: [
        // File defines all four functions
        ...["A", "B", "C", "D"].map((name) => ({
          type: "defines" as const,
          sourceSymbolId: "file:src/chain.ts",
          targetSymbolId: `func:chain:${name}`,
          filePath: "src/chain.ts",
          confidence: 1,
        })),
        // A → B → C → D
        { type: "calls" as const, sourceSymbolId: "func:chain:A", targetSymbolId: "func:chain:B", filePath: "src/chain.ts", confidence: 1 },
        { type: "calls" as const, sourceSymbolId: "func:chain:B", targetSymbolId: "func:chain:C", filePath: "src/chain.ts", confidence: 1 },
        { type: "calls" as const, sourceSymbolId: "func:chain:C", targetSymbolId: "func:chain:D", filePath: "src/chain.ts", confidence: 1 },
      ],
    }));

    // getCallChain("B", "both") should return all 4 nodes: A←B→C→D
    const result = store.getCallChain({ functionName: "B", direction: "both" });
    expect(result.root).not.toBeNull();
    expect(result.root!.label).toBe("B");

    const nodeLabels = result.chain.nodes.map((n) => n.label).sort();
    expect(nodeLabels).toEqual(["A", "B", "C", "D"]);

    // Should have 3 call edges: A→B, B→C, C→D
    expect(result.chain.edges).toHaveLength(3);
    const edgePairs = result.chain.edges.map((e) => {
      const srcLabel = result.chain.nodes.find((n) => n.id === e.source)?.label;
      const tgtLabel = result.chain.nodes.find((n) => n.id === e.target)?.label;
      return `${srcLabel}->${tgtLabel}`;
    }).sort();
    expect(edgePairs).toEqual(["A->B", "B->C", "C->D"]);

    expect(result.truncated).toBe(false);
  });

  it("returns only upstream nodes for direction='upstream'", () => {
    // Build chain: A → B → C → D
    store.upsertFileResult(makeFileResult({
      filePath: "src/up.ts",
      symbols: ["A", "B", "C", "D"].map((name, i) => ({
        id: `func:up:${name}`,
        name,
        qualifiedName: `src.up.${name}`,
        kind: "function" as const,
        language: "typescript" as const,
        filePath: "src/up.ts",
        rangeStart: { line: 1 + i * 4, column: 1 },
        rangeEnd: { line: 3 + i * 4, column: 1 },
      })),
      relations: [
        ...["A", "B", "C", "D"].map((name) => ({
          type: "defines" as const,
          sourceSymbolId: "file:src/up.ts",
          targetSymbolId: `func:up:${name}`,
          filePath: "src/up.ts",
          confidence: 1,
        })),
        { type: "calls" as const, sourceSymbolId: "func:up:A", targetSymbolId: "func:up:B", filePath: "src/up.ts", confidence: 1 },
        { type: "calls" as const, sourceSymbolId: "func:up:B", targetSymbolId: "func:up:C", filePath: "src/up.ts", confidence: 1 },
        { type: "calls" as const, sourceSymbolId: "func:up:C", targetSymbolId: "func:up:D", filePath: "src/up.ts", confidence: 1 },
      ],
    }));

    // Upstream from C: should return A, B, C (who calls C? B. Who calls B? A.)
    const result = store.getCallChain({ functionName: "C", direction: "upstream" });
    expect(result.root).not.toBeNull();
    expect(result.root!.label).toBe("C");

    const nodeLabels = result.chain.nodes.map((n) => n.label).sort();
    expect(nodeLabels).toEqual(["A", "B", "C"]);

    // Should have 2 edges: A→B, B→C
    expect(result.chain.edges).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it("returns only downstream nodes for direction='downstream'", () => {
    // Build chain: A → B → C → D
    store.upsertFileResult(makeFileResult({
      filePath: "src/down.ts",
      symbols: ["A", "B", "C", "D"].map((name, i) => ({
        id: `func:down:${name}`,
        name,
        qualifiedName: `src.down.${name}`,
        kind: "function" as const,
        language: "typescript" as const,
        filePath: "src/down.ts",
        rangeStart: { line: 1 + i * 4, column: 1 },
        rangeEnd: { line: 3 + i * 4, column: 1 },
      })),
      relations: [
        ...["A", "B", "C", "D"].map((name) => ({
          type: "defines" as const,
          sourceSymbolId: "file:src/down.ts",
          targetSymbolId: `func:down:${name}`,
          filePath: "src/down.ts",
          confidence: 1,
        })),
        { type: "calls" as const, sourceSymbolId: "func:down:A", targetSymbolId: "func:down:B", filePath: "src/down.ts", confidence: 1 },
        { type: "calls" as const, sourceSymbolId: "func:down:B", targetSymbolId: "func:down:C", filePath: "src/down.ts", confidence: 1 },
        { type: "calls" as const, sourceSymbolId: "func:down:C", targetSymbolId: "func:down:D", filePath: "src/down.ts", confidence: 1 },
      ],
    }));

    // Downstream from B: should return B, C, D (B calls C, C calls D)
    const result = store.getCallChain({ functionName: "B", direction: "downstream" });
    expect(result.root).not.toBeNull();
    expect(result.root!.label).toBe("B");

    const nodeLabels = result.chain.nodes.map((n) => n.label).sort();
    expect(nodeLabels).toEqual(["B", "C", "D"]);

    // Should have 2 edges: B→C, C→D
    expect(result.chain.edges).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it("respects maxDepth limit", () => {
    // Build chain: A → B → C → D → E
    store.upsertFileResult(makeFileResult({
      filePath: "src/depth.ts",
      symbols: ["A", "B", "C", "D", "E"].map((name, i) => ({
        id: `func:depth:${name}`,
        name,
        qualifiedName: `src.depth.${name}`,
        kind: "function" as const,
        language: "typescript" as const,
        filePath: "src/depth.ts",
        rangeStart: { line: 1 + i * 4, column: 1 },
        rangeEnd: { line: 3 + i * 4, column: 1 },
      })),
      relations: [
        ...["A", "B", "C", "D", "E"].map((name) => ({
          type: "defines" as const,
          sourceSymbolId: "file:src/depth.ts",
          targetSymbolId: `func:depth:${name}`,
          filePath: "src/depth.ts",
          confidence: 1,
        })),
        { type: "calls" as const, sourceSymbolId: "func:depth:A", targetSymbolId: "func:depth:B", filePath: "src/depth.ts", confidence: 1 },
        { type: "calls" as const, sourceSymbolId: "func:depth:B", targetSymbolId: "func:depth:C", filePath: "src/depth.ts", confidence: 1 },
        { type: "calls" as const, sourceSymbolId: "func:depth:C", targetSymbolId: "func:depth:D", filePath: "src/depth.ts", confidence: 1 },
        { type: "calls" as const, sourceSymbolId: "func:depth:D", targetSymbolId: "func:depth:E", filePath: "src/depth.ts", confidence: 1 },
      ],
    }));

    // Downstream from A with maxDepth=2: should only reach A, B, C (not D, E)
    const result = store.getCallChain({ functionName: "A", direction: "downstream", maxDepth: 2 });
    expect(result.root).not.toBeNull();

    const nodeLabels = result.chain.nodes.map((n) => n.label).sort();
    expect(nodeLabels).toEqual(["A", "B", "C"]);
    expect(result.truncated).toBe(false);
  });

  it("respects maxNodes limit and sets truncated flag", () => {
    // Build a fan-out: root calls 10 functions
    const symbols = [
      {
        id: "func:fan:root",
        name: "root",
        qualifiedName: "src.fan.root",
        kind: "function" as const,
        language: "typescript" as const,
        filePath: "src/fan.ts",
        rangeStart: { line: 1, column: 1 },
        rangeEnd: { line: 3, column: 1 },
      },
    ];
    const relations: FileParseResult["relations"] = [
      { type: "defines", sourceSymbolId: "file:src/fan.ts", targetSymbolId: "func:fan:root", filePath: "src/fan.ts", confidence: 1 },
    ];

    for (let i = 0; i < 10; i++) {
      const id = `func:fan:leaf${i}`;
      symbols.push({
        id,
        name: `leaf${i}`,
        qualifiedName: `src.fan.leaf${i}`,
        kind: "function",
        language: "typescript",
        filePath: "src/fan.ts",
        rangeStart: { line: 5 + i * 3, column: 1 },
        rangeEnd: { line: 7 + i * 3, column: 1 },
      });
      relations.push(
        { type: "defines", sourceSymbolId: "file:src/fan.ts", targetSymbolId: id, filePath: "src/fan.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: "func:fan:root", targetSymbolId: id, filePath: "src/fan.ts", confidence: 1 },
      );
    }

    store.upsertFileResult(makeFileResult({ filePath: "src/fan.ts", symbols, relations }));

    // maxNodes=4 means root + 3 leaves max
    const result = store.getCallChain({ functionName: "root", direction: "downstream", maxNodes: 4 });
    expect(result.root).not.toBeNull();
    expect(result.chain.nodes.length).toBeLessThanOrEqual(4);
    expect(result.truncated).toBe(true);
  });

  it("respects AbortSignal for early termination", () => {
    // Build chain: A → B → C → D
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

    // Abort immediately — should return only the root node
    const controller = new AbortController();
    controller.abort();

    const result = store.getCallChain({ functionName: "B", direction: "both", signal: controller.signal });
    expect(result.root).not.toBeNull();
    // Only the root node should be present since signal was already aborted
    expect(result.chain.nodes).toHaveLength(1);
    expect(result.chain.nodes[0].label).toBe("B");
    expect(result.chain.edges).toHaveLength(0);
  });

  it("filters by filePath when provided", () => {
    // Two functions named "process" in different files
    store.upsertFileResult(makeFileResult({
      filePath: "src/a.ts",
      symbols: [
        {
          id: "func:a:process",
          name: "process",
          qualifiedName: "src.a.process",
          kind: "function",
          language: "typescript",
          filePath: "src/a.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/a.ts", targetSymbolId: "func:a:process", filePath: "src/a.ts", confidence: 1 },
      ],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/b.ts",
      symbols: [
        {
          id: "func:b:process",
          name: "process",
          qualifiedName: "src.b.process",
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
        { type: "defines", sourceSymbolId: "file:src/b.ts", targetSymbolId: "func:b:process", filePath: "src/b.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/b.ts", targetSymbolId: "func:b:caller", filePath: "src/b.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: "func:b:caller", targetSymbolId: "func:b:process", filePath: "src/b.ts", confidence: 1 },
      ],
    }));

    // With filePath for src/b.ts — should find the caller upstream
    const result = store.getCallChain({ functionName: "process", filePath: "src/b.ts", direction: "upstream" });
    expect(result.root).not.toBeNull();
    expect(result.root!.filePath).toBe("src/b.ts");
    expect(result.chain.nodes).toHaveLength(2);

    const labels = result.chain.nodes.map((n) => n.label).sort();
    expect(labels).toEqual(["caller", "process"]);
  });

  it("handles diamond-shaped call graphs without duplicates", () => {
    // Diamond: A → B, A → C, B → D, C → D
    store.upsertFileResult(makeFileResult({
      filePath: "src/diamond.ts",
      symbols: ["A", "B", "C", "D"].map((name, i) => ({
        id: `func:diamond:${name}`,
        name,
        qualifiedName: `src.diamond.${name}`,
        kind: "function" as const,
        language: "typescript" as const,
        filePath: "src/diamond.ts",
        rangeStart: { line: 1 + i * 4, column: 1 },
        rangeEnd: { line: 3 + i * 4, column: 1 },
      })),
      relations: [
        ...["A", "B", "C", "D"].map((name) => ({
          type: "defines" as const,
          sourceSymbolId: "file:src/diamond.ts",
          targetSymbolId: `func:diamond:${name}`,
          filePath: "src/diamond.ts",
          confidence: 1,
        })),
        { type: "calls" as const, sourceSymbolId: "func:diamond:A", targetSymbolId: "func:diamond:B", filePath: "src/diamond.ts", confidence: 1 },
        { type: "calls" as const, sourceSymbolId: "func:diamond:A", targetSymbolId: "func:diamond:C", filePath: "src/diamond.ts", confidence: 1 },
        { type: "calls" as const, sourceSymbolId: "func:diamond:B", targetSymbolId: "func:diamond:D", filePath: "src/diamond.ts", confidence: 1 },
        { type: "calls" as const, sourceSymbolId: "func:diamond:C", targetSymbolId: "func:diamond:D", filePath: "src/diamond.ts", confidence: 1 },
      ],
    }));

    // Both directions from A: should get all 4 nodes, 4 edges, no duplicates
    const result = store.getCallChain({ functionName: "A", direction: "both" });
    expect(result.root).not.toBeNull();

    const nodeLabels = result.chain.nodes.map((n) => n.label).sort();
    expect(nodeLabels).toEqual(["A", "B", "C", "D"]);

    // 4 call edges: A→B, A→C, B→D, C→D
    expect(result.chain.edges).toHaveLength(4);
    expect(result.truncated).toBe(false);
  });
});
