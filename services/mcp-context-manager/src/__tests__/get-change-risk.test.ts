import { describe, it, expect, beforeEach } from "vitest";
import { GraphStore } from "../graph/graph-store.js";
import type { FileParseResult } from "../types/schema.js";

/**
 * Integration test for the `getChangeRisk()` query tool (Track 4, Sprint 3).
 *
 * Builds small graphs with file-level import edges and symbols, then verifies
 * that `getChangeRisk()` correctly aggregates impact analysis across multiple
 * changed files, deduplicates affected files, computes aggregate risk scores,
 * suggests test files, and cross-references with hotspots.
 */

function makeFileResult(
  overrides: Partial<FileParseResult> & Pick<FileParseResult, "filePath">,
): FileParseResult {
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

describe("GraphStore.getChangeRisk() — Track 4 Sprint 3", () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();
  });

  it("returns impact analysis + risk score for a single changed file", () => {
    // A (source) ← B (imports A) ← C (imports B)
    store.upsertFileResult(
      makeFileResult({ filePath: "src/a.py" }),
    );
    store.upsertFileResult(
      makeFileResult({
        filePath: "src/b.py",
        resolvedImports: ["src/a.py"],
      }),
    );
    store.upsertFileResult(
      makeFileResult({
        filePath: "src/c.py",
        resolvedImports: ["src/b.py"],
      }),
    );

    const result = store.getChangeRisk({ changedFiles: ["src/a.py"] });

    expect(result.changedFiles).toEqual(["src/a.py"]);
    expect(result.affectedFiles.length).toBeGreaterThanOrEqual(1);

    // B should be direct, C should be transitive
    const fileB = result.affectedFiles.find((f) => f.filePath === "src/b.py");
    expect(fileB).toBeDefined();
    expect(fileB!.impactType).toBe("direct");
    expect(fileB!.depth).toBe(1);

    const fileC = result.affectedFiles.find((f) => f.filePath === "src/c.py");
    expect(fileC).toBeDefined();
    expect(fileC!.impactType).toBe("transitive");

    expect(result.aggregateRiskScore).toBeGreaterThan(0);
    expect(result.aggregateRiskScore).toBeLessThanOrEqual(1.0);
    expect(result.truncated).toBe(false);
  });

  it("aggregates risk score and deduplicates affected files for multiple changed files", () => {
    // A ← C (imports A)
    // B ← C (imports B)
    // Both A and B changed → C should appear once
    store.upsertFileResult(makeFileResult({ filePath: "src/a.py" }));
    store.upsertFileResult(makeFileResult({ filePath: "src/b.py" }));
    store.upsertFileResult(
      makeFileResult({
        filePath: "src/c.py",
        resolvedImports: ["src/a.py", "src/b.py"],
      }),
    );

    const result = store.getChangeRisk({
      changedFiles: ["src/a.py", "src/b.py"],
    });

    expect(result.changedFiles).toEqual(["src/a.py", "src/b.py"]);

    // C should appear exactly once (deduplicated)
    const cEntries = result.affectedFiles.filter(
      (f) => f.filePath === "src/c.py",
    );
    expect(cEntries).toHaveLength(1);
    expect(cEntries[0].impactType).toBe("direct");

    // riskContribution for C should be 1.0 (both changed files affect it)
    expect(cEntries[0].riskContribution).toBe(1.0);

    expect(result.aggregateRiskScore).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });

  it("populates hotspotOverlap when a changed file affects a hotspot symbol", () => {
    // Create a "hotspot" function that many files call
    store.upsertFileResult(
      makeFileResult({
        filePath: "src/core.py",
        symbols: [
          {
            id: "func:core:get_db",
            name: "get_db",
            qualifiedName: "core.get_db",
            kind: "function",
            language: "python",
            filePath: "src/core.py",
            rangeStart: { line: 1, column: 1 },
            rangeEnd: { line: 5, column: 1 },
          },
        ],
        relations: [
          {
            type: "defines",
            sourceSymbolId: "file:src/core.py",
            targetSymbolId: "func:core:get_db",
            filePath: "src/core.py",
            confidence: 1,
          },
        ],
      }),
    );

    // Create multiple files that call get_db (to make it a hotspot)
    for (let i = 0; i < 5; i++) {
      store.upsertFileResult(
        makeFileResult({
          filePath: `src/consumer${i}.py`,
          symbols: [
            {
              id: `func:consumer${i}:use_db`,
              name: `use_db_${i}`,
              qualifiedName: `consumer${i}.use_db`,
              kind: "function",
              language: "python",
              filePath: `src/consumer${i}.py`,
              rangeStart: { line: 1, column: 1 },
              rangeEnd: { line: 3, column: 1 },
            },
          ],
          relations: [
            {
              type: "defines",
              sourceSymbolId: `file:src/consumer${i}.py`,
              targetSymbolId: `func:consumer${i}:use_db`,
              filePath: `src/consumer${i}.py`,
              confidence: 1,
            },
            {
              type: "calls",
              sourceSymbolId: `func:consumer${i}:use_db`,
              targetSymbolId: "func:core:get_db",
              filePath: `src/consumer${i}.py`,
              confidence: 1,
            },
          ],
          resolvedImports: ["src/core.py"],
        }),
      );
    }

    // Change a file that is a dependent of core.py — core.py symbols are in blast radius
    // Actually, change core.py itself so its symbols are included
    const result = store.getChangeRisk({ changedFiles: ["src/core.py"] });

    // get_db should be a hotspot (5 inbound calls) and in the blast radius
    expect(result.hotspotOverlap.length).toBeGreaterThanOrEqual(1);
    const hotspot = result.hotspotOverlap.find(
      (h) => h.node.label === "get_db",
    );
    expect(hotspot).toBeDefined();
    expect(hotspot!.fanIn).toBeGreaterThanOrEqual(5);
  });

  it("gracefully skips non-existent file paths (not an error)", () => {
    store.upsertFileResult(makeFileResult({ filePath: "src/a.py" }));
    store.upsertFileResult(
      makeFileResult({
        filePath: "src/b.py",
        resolvedImports: ["src/a.py"],
      }),
    );

    // Include a non-existent file alongside a real one
    const result = store.getChangeRisk({
      changedFiles: ["src/a.py", "src/nonexistent.py"],
    });

    // Should still return results for the valid file
    expect(result.changedFiles).toContain("src/a.py");
    expect(result.changedFiles).toContain("src/nonexistent.py");
    expect(result.affectedFiles.length).toBeGreaterThanOrEqual(1);
    expect(result.truncated).toBe(false);
  });

  it("throws InvalidParamsError for empty changedFiles array", () => {
    expect(() => {
      store.getChangeRisk({ changedFiles: [] });
    }).toThrow("changed_files must contain at least one file path");
  });

  it("respects max_depth and max_files limits", () => {
    // Chain: A ← B ← C ← D ← E
    store.upsertFileResult(makeFileResult({ filePath: "src/a.py" }));
    store.upsertFileResult(
      makeFileResult({
        filePath: "src/b.py",
        resolvedImports: ["src/a.py"],
      }),
    );
    store.upsertFileResult(
      makeFileResult({
        filePath: "src/c.py",
        resolvedImports: ["src/b.py"],
      }),
    );
    store.upsertFileResult(
      makeFileResult({
        filePath: "src/d.py",
        resolvedImports: ["src/c.py"],
      }),
    );
    store.upsertFileResult(
      makeFileResult({
        filePath: "src/e.py",
        resolvedImports: ["src/d.py"],
      }),
    );

    // maxDepth=1 should only return B (direct)
    const depthResult = store.getChangeRisk({
      changedFiles: ["src/a.py"],
      maxDepth: 1,
    });
    expect(depthResult.affectedFiles).toHaveLength(1);
    expect(depthResult.affectedFiles[0].filePath).toBe("src/b.py");

    // maxFiles=2 should truncate
    const filesResult = store.getChangeRisk({
      changedFiles: ["src/a.py"],
      maxDepth: 5,
      maxFiles: 2,
    });
    expect(filesResult.affectedFiles).toHaveLength(2);
    expect(filesResult.truncated).toBe(true);
  });

  it("collects suggested test files from affected files", () => {
    store.upsertFileResult(makeFileResult({ filePath: "src/core.py" }));
    store.upsertFileResult(
      makeFileResult({
        filePath: "src/main.py",
        resolvedImports: ["src/core.py"],
      }),
    );
    store.upsertFileResult(
      makeFileResult({
        filePath: "src/tests/test_core.py",
        resolvedImports: ["src/core.py"],
      }),
    );
    store.upsertFileResult(
      makeFileResult({
        filePath: "src/core.spec.py",
        resolvedImports: ["src/core.py"],
      }),
    );

    const result = store.getChangeRisk({ changedFiles: ["src/core.py"] });

    expect(result.suggestedTestFiles).toContain("src/tests/test_core.py");
    expect(result.suggestedTestFiles).toContain("src/core.spec.py");
    expect(result.suggestedTestFiles).not.toContain("src/main.py");
  });

  it("respects AbortSignal for early termination", () => {
    store.upsertFileResult(makeFileResult({ filePath: "src/a.py" }));
    store.upsertFileResult(
      makeFileResult({
        filePath: "src/b.py",
        resolvedImports: ["src/a.py"],
      }),
    );

    const controller = new AbortController();
    controller.abort();

    const result = store.getChangeRisk({
      changedFiles: ["src/a.py"],
      signal: controller.signal,
    });

    // Should have 0 affected files because signal was already aborted
    expect(result.affectedFiles).toHaveLength(0);
    expect(result.aggregateRiskScore).toBe(0);
  });
});
