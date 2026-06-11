import { describe, it, expect, beforeEach } from "vitest";
import { GraphStore } from "../graph/graph-store.js";
import type { FileParseResult } from "../types/schema.js";

/**
 * Integration test for the `getHotspots()` query tool (Sprint 2 — Track 2).
 *
 * Builds small graphs with various symbol types and edge patterns,
 * then verifies that `getHotspots()` correctly identifies the most-referenced
 * symbols by fan-in count.
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

describe("GraphStore.getHotspots() — Sprint 2 Track 2", () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();
  });

  it("returns symbols sorted by fan-in descending", () => {
    // Build graph: funcA is called by 3 others, funcB by 1, funcC by 2
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
        {
          id: "func:app:caller1",
          name: "caller1",
          qualifiedName: "src.app.caller1",
          kind: "function",
          language: "typescript",
          filePath: "src/app.ts",
          rangeStart: { line: 19, column: 1 },
          rangeEnd: { line: 23, column: 1 },
        },
        {
          id: "func:app:caller2",
          name: "caller2",
          qualifiedName: "src.app.caller2",
          kind: "function",
          language: "typescript",
          filePath: "src/app.ts",
          rangeStart: { line: 25, column: 1 },
          rangeEnd: { line: 29, column: 1 },
        },
        {
          id: "func:app:caller3",
          name: "caller3",
          qualifiedName: "src.app.caller3",
          kind: "function",
          language: "typescript",
          filePath: "src/app.ts",
          rangeStart: { line: 31, column: 1 },
          rangeEnd: { line: 35, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/app.ts", targetSymbolId: "func:app:funcA", filePath: "src/app.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/app.ts", targetSymbolId: "func:app:funcB", filePath: "src/app.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/app.ts", targetSymbolId: "func:app:funcC", filePath: "src/app.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/app.ts", targetSymbolId: "func:app:caller1", filePath: "src/app.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/app.ts", targetSymbolId: "func:app:caller2", filePath: "src/app.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/app.ts", targetSymbolId: "func:app:caller3", filePath: "src/app.ts", confidence: 1 },
        // funcA called by caller1, caller2, caller3 → fanIn = 3
        { type: "calls", sourceSymbolId: "func:app:caller1", targetSymbolId: "func:app:funcA", filePath: "src/app.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: "func:app:caller2", targetSymbolId: "func:app:funcA", filePath: "src/app.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: "func:app:caller3", targetSymbolId: "func:app:funcA", filePath: "src/app.ts", confidence: 1 },
        // funcC called by caller1, caller2 → fanIn = 2
        { type: "calls", sourceSymbolId: "func:app:caller1", targetSymbolId: "func:app:funcC", filePath: "src/app.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: "func:app:caller2", targetSymbolId: "func:app:funcC", filePath: "src/app.ts", confidence: 1 },
        // funcB called by caller1 → fanIn = 1
        { type: "calls", sourceSymbolId: "func:app:caller1", targetSymbolId: "func:app:funcB", filePath: "src/app.ts", confidence: 1 },
      ],
    }));

    const result = store.getHotspots({});
    const labels = result.hotspots.map((h) => h.node.label);

    // funcA (fanIn=3+1 defines) should be before funcC (fanIn=2+1 defines) which should be before funcB (fanIn=1+1 defines)
    // Note: "defines" edges from file node also count as inbound edges
    const funcAIdx = labels.indexOf("funcA");
    const funcBIdx = labels.indexOf("funcB");
    const funcCIdx = labels.indexOf("funcC");

    expect(funcAIdx).toBeLessThan(funcCIdx);
    expect(funcCIdx).toBeLessThan(funcBIdx);
  });

  it("topN parameter limits result count", () => {
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

    const result = store.getHotspots({ topN: 3 });
    expect(result.hotspots).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(result.totalSymbolsScanned).toBe(10);
  });

  it("kind filter returns only matching symbol kinds", () => {
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
          id: "class:models:MyClass",
          name: "MyClass",
          qualifiedName: "src.models.MyClass",
          kind: "class",
          language: "typescript",
          filePath: "src/models.ts",
          rangeStart: { line: 5, column: 1 },
          rangeEnd: { line: 10, column: 1 },
        },
        {
          id: "var:models:myVar",
          name: "myVar",
          qualifiedName: "src.models.myVar",
          kind: "variable",
          language: "typescript",
          filePath: "src/models.ts",
          rangeStart: { line: 12, column: 1 },
          rangeEnd: { line: 14, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/models.ts", targetSymbolId: "func:models:helperFn", filePath: "src/models.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/models.ts", targetSymbolId: "class:models:MyClass", filePath: "src/models.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/models.ts", targetSymbolId: "var:models:myVar", filePath: "src/models.ts", confidence: 1 },
      ],
    }));

    // Filter by function only
    const fnResult = store.getHotspots({ kind: "function" });
    const fnLabels = fnResult.hotspots.map((h) => h.node.label);
    expect(fnLabels).toContain("helperFn");
    expect(fnLabels).not.toContain("MyClass");
    expect(fnLabels).not.toContain("myVar");

    // Filter by class only
    const classResult = store.getHotspots({ kind: "class" });
    const classLabels = classResult.hotspots.map((h) => h.node.label);
    expect(classLabels).toContain("MyClass");
    expect(classLabels).not.toContain("helperFn");
  });

  it("language filter returns only matching languages", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "backend/app/utils.py",
      language: "python",
      symbols: [
        {
          id: "func:py:pyFunc",
          name: "pyFunc",
          qualifiedName: "app.utils.pyFunc",
          kind: "function",
          language: "python",
          filePath: "backend/app/utils.py",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:backend/app/utils.py", targetSymbolId: "func:py:pyFunc", filePath: "backend/app/utils.py", confidence: 1 },
      ],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/utils.ts",
      symbols: [
        {
          id: "func:ts:tsFunc",
          name: "tsFunc",
          qualifiedName: "src.utils.tsFunc",
          kind: "function",
          language: "typescript",
          filePath: "src/utils.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/utils.ts", targetSymbolId: "func:ts:tsFunc", filePath: "src/utils.ts", confidence: 1 },
      ],
    }));

    // Filter by python only
    const pyResult = store.getHotspots({ language: "python" });
    const pyLabels = pyResult.hotspots.map((h) => h.node.label);
    expect(pyLabels).toContain("pyFunc");
    expect(pyLabels).not.toContain("tsFunc");

    // Filter by typescript only
    const tsResult = store.getHotspots({ language: "typescript" });
    const tsLabels = tsResult.hotspots.map((h) => h.node.label);
    expect(tsLabels).toContain("tsFunc");
    expect(tsLabels).not.toContain("pyFunc");
  });

  it("filePattern filter restricts to matching files", () => {
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
    const result = store.getHotspots({ filePattern: "backend/**" });
    const labels = result.hotspots.map((h) => h.node.label);
    expect(labels).toContain("backendFn");
    expect(labels).not.toContain("frontendFn");
  });

  it("edgeBreakdown correctly groups inbound edges by type", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/service.ts",
      symbols: [
        {
          id: "func:service:target",
          name: "target",
          qualifiedName: "src.service.target",
          kind: "function",
          language: "typescript",
          filePath: "src/service.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 5, column: 1 },
        },
        {
          id: "func:service:callerA",
          name: "callerA",
          qualifiedName: "src.service.callerA",
          kind: "function",
          language: "typescript",
          filePath: "src/service.ts",
          rangeStart: { line: 7, column: 1 },
          rangeEnd: { line: 11, column: 1 },
        },
        {
          id: "func:service:callerB",
          name: "callerB",
          qualifiedName: "src.service.callerB",
          kind: "function",
          language: "typescript",
          filePath: "src/service.ts",
          rangeStart: { line: 13, column: 1 },
          rangeEnd: { line: 17, column: 1 },
        },
        {
          id: "func:service:reader",
          name: "reader",
          qualifiedName: "src.service.reader",
          kind: "function",
          language: "typescript",
          filePath: "src/service.ts",
          rangeStart: { line: 19, column: 1 },
          rangeEnd: { line: 23, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/service.ts", targetSymbolId: "func:service:target", filePath: "src/service.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/service.ts", targetSymbolId: "func:service:callerA", filePath: "src/service.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/service.ts", targetSymbolId: "func:service:callerB", filePath: "src/service.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/service.ts", targetSymbolId: "func:service:reader", filePath: "src/service.ts", confidence: 1 },
        // Two calls edges + one references edge to target
        { type: "calls", sourceSymbolId: "func:service:callerA", targetSymbolId: "func:service:target", filePath: "src/service.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: "func:service:callerB", targetSymbolId: "func:service:target", filePath: "src/service.ts", confidence: 1 },
        { type: "references", sourceSymbolId: "func:service:reader", targetSymbolId: "func:service:target", filePath: "src/service.ts", confidence: 1 },
      ],
    }));

    const result = store.getHotspots({});
    const targetHotspot = result.hotspots.find((h) => h.node.label === "target");

    expect(targetHotspot).toBeDefined();
    // edgeBreakdown should include: defines=1, calls=2, references=1
    expect(targetHotspot!.edgeBreakdown["calls"]).toBe(2);
    expect(targetHotspot!.edgeBreakdown["references"]).toBe(1);
    expect(targetHotspot!.edgeBreakdown["defines"]).toBe(1);
  });

  it("fanOut is computed correctly for each hotspot", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/caller.ts",
      symbols: [
        {
          id: "func:caller:main",
          name: "mainCaller",
          qualifiedName: "src.caller.mainCaller",
          kind: "function",
          language: "typescript",
          filePath: "src/caller.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 5, column: 1 },
        },
        {
          id: "func:caller:helperA",
          name: "helperA",
          qualifiedName: "src.caller.helperA",
          kind: "function",
          language: "typescript",
          filePath: "src/caller.ts",
          rangeStart: { line: 7, column: 1 },
          rangeEnd: { line: 11, column: 1 },
        },
        {
          id: "func:caller:helperB",
          name: "helperB",
          qualifiedName: "src.caller.helperB",
          kind: "function",
          language: "typescript",
          filePath: "src/caller.ts",
          rangeStart: { line: 13, column: 1 },
          rangeEnd: { line: 17, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/caller.ts", targetSymbolId: "func:caller:main", filePath: "src/caller.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/caller.ts", targetSymbolId: "func:caller:helperA", filePath: "src/caller.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/caller.ts", targetSymbolId: "func:caller:helperB", filePath: "src/caller.ts", confidence: 1 },
        // mainCaller calls helperA and helperB → fanOut = 2
        { type: "calls", sourceSymbolId: "func:caller:main", targetSymbolId: "func:caller:helperA", filePath: "src/caller.ts", confidence: 1 },
        { type: "calls", sourceSymbolId: "func:caller:main", targetSymbolId: "func:caller:helperB", filePath: "src/caller.ts", confidence: 1 },
      ],
    }));

    const result = store.getHotspots({});
    const mainHotspot = result.hotspots.find((h) => h.node.label === "mainCaller");

    expect(mainHotspot).toBeDefined();
    // mainCaller has 2 outbound calls edges → fanOut = 2
    expect(mainHotspot!.fanOut).toBe(2);
  });

  it("empty graph returns empty hotspots array with totalSymbolsScanned: 0", () => {
    const result = store.getHotspots({});
    expect(result.hotspots).toEqual([]);
    expect(result.totalSymbolsScanned).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("includeEdgeTypes filters which inbound edges count toward fanIn", () => {
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
          rangeEnd: { line: 5, column: 1 },
        },
        {
          id: "func:mixed:caller",
          name: "caller",
          qualifiedName: "src.mixed.caller",
          kind: "function",
          language: "typescript",
          filePath: "src/mixed.ts",
          rangeStart: { line: 7, column: 1 },
          rangeEnd: { line: 11, column: 1 },
        },
        {
          id: "func:mixed:reader",
          name: "reader",
          qualifiedName: "src.mixed.reader",
          kind: "function",
          language: "typescript",
          filePath: "src/mixed.ts",
          rangeStart: { line: 13, column: 1 },
          rangeEnd: { line: 17, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/mixed.ts", targetSymbolId: "func:mixed:target", filePath: "src/mixed.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/mixed.ts", targetSymbolId: "func:mixed:caller", filePath: "src/mixed.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/mixed.ts", targetSymbolId: "func:mixed:reader", filePath: "src/mixed.ts", confidence: 1 },
        // caller calls target
        { type: "calls", sourceSymbolId: "func:mixed:caller", targetSymbolId: "func:mixed:target", filePath: "src/mixed.ts", confidence: 1 },
        // reader references target
        { type: "references", sourceSymbolId: "func:mixed:reader", targetSymbolId: "func:mixed:target", filePath: "src/mixed.ts", confidence: 1 },
      ],
    }));

    // Only count "calls" edges — should exclude the "references" and "defines" edges
    const result = store.getHotspots({ includeEdgeTypes: ["calls"] });
    const targetHotspot = result.hotspots.find((h) => h.node.label === "target");

    expect(targetHotspot).toBeDefined();
    // Only the "calls" edge should count
    expect(targetHotspot!.fanIn).toBe(1);
    expect(targetHotspot!.edgeBreakdown["calls"]).toBe(1);
    expect(targetHotspot!.edgeBreakdown["references"]).toBeUndefined();
    expect(targetHotspot!.edgeBreakdown["defines"]).toBeUndefined();
  });
});
