import { describe, it, expect, beforeEach } from "vitest";
import { GraphStore } from "../graph/graph-store.js";
import type { FileParseResult } from "../types/schema.js";

/**
 * Integration test for the `getImpactAnalysis()` query tool (Track 6).
 *
 * Builds a graph with file A→B→C import chain and verifies that
 * `getImpactAnalysis("A")` returns B (direct) and C (transitive).
 */

function makeFileResult(overrides: Partial<FileParseResult> & Pick<FileParseResult, "filePath">): FileParseResult {
  return {
    language: "python",
    hash: Math.random().toString(36).slice(2),
    symbols: [],
    relations: [],
    parsedImports: [],
    resolvedImports: [],
    parseErrors: [],
    ...overrides,
  };
}

describe("GraphStore.getImpactAnalysis() — Track 6", () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();
  });

  it("returns empty results when file has no reverse imports", () => {
    store.upsertFileResult(makeFileResult({
      filePath: "backend/app/orphan.py",
      symbols: [
        {
          id: "func:orphan:do_stuff",
          name: "do_stuff",
          qualifiedName: "app.orphan.do_stuff",
          kind: "function",
          language: "python",
          filePath: "backend/app/orphan.py",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 5, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:backend/app/orphan.py", targetSymbolId: "func:orphan:do_stuff", filePath: "backend/app/orphan.py", confidence: 1 },
      ],
    }));

    const result = store.getImpactAnalysis({ filePath: "backend/app/orphan.py" });
    expect(result.sourceFile).toBe("backend/app/orphan.py");
    expect(result.affectedFiles).toEqual([]);
    expect(result.affectedSymbols).toEqual([]);
    expect(result.riskScore).toBe(0);
    expect(result.suggestedTestFiles).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("returns B (direct) and C (transitive) for import chain A→B→C", () => {
    // File A (database.py) — the source file we're analyzing
    store.upsertFileResult(makeFileResult({
      filePath: "backend/app/database.py",
      symbols: [
        {
          id: "func:database:get_db",
          name: "get_db",
          qualifiedName: "app.database.get_db",
          kind: "function",
          language: "python",
          filePath: "backend/app/database.py",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 10, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:backend/app/database.py", targetSymbolId: "func:database:get_db", filePath: "backend/app/database.py", confidence: 1 },
      ],
    }));

    // File B (main.py) imports A
    store.upsertFileResult(makeFileResult({
      filePath: "backend/app/main.py",
      symbols: [
        {
          id: "func:main:create_app",
          name: "create_app",
          qualifiedName: "app.main.create_app",
          kind: "function",
          language: "python",
          filePath: "backend/app/main.py",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 15, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:backend/app/main.py", targetSymbolId: "func:main:create_app", filePath: "backend/app/main.py", confidence: 1 },
      ],
      resolvedImports: ["backend/app/database.py"],
    }));

    // File C (routers/users.py) imports B
    store.upsertFileResult(makeFileResult({
      filePath: "backend/app/routers/users.py",
      symbols: [
        {
          id: "func:users:get_users",
          name: "get_users",
          qualifiedName: "app.routers.users.get_users",
          kind: "function",
          language: "python",
          filePath: "backend/app/routers/users.py",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 20, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:backend/app/routers/users.py", targetSymbolId: "func:users:get_users", filePath: "backend/app/routers/users.py", confidence: 1 },
      ],
      resolvedImports: ["backend/app/main.py"],
    }));

    const result = store.getImpactAnalysis({ filePath: "backend/app/database.py" });

    expect(result.sourceFile).toBe("backend/app/database.py");
    expect(result.affectedFiles).toHaveLength(2);

    // B is direct (depth 1)
    const fileB = result.affectedFiles.find((f) => f.filePath === "backend/app/main.py");
    expect(fileB).toBeDefined();
    expect(fileB!.depth).toBe(1);
    expect(fileB!.impactType).toBe("direct");

    // C is transitive (depth 2)
    const fileC = result.affectedFiles.find((f) => f.filePath === "backend/app/routers/users.py");
    expect(fileC).toBeDefined();
    expect(fileC!.depth).toBe(2);
    expect(fileC!.impactType).toBe("transitive");

    // Affected symbols should include symbols from B and C
    const symbolNames = result.affectedSymbols.map((s) => s.node.label);
    expect(symbolNames).toContain("create_app");
    expect(symbolNames).toContain("get_users");

    // Risk score should be > 0
    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.riskScore).toBeLessThanOrEqual(1.0);

    expect(result.truncated).toBe(false);
  });

  it("respects maxDepth limit", () => {
    // Chain: A → B → C → D (each imports the previous)
    store.upsertFileResult(makeFileResult({ filePath: "src/a.py" }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/b.py",
      resolvedImports: ["src/a.py"],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/c.py",
      resolvedImports: ["src/b.py"],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/d.py",
      resolvedImports: ["src/c.py"],
    }));

    // maxDepth=1 should only return B (direct)
    const result = store.getImpactAnalysis({ filePath: "src/a.py", maxDepth: 1 });
    expect(result.affectedFiles).toHaveLength(1);
    expect(result.affectedFiles[0].filePath).toBe("src/b.py");
    expect(result.affectedFiles[0].impactType).toBe("direct");
  });

  it("respects maxFiles limit and sets truncated flag", () => {
    // Create a fan-in: 10 files all import the source file
    store.upsertFileResult(makeFileResult({ filePath: "src/core.py" }));

    for (let i = 0; i < 10; i++) {
      store.upsertFileResult(makeFileResult({
        filePath: `src/consumer${i}.py`,
        resolvedImports: ["src/core.py"],
      }));
    }

    // maxFiles=3 should truncate
    const result = store.getImpactAnalysis({ filePath: "src/core.py", maxFiles: 3 });
    expect(result.affectedFiles).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("computes risk score capped at 1.0", () => {
    // Create many affected files and symbols to push risk score to cap
    store.upsertFileResult(makeFileResult({ filePath: "src/base.py" }));

    for (let i = 0; i < 5; i++) {
      store.upsertFileResult(makeFileResult({
        filePath: `src/mod${i}.py`,
        symbols: [
          {
            id: `func:mod${i}:fn_a`,
            name: `fn_a_${i}`,
            qualifiedName: `src.mod${i}.fn_a`,
            kind: "function",
            language: "python",
            filePath: `src/mod${i}.py`,
            rangeStart: { line: 1, column: 1 },
            rangeEnd: { line: 3, column: 1 },
          },
          {
            id: `func:mod${i}:fn_b`,
            name: `fn_b_${i}`,
            qualifiedName: `src.mod${i}.fn_b`,
            kind: "function",
            language: "python",
            filePath: `src/mod${i}.py`,
            rangeStart: { line: 5, column: 1 },
            rangeEnd: { line: 7, column: 1 },
          },
        ],
        relations: [
          { type: "defines", sourceSymbolId: `file:src/mod${i}.py`, targetSymbolId: `func:mod${i}:fn_a`, filePath: `src/mod${i}.py`, confidence: 1 },
          { type: "defines", sourceSymbolId: `file:src/mod${i}.py`, targetSymbolId: `func:mod${i}:fn_b`, filePath: `src/mod${i}.py`, confidence: 1 },
        ],
        resolvedImports: ["src/base.py"],
      }));
    }

    const result = store.getImpactAnalysis({ filePath: "src/base.py" });
    // 5 files * 0.3 = 1.5, 10 symbols * 0.1 = 1.0 → total 2.5, capped at 1.0
    expect(result.riskScore).toBe(1.0);
  });

  it("identifies suggested test files from affected files", () => {
    store.upsertFileResult(makeFileResult({ filePath: "backend/app/database.py" }));

    // A regular file that imports database.py
    store.upsertFileResult(makeFileResult({
      filePath: "backend/app/main.py",
      resolvedImports: ["backend/app/database.py"],
    }));

    // A test file that imports database.py
    store.upsertFileResult(makeFileResult({
      filePath: "backend/tests/test_database.py",
      resolvedImports: ["backend/app/database.py"],
    }));

    // Another test file with spec pattern
    store.upsertFileResult(makeFileResult({
      filePath: "backend/app/database.spec.py",
      resolvedImports: ["backend/app/database.py"],
    }));

    const result = store.getImpactAnalysis({ filePath: "backend/app/database.py" });
    expect(result.suggestedTestFiles).toContain("backend/tests/test_database.py");
    expect(result.suggestedTestFiles).toContain("backend/app/database.spec.py");
    // main.py should NOT be in suggested test files
    expect(result.suggestedTestFiles).not.toContain("backend/app/main.py");
  });

  it("respects AbortSignal for early termination", () => {
    // Chain: A → B → C
    store.upsertFileResult(makeFileResult({ filePath: "src/a.py" }));
    store.upsertFileResult(makeFileResult({
      filePath: "src/b.py",
      resolvedImports: ["src/a.py"],
    }));
    store.upsertFileResult(makeFileResult({
      filePath: "src/c.py",
      resolvedImports: ["src/b.py"],
    }));

    // Abort immediately
    const controller = new AbortController();
    controller.abort();

    const result = store.getImpactAnalysis({ filePath: "src/a.py", signal: controller.signal });
    expect(result.sourceFile).toBe("src/a.py");
    // Should have 0 affected files because signal was already aborted
    expect(result.affectedFiles).toHaveLength(0);
  });

  it("handles diamond-shaped import graphs without duplicates", () => {
    // Diamond: B imports A, C imports A, D imports both B and C
    store.upsertFileResult(makeFileResult({ filePath: "src/a.py" }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/b.py",
      resolvedImports: ["src/a.py"],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/c.py",
      resolvedImports: ["src/a.py"],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "src/d.py",
      resolvedImports: ["src/b.py", "src/c.py"],
    }));

    const result = store.getImpactAnalysis({ filePath: "src/a.py", maxDepth: 3 });

    // Should have B, C (direct), D (transitive) — no duplicates
    const filePaths = result.affectedFiles.map((f) => f.filePath).sort();
    expect(filePaths).toEqual(["src/b.py", "src/c.py", "src/d.py"]);

    // B and C are direct (depth 1)
    const directFiles = result.affectedFiles.filter((f) => f.impactType === "direct");
    expect(directFiles).toHaveLength(2);

    // D is transitive (depth 2)
    const transitiveFiles = result.affectedFiles.filter((f) => f.impactType === "transitive");
    expect(transitiveFiles).toHaveLength(1);
    expect(transitiveFiles[0].filePath).toBe("src/d.py");
  });
});
