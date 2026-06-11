import { describe, expect, it } from "vitest";
import {
  isDocScopedPath,
  extractChangedPaths,
  findOutOfScopeDocPaths,
} from "./doc-scope-guard";

describe("isDocScopedPath", () => {
  it("accepts *.md anywhere and anything under .claude/", () => {
    expect(isDocScopedPath("README.md")).toBe(true);
    expect(isDocScopedPath("docs/guide.md")).toBe(true);
    expect(isDocScopedPath(".claude/local_context.md")).toBe(true);
    expect(isDocScopedPath(".claude/docs/reviews/x.txt")).toBe(true);
    expect(isDocScopedPath("./CHANGELOG.MD")).toBe(true);
  });
  it("rejects source/config/non-doc paths", () => {
    expect(isDocScopedPath("src/app.ts")).toBe(false);
    expect(isDocScopedPath("package.json")).toBe(false);
    expect(isDocScopedPath("services/orchestrator/src/x.tsx")).toBe(false);
  });
  it("treats /dev/null as in-scope (add/delete sentinel)", () => {
    expect(isDocScopedPath("dev/null")).toBe(true);
  });
  it("treats orchestrator plumbing (.kiro/, .orchestrator/) as neutral", () => {
    expect(isDocScopedPath(".kiro/agents/orch-doc.json")).toBe(true);
    expect(isDocScopedPath(".orchestrator/mcp/run/node/mcp.json")).toBe(true);
  });
});

describe("extractChangedPaths", () => {
  it("parses diff --git, ---/+++ and rename headers", () => {
    const patch = [
      "diff --git a/README.md b/README.md",
      "index e69..a1b 100644",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1,2 @@",
      "+new line",
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
    ].join("\n");
    const paths = extractChangedPaths(patch);
    expect(paths).toContain("README.md");
    expect(paths).toContain("src/app.ts");
  });
  it("handles an untracked (no-index) add against /dev/null", () => {
    const patch = [
      "diff --git a/dev/null b/notes/new.md",
      "--- /dev/null",
      "+++ b/notes/new.md",
      "@@ -0,0 +1 @@",
      "+hello",
    ].join("\n");
    const paths = extractChangedPaths(patch);
    expect(paths).toContain("notes/new.md");
    expect(paths).not.toContain("dev/null");
    expect(paths).not.toContain("/dev/null");
  });
  it("returns [] for empty/garbage input (never throws)", () => {
    expect(extractChangedPaths("")).toEqual([]);
    expect(extractChangedPaths(undefined as unknown as string)).toEqual([]);
  });
});

describe("findOutOfScopeDocPaths", () => {
  it("returns [] for a docs-only patch (passes)", () => {
    const patch = [
      "diff --git a/README.md b/README.md",
      "+++ b/README.md",
      "diff --git a/.claude/docs/x.md b/.claude/docs/x.md",
      "+++ b/.claude/docs/x.md",
    ].join("\n");
    expect(findOutOfScopeDocPaths(patch)).toEqual([]);
  });
  it("flags non-doc paths (fails)", () => {
    const patch = [
      "diff --git a/README.md b/README.md",
      "+++ b/README.md",
      "diff --git a/src/app.ts b/src/app.ts",
      "+++ b/src/app.ts",
    ].join("\n");
    expect(findOutOfScopeDocPaths(patch)).toEqual(["src/app.ts"]);
  });
});
