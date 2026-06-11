import { describe, it, expect, beforeEach } from "vitest";
import { GraphStore } from "../graph/graph-store.js";
import type { FileParseResult } from "../types/schema.js";

/**
 * Integration test for the `getModuleCoupling()` query tool (Sprint 2 — Track 1).
 *
 * Builds small graphs with various relationship patterns and verifies that
 * `getModuleCoupling()` returns correct coupling metrics.
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

describe("GraphStore.getModuleCoupling() — Sprint 2 Track 1", () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();
  });

  it("returns correct sharedImports count for two files with shared imports", () => {
    // File A imports shared.ts and utilA.ts
    // File B imports shared.ts and utilB.ts
    // Shared import: shared.ts
    store.upsertFileResult(makeFileResult({
      filePath: "src/shared.ts",
      symbols: [],
    }));
    store.upsertFileResult(makeFileResult({
      filePath: "src/utilA.ts",
      symbols: [],
    }));
    store.upsertFileResult(makeFileResult({
      filePath: "src/utilB.ts",
      symbols: [],
    }));
    store.upsertFileResult(makeFileResult({
      filePath: "src/fileA.ts",
      resolvedImports: ["src/shared.ts", "src/utilA.ts"],
    }));
    store.upsertFileResult(makeFileResult({
      filePath: "src/fileB.ts",
      resolvedImports: ["src/shared.ts", "src/utilB.ts"],
    }));

    const result = store.getModuleCoupling({
      filePathA: "src/fileA.ts",
      filePathB: "src/fileB.ts",
    });

    expect(result.sharedImports).toBe(1);
    expect(result.filePathA).toBe("src/fileA.ts");
    expect(result.filePathB).toBe("src/fileB.ts");
  });

  it("returns correct sharedSymbols count for cross-references", () => {
    // Both files define functions that reference each other
    // Use targetSymbolId for within-file references to ensure edges are created correctly
    // File A: funcA, varA. File B: funcB, varB.
    // funcA calls funcB (within same upsert using targetSymbolId)
    // funcB reads varA (within same upsert using targetSymbolId)
    store.upsertFileResult(makeFileResult({
      filePath: "src/moduleA.ts",
      symbols: [
        {
          id: "func:moduleA:funcA",
          name: "funcA",
          qualifiedName: "src.moduleA.funcA",
          kind: "function",
          language: "typescript",
          filePath: "src/moduleA.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 5, column: 1 },
        },
        {
          id: "var:moduleA:configA",
          name: "configA",
          qualifiedName: "src.moduleA.configA",
          kind: "variable",
          language: "typescript",
          filePath: "src/moduleA.ts",
          rangeStart: { line: 7, column: 1 },
          rangeEnd: { line: 7, column: 30 },
        },
        // Include B's symbols in A's file result so cross-file edges can be created
        {
          id: "func:moduleB:funcB",
          name: "funcB",
          qualifiedName: "src.moduleB.funcB",
          kind: "function",
          language: "typescript",
          filePath: "src/moduleB.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 5, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/moduleA.ts", targetSymbolId: "func:moduleA:funcA", filePath: "src/moduleA.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/moduleA.ts", targetSymbolId: "var:moduleA:configA", filePath: "src/moduleA.ts", confidence: 1 },
        // funcA calls funcB (A references B's symbol)
        { type: "calls", sourceSymbolId: "func:moduleA:funcA", targetSymbolId: "func:moduleB:funcB", filePath: "src/moduleA.ts", confidence: 0.9 },
      ],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/moduleB.ts",
      symbols: [
        {
          id: "func:moduleB:funcB",
          name: "funcB",
          qualifiedName: "src.moduleB.funcB",
          kind: "function",
          language: "typescript",
          filePath: "src/moduleB.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 5, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/moduleB.ts", targetSymbolId: "func:moduleB:funcB", filePath: "src/moduleB.ts", confidence: 1 },
        // funcB reads configA (B references A's symbol)
        { type: "reads", sourceSymbolId: "func:moduleB:funcB", targetQualifiedName: "src.moduleA.configA", filePath: "src/moduleB.ts", confidence: 0.9 },
      ],
    }));

    const result = store.getModuleCoupling({
      filePathA: "src/moduleA.ts",
      filePathB: "src/moduleB.ts",
    });

    // configA (in A) is referenced by funcB (in B) via reads → 1
    // funcB (in B) is referenced by funcA (in A) via calls → 1
    expect(result.sharedSymbols).toBe(2);
  });

  it("returns correct directEdges count for files with direct edges", () => {
    // File A defines doWork which calls helper in File B
    // Upsert callee first so its symbol exists when caller's relations are resolved
    store.upsertFileResult(makeFileResult({
      filePath: "src/callee.ts",
      symbols: [
        {
          id: "func:callee:helper",
          name: "helper",
          qualifiedName: "src.callee.helper",
          kind: "function",
          language: "typescript",
          filePath: "src/callee.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 5, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/callee.ts", targetSymbolId: "func:callee:helper", filePath: "src/callee.ts", confidence: 1 },
      ],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/caller.ts",
      symbols: [
        {
          id: "func:caller:doWork",
          name: "doWork",
          qualifiedName: "src.caller.doWork",
          kind: "function",
          language: "typescript",
          filePath: "src/caller.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 5, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/caller.ts", targetSymbolId: "func:caller:doWork", filePath: "src/caller.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: "func:caller:doWork", targetQualifiedName: "src.callee.helper", filePath: "src/caller.ts", confidence: 0.9 },
      ],
    }));

    const result = store.getModuleCoupling({
      filePathA: "src/caller.ts",
      filePathB: "src/callee.ts",
    });

    // doWork (A) -> helper (B) = direct edge
    expect(result.directEdges).toBeGreaterThanOrEqual(1);
  });

  it("returns coupling score 0.0 for completely unrelated files", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/isolated1.ts",
      symbols: [
        {
          id: "func:isolated1:foo",
          name: "foo",
          qualifiedName: "src.isolated1.foo",
          kind: "function",
          language: "typescript",
          filePath: "src/isolated1.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/isolated1.ts", targetSymbolId: "func:isolated1:foo", filePath: "src/isolated1.ts", confidence: 1 },
      ],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/isolated2.ts",
      symbols: [
        {
          id: "func:isolated2:bar",
          name: "bar",
          qualifiedName: "src.isolated2.bar",
          kind: "function",
          language: "typescript",
          filePath: "src/isolated2.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/isolated2.ts", targetSymbolId: "func:isolated2:bar", filePath: "src/isolated2.ts", confidence: 1 },
      ],
    }));

    const result = store.getModuleCoupling({
      filePathA: "src/isolated1.ts",
      filePathB: "src/isolated2.ts",
    });

    expect(result.sharedImports).toBe(0);
    expect(result.sharedSymbols).toBe(0);
    expect(result.directEdges).toBe(0);
    expect(result.transitiveEdges).toBe(0);
    expect(result.couplingScore).toBe(0.0);
  });

  it("clamps coupling score to 1.0 for heavily coupled files", () => {
    // Create two files with many cross-references to produce a high raw score
    const symbolsA: FileParseResult["symbols"] = [];
    const symbolsB: FileParseResult["symbols"] = [];
    const relationsA: FileParseResult["relations"] = [];
    const relationsB: FileParseResult["relations"] = [];

    // Create 20 functions in each file, all calling each other
    for (let i = 0; i < 20; i++) {
      symbolsA.push({
        id: `func:heavy_a:fn${i}`,
        name: `fn${i}`,
        qualifiedName: `src.heavy_a.fn${i}`,
        kind: "function",
        language: "typescript",
        filePath: "src/heavy_a.ts",
        rangeStart: { line: 1 + i * 3, column: 1 },
        rangeEnd: { line: 3 + i * 3, column: 1 },
      });
      symbolsB.push({
        id: `func:heavy_b:fn${i}`,
        name: `fn${i}`,
        qualifiedName: `src.heavy_b.fn${i}`,
        kind: "function",
        language: "typescript",
        filePath: "src/heavy_b.ts",
        rangeStart: { line: 1 + i * 3, column: 1 },
        rangeEnd: { line: 3 + i * 3, column: 1 },
      });
      relationsA.push(
        { type: "defines", sourceSymbolId: "file:src/heavy_a.ts", targetSymbolId: `func:heavy_a:fn${i}`, filePath: "src/heavy_a.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: `func:heavy_a:fn${i}`, targetSymbolId: `func:heavy_b:fn${i}`, filePath: "src/heavy_a.ts", confidence: 0.9 },
      );
      relationsB.push(
        { type: "defines", sourceSymbolId: "file:src/heavy_b.ts", targetSymbolId: `func:heavy_b:fn${i}`, filePath: "src/heavy_b.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: `func:heavy_b:fn${i}`, targetSymbolId: `func:heavy_a:fn${i}`, filePath: "src/heavy_b.ts", confidence: 0.9 },
      );
    }

    store.upsertFileResult(makeFileResult({
      filePath: "src/heavy_a.ts",
      symbols: symbolsA,
      relations: relationsA,
    }));
    store.upsertFileResult(makeFileResult({
      filePath: "src/heavy_b.ts",
      symbols: symbolsB,
      relations: relationsB,
    }));

    const result = store.getModuleCoupling({
      filePathA: "src/heavy_a.ts",
      filePathB: "src/heavy_b.ts",
    });

    expect(result.couplingScore).toBeLessThanOrEqual(1.0);
    expect(result.couplingScore).toBeGreaterThan(0);
  });

  it("throws NotFoundError when file path does not exist in graph", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/exists.ts",
      symbols: [],
    }));

    expect(() => {
      store.getModuleCoupling({
        filePathA: "src/exists.ts",
        filePathB: "src/nonexistent.ts",
      });
    }).toThrow("File not found in graph: src/nonexistent.ts");

    expect(() => {
      store.getModuleCoupling({
        filePathA: "src/nonexistent.ts",
        filePathB: "src/exists.ts",
      });
    }).toThrow("File not found in graph: src/nonexistent.ts");
  });

  it("respects max_depth parameter for transitive edge traversal", () => {
    // Build a chain: start -> mid1 -> mid2 -> end
    // With maxDepth=1, transitive edges from start should not reach end
    // With maxDepth=3, transitive edges from start should reach end

    // Upsert in reverse order so target symbols exist when relations are resolved
    store.upsertFileResult(makeFileResult({
      filePath: "src/end.ts",
      symbols: [
        {
          id: "func:end:finish",
          name: "finish",
          qualifiedName: "src.end.finish",
          kind: "function",
          language: "typescript",
          filePath: "src/end.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/end.ts", targetSymbolId: "func:end:finish", filePath: "src/end.ts", confidence: 1 },
      ],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/mid2.ts",
      symbols: [
        {
          id: "func:mid2:step2",
          name: "step2",
          qualifiedName: "src.mid2.step2",
          kind: "function",
          language: "typescript",
          filePath: "src/mid2.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/mid2.ts", targetSymbolId: "func:mid2:step2", filePath: "src/mid2.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: "func:mid2:step2", targetQualifiedName: "src.end.finish", filePath: "src/mid2.ts", confidence: 0.9 },
      ],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/mid1.ts",
      symbols: [
        {
          id: "func:mid1:step1",
          name: "step1",
          qualifiedName: "src.mid1.step1",
          kind: "function",
          language: "typescript",
          filePath: "src/mid1.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/mid1.ts", targetSymbolId: "func:mid1:step1", filePath: "src/mid1.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: "func:mid1:step1", targetQualifiedName: "src.mid2.step2", filePath: "src/mid1.ts", confidence: 0.9 },
      ],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/start.ts",
      symbols: [
        {
          id: "func:start:entry",
          name: "entry",
          qualifiedName: "src.start.entry",
          kind: "function",
          language: "typescript",
          filePath: "src/start.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/start.ts", targetSymbolId: "func:start:entry", filePath: "src/start.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: "func:start:entry", targetQualifiedName: "src.mid1.step1", filePath: "src/start.ts", confidence: 0.9 },
      ],
    }));

    // With maxDepth=1: start's nodes can only reach mid1 (1 hop), not end.ts
    const resultShallow = store.getModuleCoupling({
      filePathA: "src/start.ts",
      filePathB: "src/end.ts",
      maxDepth: 1,
    });

    // With maxDepth=3: start's nodes can reach through mid1 -> mid2 -> end
    const resultDeep = store.getModuleCoupling({
      filePathA: "src/start.ts",
      filePathB: "src/end.ts",
      maxDepth: 3,
    });

    expect(resultDeep.transitiveEdges).toBeGreaterThan(resultShallow.transitiveEdges);
  });
});
