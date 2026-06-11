import { describe, it, expect, beforeEach } from "vitest";
import { GraphStore } from "../graph/graph-store.js";
import type { FileParseResult } from "../types/schema.js";

/**
 * Integration test for the `searchSymbols()` query tool (Sprint 2 — Track 4).
 *
 * Builds small graphs with various symbol types and names,
 * then verifies that `searchSymbols()` correctly performs fuzzy and regex
 * matching with proper scoring and filtering.
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

describe("GraphStore.searchSymbols() — Sprint 2 Track 4", () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();

    // Seed a graph with diverse symbols for testing
    store.upsertFileResult(makeFileResult({
      filePath: "src/utils.ts",
      symbols: [
        {
          id: "func:utils:createUser",
          name: "createUser",
          qualifiedName: "src.utils.createUser",
          kind: "function",
          language: "typescript",
          filePath: "src/utils.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 5, column: 1 },
        },
        {
          id: "func:utils:deleteUser",
          name: "deleteUser",
          qualifiedName: "src.utils.deleteUser",
          kind: "function",
          language: "typescript",
          filePath: "src/utils.ts",
          rangeStart: { line: 7, column: 1 },
          rangeEnd: { line: 11, column: 1 },
        },
        {
          id: "class:utils:UserService",
          name: "UserService",
          qualifiedName: "src.utils.UserService",
          kind: "class",
          language: "typescript",
          filePath: "src/utils.ts",
          rangeStart: { line: 13, column: 1 },
          rangeEnd: { line: 20, column: 1 },
        },
        {
          id: "var:utils:MAX_USERS",
          name: "MAX_USERS",
          qualifiedName: "src.utils.MAX_USERS",
          kind: "variable",
          language: "typescript",
          filePath: "src/utils.ts",
          rangeStart: { line: 22, column: 1 },
          rangeEnd: { line: 22, column: 30 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/utils.ts", targetSymbolId: "func:utils:createUser", filePath: "src/utils.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/utils.ts", targetSymbolId: "func:utils:deleteUser", filePath: "src/utils.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/utils.ts", targetSymbolId: "class:utils:UserService", filePath: "src/utils.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/utils.ts", targetSymbolId: "var:utils:MAX_USERS", filePath: "src/utils.ts", confidence: 1 },
      ],
    }));

    store.upsertFileResult(makeFileResult({
      filePath: "backend/app/models.py",
      language: "python",
      symbols: [
        {
          id: "func:models:create_user",
          name: "create_user",
          qualifiedName: "app.models.create_user",
          kind: "function",
          language: "python",
          filePath: "backend/app/models.py",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 5, column: 1 },
        },
        {
          id: "class:models:UserModel",
          name: "UserModel",
          qualifiedName: "app.models.UserModel",
          kind: "class",
          language: "python",
          filePath: "backend/app/models.py",
          rangeStart: { line: 7, column: 1 },
          rangeEnd: { line: 15, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:backend/app/models.py", targetSymbolId: "func:models:create_user", filePath: "backend/app/models.py", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:backend/app/models.py", targetSymbolId: "class:models:UserModel", filePath: "backend/app/models.py", confidence: 1 },
      ],
    }));
  });

  it("exact name match returns score 1.0", () => {
    const result = store.searchSymbols({ query: "createUser" });

    const exactMatch = result.results.find((r) => r.node.label === "createUser");
    expect(exactMatch).toBeDefined();
    expect(exactMatch!.matchScore).toBe(1.0);
    expect(exactMatch!.matchedField).toBe("label");
  });

  it("case-insensitive match returns score 0.9", () => {
    const result = store.searchSymbols({ query: "createuser" });

    const match = result.results.find((r) => r.node.label === "createUser");
    expect(match).toBeDefined();
    expect(match!.matchScore).toBe(0.9);
    expect(match!.matchedField).toBe("label");
  });

  it("substring match on label returns score 0.7", () => {
    const result = store.searchSymbols({ query: "User" });

    // "createUser", "deleteUser", "UserService", "UserModel" should all match on label
    const createUserMatch = result.results.find((r) => r.node.label === "createUser");
    expect(createUserMatch).toBeDefined();
    expect(createUserMatch!.matchScore).toBe(0.7);
    expect(createUserMatch!.matchedField).toBe("label");
  });

  it("substring match on qualifiedName returns score 0.5", () => {
    // Search for something that only appears in qualifiedName, not in label
    const result = store.searchSymbols({ query: "app.models" });

    const match = result.results.find((r) => r.node.label === "create_user");
    expect(match).toBeDefined();
    expect(match!.matchScore).toBe(0.5);
    expect(match!.matchedField).toBe("qualifiedName");
  });

  it("kind filter restricts results to matching kinds", () => {
    const result = store.searchSymbols({ query: "User", kind: "class" });

    // Only classes should be returned
    for (const r of result.results) {
      expect(r.node.kind).toBe("class");
    }
    const labels = result.results.map((r) => r.node.label);
    expect(labels).toContain("UserService");
    expect(labels).toContain("UserModel");
    expect(labels).not.toContain("createUser");
    expect(labels).not.toContain("deleteUser");
  });

  it("language filter restricts results to matching languages", () => {
    const result = store.searchSymbols({ query: "User", language: "python" });

    for (const r of result.results) {
      expect(r.node.language).toBe("python");
    }
    const labels = result.results.map((r) => r.node.label);
    expect(labels).toContain("UserModel");
    expect(labels).toContain("create_user");
    expect(labels).not.toContain("createUser");
    expect(labels).not.toContain("UserService");
  });

  it("useRegex: true with valid regex returns matching symbols", () => {
    // Regex to match symbols starting with "create"
    const result = store.searchSymbols({ query: "^create", useRegex: true });

    const labels = result.results.map((r) => r.node.label);
    expect(labels).toContain("createUser");
    expect(labels).toContain("create_user");
    expect(labels).not.toContain("deleteUser");
    expect(labels).not.toContain("UserService");
  });

  it("useRegex: true with invalid regex throws InvalidParamsError", () => {
    expect(() => {
      store.searchSymbols({ query: "[invalid(", useRegex: true });
    }).toThrow("Invalid regex pattern");
  });

  it("maxResults limits output count", () => {
    const result = store.searchSymbols({ query: "User", maxResults: 2 });

    expect(result.results).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.totalMatches).toBeGreaterThan(2);
  });

  it("results are sorted by score descending, then alphabetically", () => {
    // Seed additional symbols to create tie scenarios
    store.upsertFileResult(makeFileResult({
      filePath: "src/extra.ts",
      symbols: [
        {
          id: "func:extra:alpha",
          name: "alpha",
          qualifiedName: "src.extra.alpha",
          kind: "function",
          language: "typescript",
          filePath: "src/extra.ts",
          rangeStart: { line: 1, column: 1 },
          rangeEnd: { line: 3, column: 1 },
        },
        {
          id: "func:extra:beta",
          name: "beta",
          qualifiedName: "src.extra.beta",
          kind: "function",
          language: "typescript",
          filePath: "src/extra.ts",
          rangeStart: { line: 5, column: 1 },
          rangeEnd: { line: 7, column: 1 },
        },
      ],
      relations: [
        { type: "defines", sourceSymbolId: "file:src/extra.ts", targetSymbolId: "func:extra:alpha", filePath: "src/extra.ts", confidence: 1 },
        { type: "defines", sourceSymbolId: "file:src/extra.ts", targetSymbolId: "func:extra:beta", filePath: "src/extra.ts", confidence: 1 },
      ],
    }));

    // Search for "alpha" — exact match should be first
    const result = store.searchSymbols({ query: "alpha" });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].node.label).toBe("alpha");
    expect(result.results[0].matchScore).toBe(1.0);

    // For tied scores, results should be alphabetical
    // Search for something that gives multiple 0.7 matches
    const userResult = store.searchSymbols({ query: "User" });
    // Group by score
    const score07 = userResult.results.filter((r) => r.matchScore === 0.7);
    for (let i = 1; i < score07.length; i++) {
      expect(score07[i - 1].node.label.localeCompare(score07[i].node.label)).toBeLessThanOrEqual(0);
    }
  });

  it("filePattern filter restricts to matching files", () => {
    const result = store.searchSymbols({ query: "User", filePattern: "backend/**" });

    const labels = result.results.map((r) => r.node.label);
    expect(labels).toContain("UserModel");
    expect(labels).toContain("create_user");
    expect(labels).not.toContain("createUser");
    expect(labels).not.toContain("UserService");
  });
});
