import { describe, it, expect, beforeEach } from "vitest";
import { GraphStore } from "../graph/graph-store.js";
import type { FileParseResult } from "../types/schema.js";

/**
 * Integration tests for the `getClassHierarchy()` query tool (Track 3 Sprint 2).
 *
 * Builds graphs with `inherits` edges and verifies that `getClassHierarchy()`
 * returns the correct ancestor/descendant chains.
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

describe("GraphStore.getClassHierarchy() — Track 3 Sprint 2", () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();
  });

  it("Test 1: Single-level inheritance (class B extends A) returns correct ancestor", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/models.ts",
      symbols: [
        {
          id: "class:models:A",
          name: "A",
          qualifiedName: "src.models.A",
          kind: "class",
          language: "typescript",
          filePath: "src/models.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 5, column: 1 },
        },
        {
          id: "class:models:B",
          name: "B",
          qualifiedName: "src.models.B",
          kind: "class",
          language: "typescript",
          filePath: "src/models.ts",
          rangeStart: { line: 7, column: 1 },
          rangeEnd: { line: 11, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/models.ts", targetSymbolId: "class:models:A", filePath: "src/models.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/models.ts", targetSymbolId: "class:models:B", filePath: "src/models.ts", confidence: 1 },
        // B inherits A (B → A)
        { type: "inherits", sourceSymbolId: "class:models:B", targetSymbolId: "class:models:A", filePath: "src/models.ts", confidence: 0.9 },
      ],
    }));

    const result = store.getClassHierarchy({ className: "B" });
    expect(result.root).not.toBeNull();
    expect(result.root!.label).toBe("B");
    expect(result.ancestors).toHaveLength(1);
    expect(result.ancestors[0].node.label).toBe("A");
    expect(result.ancestors[0].depth).toBe(1);
    expect(result.descendants).toHaveLength(0);
  });

  it("Test 2: Multi-level inheritance (C extends B extends A) returns full ancestor chain", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/chain.ts",
      symbols: [
        {
          id: "class:chain:A",
          name: "A",
          qualifiedName: "src.chain.A",
          kind: "class",
          language: "typescript",
          filePath: "src/chain.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
        {
          id: "class:chain:B",
          name: "B",
          qualifiedName: "src.chain.B",
          kind: "class",
          language: "typescript",
          filePath: "src/chain.ts",
          rangeStart: { line: 5, column: 1 },
          rangeEnd: { line: 7, column: 1 },
        },
        {
          id: "class:chain:C",
          name: "C",
          qualifiedName: "src.chain.C",
          kind: "class",
          language: "typescript",
          filePath: "src/chain.ts",
          rangeStart: { line: 9, column: 1 },
          rangeEnd: { line: 11, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/chain.ts", targetSymbolId: "class:chain:A", filePath: "src/chain.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/chain.ts", targetSymbolId: "class:chain:B", filePath: "src/chain.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/chain.ts", targetSymbolId: "class:chain:C", filePath: "src/chain.ts", confidence: 1 },
        // C → B → A
        { type: "inherits", sourceSymbolId: "class:chain:C", targetSymbolId: "class:chain:B", filePath: "src/chain.ts", confidence: 0.9 },
        { type: "inherits", sourceSymbolId: "class:chain:B", targetSymbolId: "class:chain:A", filePath: "src/chain.ts", confidence: 0.9 },
      ],
    }));

    const result = store.getClassHierarchy({ className: "C", maxDepth: 10 });
    expect(result.root).not.toBeNull();
    expect(result.root!.label).toBe("C");
    expect(result.ancestors).toHaveLength(2);

    const ancestorLabels = result.ancestors.map((a) => a.node.label);
    expect(ancestorLabels).toContain("B");
    expect(ancestorLabels).toContain("A");

    const bAncestor = result.ancestors.find((a) => a.node.label === "B")!;
    const aAncestor = result.ancestors.find((a) => a.node.label === "A")!;
    expect(bAncestor.depth).toBe(1);
    expect(aAncestor.depth).toBe(2);
  });

  it("Test 3: direction 'ancestors' returns only parents, not children", () => {
    // A ← B ← C (C extends B extends A)
    store.upsertFileResult(makeFileResult({
      filePath: "src/dir.ts",
      symbols: [
        {
          id: "class:dir:A",
          name: "A",
          qualifiedName: "src.dir.A",
          kind: "class",
          language: "typescript",
          filePath: "src/dir.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
        {
          id: "class:dir:B",
          name: "B",
          qualifiedName: "src.dir.B",
          kind: "class",
          language: "typescript",
          filePath: "src/dir.ts",
          rangeStart: { line: 5, column: 1 },
          rangeEnd: { line: 7, column: 1 },
        },
        {
          id: "class:dir:C",
          name: "C",
          qualifiedName: "src.dir.C",
          kind: "class",
          language: "typescript",
          filePath: "src/dir.ts",
          rangeStart: { line: 9, column: 1 },
          rangeEnd: { line: 11, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/dir.ts", targetSymbolId: "class:dir:A", filePath: "src/dir.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/dir.ts", targetSymbolId: "class:dir:B", filePath: "src/dir.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/dir.ts", targetSymbolId: "class:dir:C", filePath: "src/dir.ts", confidence: 1 },
        { type: "inherits", sourceSymbolId: "class:dir:C", targetSymbolId: "class:dir:B", filePath: "src/dir.ts", confidence: 0.9 },
        { type: "inherits", sourceSymbolId: "class:dir:B", targetSymbolId: "class:dir:A", filePath: "src/dir.ts", confidence: 0.9 },
      ],
    }));

    // Query B with direction "ancestors" — should get A but NOT C
    const result = store.getClassHierarchy({ className: "B", direction: "ancestors" });
    expect(result.root!.label).toBe("B");
    expect(result.ancestors).toHaveLength(1);
    expect(result.ancestors[0].node.label).toBe("A");
    expect(result.descendants).toHaveLength(0);
  });

  it("Test 4: direction 'descendants' returns only children, not parents", () => {
    // A ← B ← C (C extends B extends A)
    store.upsertFileResult(makeFileResult({
      filePath: "src/desc.ts",
      symbols: [
        {
          id: "class:desc:A",
          name: "A",
          qualifiedName: "src.desc.A",
          kind: "class",
          language: "typescript",
          filePath: "src/desc.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
        {
          id: "class:desc:B",
          name: "B",
          qualifiedName: "src.desc.B",
          kind: "class",
          language: "typescript",
          filePath: "src/desc.ts",
          rangeStart: { line: 5, column: 1 },
          rangeEnd: { line: 7, column: 1 },
        },
        {
          id: "class:desc:C",
          name: "C",
          qualifiedName: "src.desc.C",
          kind: "class",
          language: "typescript",
          filePath: "src/desc.ts",
          rangeStart: { line: 9, column: 1 },
          rangeEnd: { line: 11, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/desc.ts", targetSymbolId: "class:desc:A", filePath: "src/desc.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/desc.ts", targetSymbolId: "class:desc:B", filePath: "src/desc.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/desc.ts", targetSymbolId: "class:desc:C", filePath: "src/desc.ts", confidence: 1 },
        { type: "inherits", sourceSymbolId: "class:desc:C", targetSymbolId: "class:desc:B", filePath: "src/desc.ts", confidence: 0.9 },
        { type: "inherits", sourceSymbolId: "class:desc:B", targetSymbolId: "class:desc:A", filePath: "src/desc.ts", confidence: 0.9 },
      ],
    }));

    // Query B with direction "descendants" — should get C but NOT A
    const result = store.getClassHierarchy({ className: "B", direction: "descendants" });
    expect(result.root!.label).toBe("B");
    expect(result.ancestors).toHaveLength(0);
    expect(result.descendants).toHaveLength(1);
    expect(result.descendants[0].node.label).toBe("C");
    expect(result.descendants[0].depth).toBe(1);
  });

  it("Test 5: maxDepth limits traversal depth", () => {
    // D extends C extends B extends A — query D with maxDepth 1
    store.upsertFileResult(makeFileResult({
      filePath: "src/deep.ts",
      symbols: ["A", "B", "C", "D"].map((name, i) => ({
        id: `class:deep:${name}`,
        name,
        qualifiedName: `src.deep.${name}`,
        kind: "class" as const,
        language: "typescript" as const,
        filePath: "src/deep.ts",
        rangeStart: { line: 1 + i * 3, column: 1 },
        rangeEnd: { line: 3 + i * 3, column: 1 },
      })),
      relations: [
        ...["A", "B", "C", "D"].map((name) => ({
          type: "defines" as const,
          sourceSymbolId: "file:src/deep.ts",
          targetSymbolId: `class:deep:${name}`,
          filePath: "src/deep.ts",
          confidence: 1,
        })),
        { type: "inherits" as const, sourceSymbolId: "class:deep:D", targetSymbolId: "class:deep:C", filePath: "src/deep.ts", confidence: 0.9 },
        { type: "inherits" as const, sourceSymbolId: "class:deep:C", targetSymbolId: "class:deep:B", filePath: "src/deep.ts", confidence: 0.9 },
        { type: "inherits" as const, sourceSymbolId: "class:deep:B", targetSymbolId: "class:deep:A", filePath: "src/deep.ts", confidence: 0.9 },
      ],
    }));

    // maxDepth 1 — should only get C (direct parent), not B or A
    const result = store.getClassHierarchy({ className: "D", direction: "ancestors", maxDepth: 1 });
    expect(result.ancestors).toHaveLength(1);
    expect(result.ancestors[0].node.label).toBe("C");
    expect(result.ancestors[0].depth).toBe(1);
  });

  it("Test 6: NotFoundError thrown when class doesn't exist", () => {
    expect(() => {
      store.getClassHierarchy({ className: "NonExistent" });
    }).toThrow("Class not found in graph: NonExistent");
  });

  it("Test 7: Multiple inheritance (Python: class C(A, B)) returns both ancestors", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "src/multi.py",
      language: "python",
      symbols: [
        {
          id: "class:multi:A",
          name: "A",
          qualifiedName: "src.multi.A",
          kind: "class",
          language: "python",
          filePath: "src/multi.py",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
        {
          id: "class:multi:B",
          name: "B",
          qualifiedName: "src.multi.B",
          kind: "class",
          language: "python",
          filePath: "src/multi.py",
          rangeStart: { line: 5, column: 1 },
          rangeEnd: { line: 7, column: 1 },
        },
        {
          id: "class:multi:C",
          name: "C",
          qualifiedName: "src.multi.C",
          kind: "class",
          language: "python",
          filePath: "src/multi.py",
          rangeStart: { line: 9, column: 1 },
          rangeEnd: { line: 11, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/multi.py", targetSymbolId: "class:multi:A", filePath: "src/multi.py", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/multi.py", targetSymbolId: "class:multi:B", filePath: "src/multi.py", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/multi.py", targetSymbolId: "class:multi:C", filePath: "src/multi.py", confidence: 1 },
        // C inherits both A and B
        { type: "inherits", sourceSymbolId: "class:multi:C", targetSymbolId: "class:multi:A", filePath: "src/multi.py", confidence: 0.9 },
        { type: "inherits", sourceSymbolId: "class:multi:C", targetSymbolId: "class:multi:B", filePath: "src/multi.py", confidence: 0.9 },
      ],
    }));

    const result = store.getClassHierarchy({ className: "C" });
    expect(result.root!.label).toBe("C");
    expect(result.ancestors).toHaveLength(2);
    const ancestorLabels = result.ancestors.map((a) => a.node.label);
    expect(ancestorLabels).toContain("A");
    expect(ancestorLabels).toContain("B");
    // Both at depth 1
    for (const ancestor of result.ancestors) {
      expect(ancestor.depth).toBe(1);
    }
  });

  it("Test 8: TypeScript 'implements' keyword creates inherits edge (hierarchy query works)", () => {
    // Simulate: class Service implements IService
    store.upsertFileResult(makeFileResult({
      filePath: "src/impl.ts",
      symbols: [
        {
          id: "class:impl:IService",
          name: "IService",
          qualifiedName: "src.impl.IService",
          kind: "class",
          language: "typescript",
          filePath: "src/impl.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 5, column: 1 },
        },
        {
          id: "class:impl:Service",
          name: "Service",
          qualifiedName: "src.impl.Service",
          kind: "class",
          language: "typescript",
          filePath: "src/impl.ts",
          rangeStart: { line: 7, column: 1 },
          rangeEnd: { line: 15, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/impl.ts", targetSymbolId: "class:impl:IService", filePath: "src/impl.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/impl.ts", targetSymbolId: "class:impl:Service", filePath: "src/impl.ts", confidence: 1 },
        // Service implements IService → inherits edge
        { type: "inherits", sourceSymbolId: "class:impl:Service", targetSymbolId: "class:impl:IService", filePath: "src/impl.ts", confidence: 0.9 },
      ],
    }));

    const result = store.getClassHierarchy({ className: "Service" });
    expect(result.root!.label).toBe("Service");
    expect(result.ancestors).toHaveLength(1);
    expect(result.ancestors[0].node.label).toBe("IService");

    // Also verify from the interface side — IService should have Service as descendant
    const resultInterface = store.getClassHierarchy({ className: "IService" });
    expect(resultInterface.descendants).toHaveLength(1);
    expect(resultInterface.descendants[0].node.label).toBe("Service");
  });
});
