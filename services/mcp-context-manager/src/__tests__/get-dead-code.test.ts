import { describe, it, expect, beforeEach } from "vitest";
import { GraphStore } from "../graph/graph-store.js";
import type { FileParseResult } from "../types/schema.js";

/**
 * Integration test for the `getDeadCode()` query tool (Track 5).
 *
 * Builds a small graph with functions and classes, some called and some orphaned,
 * and verifies that `getDeadCode()` correctly identifies dead code.
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

describe("GraphStore.getDeadCode() — Track 5", () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();
  });

  it("returns empty when no symbols exist in the graph", () => {
    const result = store.getDeadCode({});
    expect(result.deadSymbols).toEqual([]);
    expect(result.totalScanned).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("identifies orphan function C as dead code when A calls B but nobody calls C", () => {
    // Build graph: A calls B, C is orphan (dead code)
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
        { type: "defines", sourceSymbolId: "file:src/app.ts", targetSymbolId: "func:app:funcA", filePath: "src/app.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/app.ts", targetSymbolId: "func:app:funcB", filePath: "src/app.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/app.ts", targetSymbolId: "func:app:funcC", filePath: "src/app.ts", confidence: 1 },
        // funcA calls funcB — so funcB is NOT dead code
        { type: "calls", sourceSymbolId: "func:app:funcA", targetSymbolId: "func:app:funcB", filePath: "src/app.ts", confidence: 1 },
      ],
    }));

    const result = store.getDeadCode({});

    // funcA has no callers but is not excluded (it's not an entry point name)
    // funcC has no callers — dead code
    // funcB has a caller (funcA) — NOT dead code
    const deadLabels = result.deadSymbols.map((d) => d.node.label);
    expect(deadLabels).toContain("funcC");
    expect(deadLabels).toContain("funcA"); // funcA also has no inbound calls
    expect(deadLabels).not.toContain("funcB");
    expect(result.truncated).toBe(false);
  });

  it("excludes entry point functions (main, bootstrap, __init__)", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/server.ts",
      symbols: [
        {
          id: "func:server:main",
          name: "main",
          qualifiedName: "src.server.main",
          kind: "function",
          language: "typescript",
          filePath: "src/server.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 5, column: 1 },
        },
        {
          id: "func:server:bootstrap",
          name: "bootstrap",
          qualifiedName: "src.server.bootstrap",
          kind: "function",
          language: "typescript",
          filePath: "src/server.ts",
          rangeStart: { line: 7, column: 1 },
          rangeEnd: { line: 11, column: 1 },
        },
        {
          id: "func:server:orphan",
          name: "orphan",
          qualifiedName: "src.server.orphan",
          kind: "function",
          language: "typescript",
          filePath: "src/server.ts",
          rangeStart: { line: 13, column: 1 },
          rangeEnd: { line: 17, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/server.ts", targetSymbolId: "func:server:main", filePath: "src/server.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/server.ts", targetSymbolId: "func:server:bootstrap", filePath: "src/server.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/server.ts", targetSymbolId: "func:server:orphan", filePath: "src/server.ts", confidence: 1 },
      ],
    }));

    const result = store.getDeadCode({});
    const deadLabels = result.deadSymbols.map((d) => d.node.label);

    // main and bootstrap are entry points — excluded
    expect(deadLabels).not.toContain("main");
    expect(deadLabels).not.toContain("bootstrap");
    // orphan is dead code
    expect(deadLabels).toContain("orphan");
  });

  it("excludes functions in test files", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/tests/helper.ts",
      symbols: [
        {
          id: "func:tests:testHelper",
          name: "testHelper",
          qualifiedName: "src.tests.testHelper",
          kind: "function",
          language: "typescript",
          filePath: "src/tests/helper.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/tests/helper.ts", targetSymbolId: "func:tests:testHelper", filePath: "src/tests/helper.ts", confidence: 1 },
      ],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/utils.ts",
      symbols: [
        {
          id: "func:utils:realOrphan",
          name: "realOrphan",
          qualifiedName: "src.utils.realOrphan",
          kind: "function",
          language: "typescript",
          filePath: "src/utils.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/utils.ts", targetSymbolId: "func:utils:realOrphan", filePath: "src/utils.ts", confidence: 1 },
      ],
    }));

    const result = store.getDeadCode({});
    const deadLabels = result.deadSymbols.map((d) => d.node.label);

    // testHelper is in a test file — excluded
    expect(deadLabels).not.toContain("testHelper");
    // realOrphan is dead code
    expect(deadLabels).toContain("realOrphan");
  });

  it("filters by language", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "backend/app/utils.py",
      language: "python",
      symbols: [
        {
          id: "func:py:orphanPy",
          name: "orphanPy",
          qualifiedName: "app.utils.orphanPy",
          kind: "function",
          language: "python",
          filePath: "backend/app/utils.py",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:backend/app/utils.py", targetSymbolId: "func:py:orphanPy", filePath: "backend/app/utils.py", confidence: 1 },
      ],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/utils.ts",
      symbols: [
        {
          id: "func:ts:orphanTs",
          name: "orphanTs",
          qualifiedName: "src.utils.orphanTs",
          kind: "function",
          language: "typescript",
          filePath: "src/utils.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/utils.ts", targetSymbolId: "func:ts:orphanTs", filePath: "src/utils.ts", confidence: 1 },
      ],
    }));

    // Filter by python only
    const pyResult = store.getDeadCode({ language: "python" });
    const pyLabels = pyResult.deadSymbols.map((d) => d.node.label);
    expect(pyLabels).toContain("orphanPy");
    expect(pyLabels).not.toContain("orphanTs");

    // Filter by typescript only
    const tsResult = store.getDeadCode({ language: "typescript" });
    const tsLabels = tsResult.deadSymbols.map((d) => d.node.label);
    expect(tsLabels).toContain("orphanTs");
    expect(tsLabels).not.toContain("orphanPy");
  });

  it("filters by kind (function vs class)", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/models.ts",
      symbols: [
        {
          id: "func:models:helperFn",
          name: "helperFn",
          qualifiedName: "src.models.helperFn",
          kind: "function",
          language: "typescript",
          filePath: "src/models.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
        {
          id: "class:models:OrphanClass",
          name: "OrphanClass",
          qualifiedName: "src.models.OrphanClass",
          kind: "class",
          language: "typescript",
          filePath: "src/models.ts",
          rangeStart: { line: 5, column: 1 },
          rangeEnd: { line: 10, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/models.ts", targetSymbolId: "func:models:helperFn", filePath: "src/models.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/models.ts", targetSymbolId: "class:models:OrphanClass", filePath: "src/models.ts", confidence: 1 },
      ],
    }));

    // Filter by function only
    const fnResult = store.getDeadCode({ kind: "function" });
    const fnLabels = fnResult.deadSymbols.map((d) => d.node.label);
    expect(fnLabels).toContain("helperFn");
    expect(fnLabels).not.toContain("OrphanClass");

    // Filter by class only
    const classResult = store.getDeadCode({ kind: "class" });
    const classLabels = classResult.deadSymbols.map((d) => d.node.label);
    expect(classLabels).toContain("OrphanClass");
    expect(classLabels).not.toContain("helperFn");
  });

  it("filters by filePattern glob", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "backend/app/utils.py",
      language: "python",
      symbols: [
        {
          id: "func:backend:backendFn",
          name: "backendFn",
          qualifiedName: "app.utils.backendFn",
          kind: "function",
          language: "python",
          filePath: "backend/app/utils.py",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:backend/app/utils.py", targetSymbolId: "func:backend:backendFn", filePath: "backend/app/utils.py", confidence: 1 },
      ],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "frontend/src/utils.ts",
      symbols: [
        {
          id: "func:frontend:frontendFn",
          name: "frontendFn",
          qualifiedName: "frontend.src.utils.frontendFn",
          kind: "function",
          language: "typescript",
          filePath: "frontend/src/utils.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:frontend/src/utils.ts", targetSymbolId: "func:frontend:frontendFn", filePath: "frontend/src/utils.ts", confidence: 1 },
      ],
    }));

    // Filter by backend/**
    const result = store.getDeadCode({ filePattern: "backend/**" });
    const labels = result.deadSymbols.map((d) => d.node.label);
    expect(labels).toContain("backendFn");
    expect(labels).not.toContain("frontendFn");
  });

  it("does not flag classes with inbound instantiates edges", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/services.ts",
      symbols: [
        {
          id: "class:services:UsedClass",
          name: "UsedClass",
          qualifiedName: "src.services.UsedClass",
          kind: "class",
          language: "typescript",
          filePath: "src/services.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 10, column: 1 },
        },
        {
          id: "func:services:factory",
          name: "factory",
          qualifiedName: "src.services.factory",
          kind: "function",
          language: "typescript",
          filePath: "src/services.ts",
          rangeStart: { line: 12, column: 1 },
          rangeEnd: { line: 15, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/services.ts", targetSymbolId: "class:services:UsedClass", filePath: "src/services.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/services.ts", targetSymbolId: "func:services:factory", filePath: "src/services.ts", confidence: 1 },
        // factory instantiates UsedClass
        { type: "instantiates", sourceSymbolId: "func:services:factory", targetSymbolId: "class:services:UsedClass", filePath: "src/services.ts", confidence: 1 },
      ],
    }));

    const result = store.getDeadCode({});
    const deadLabels = result.deadSymbols.map((d) => d.node.label);

    // UsedClass has an inbound instantiates edge — NOT dead code
    expect(deadLabels).not.toContain("UsedClass");
    // factory has no callers — dead code
    expect(deadLabels).toContain("factory");
  });

  it("respects maxResults limit and sets truncated flag", () => {
    const symbols: FileParseResult["symbols"] = [];
    const relations: FileParseResult["relations"] = [];

    for (let i = 0; i < 10; i++) {
      const id = `func:many:fn${i}`;
      symbols.push({
        id,
        name: `fn${i}`,
        qualifiedName: `src.many.fn${i}`,
        kind: "function",
        language: "typescript",
        filePath: "src/many.ts",
        rangeStart: { line: 1 + i * 3, column: 1 },
        rangeEnd: { line: 3 + i * 3, column: 1 },
      });
      relations.push({
        type: "defines",
        sourceSymbolId: "file:src/many.ts",
        targetSymbolId: id,
        filePath: "src/many.ts",
        confidence: 1,
      });
    }

    store.upsertFileResult(makeFileResult({
      filePath: "src/many.ts",
      symbols,
      relations,
    }));

    const result = store.getDeadCode({ maxResults: 3 });
    expect(result.deadSymbols).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("respects AbortSignal for early termination", () => {
    const symbols: FileParseResult["symbols"] = [];
    const relations: FileParseResult["relations"] = [];

    for (let i = 0; i < 5; i++) {
      const id = `func:abort:fn${i}`;
      symbols.push({
        id,
        name: `fn${i}`,
        qualifiedName: `src.abort.fn${i}`,
        kind: "function",
        language: "typescript",
        filePath: "src/abort.ts",
        rangeStart: { line: 1 + i * 3, column: 1 },
        rangeEnd: { line: 3 + i * 3, column: 1 },
      });
      relations.push({
        type: "defines",
        sourceSymbolId: "file:src/abort.ts",
        targetSymbolId: id,
        filePath: "src/abort.ts",
        confidence: 1,
      });
    }

    store.upsertFileResult(makeFileResult({
      filePath: "src/abort.ts",
      symbols,
      relations,
    }));

    // Abort immediately
    const controller = new AbortController();
    controller.abort();

    const result = store.getDeadCode({ signal: controller.signal });
    // Should have 0 dead symbols because signal was already aborted
    expect(result.deadSymbols).toHaveLength(0);
    expect(result.totalScanned).toBe(0);
  });

  it("returns definedIn field matching the file path of each dead symbol", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/orphan.ts",
      symbols: [
        {
          id: "func:orphan:lonely",
          name: "lonely",
          qualifiedName: "src.orphan.lonely",
          kind: "function",
          language: "typescript",
          filePath: "src/orphan.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/orphan.ts", targetSymbolId: "func:orphan:lonely", filePath: "src/orphan.ts", confidence: 1 },
      ],
    }));

    const result = store.getDeadCode({});
    expect(result.deadSymbols).toHaveLength(1);
    expect(result.deadSymbols[0].node.label).toBe("lonely");
    expect(result.deadSymbols[0].definedIn).toBe("src/orphan.ts");
  });
});
