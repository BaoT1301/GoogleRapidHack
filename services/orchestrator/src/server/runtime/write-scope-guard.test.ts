import { describe, expect, it } from "vitest";
import {
  checkWriteScope,
  DOC_WRITE_SCOPE,
  enforceWriteScope,
  isPathInScope,
  type WriteScopeAllow,
} from "./write-scope-guard";

describe("write-scope-guard — enforceWriteScope (SEC-3)", () => {
  it("doc allowlist accepts *.md and .claude/**, rejects source", () => {
    const out = enforceWriteScope({
      changedPaths: [
        "README.md",
        ".claude/docs/x.md",
        ".claude/docs/reviews/note.txt",
        "src/app.ts",
        "package.json",
      ],
      allow: DOC_WRITE_SCOPE,
    });
    expect(out).toEqual(["src/app.ts", "package.json"]);
  });

  it("treats .kiro/ and .orchestrator/ as neutral (in scope)", () => {
    expect(
      enforceWriteScope({
        changedPaths: [".kiro/agents/orch-doc.json", ".orchestrator/mcp/x.json"],
        allow: DOC_WRITE_SCOPE,
      }),
    ).toEqual([]);
  });

  it("is empty for an all-in-scope set", () => {
    expect(
      enforceWriteScope({ changedPaths: ["a.md", ".claude/y.md"], allow: DOC_WRITE_SCOPE }),
    ).toEqual([]);
  });

  it("never throws on garbage input", () => {
    expect(enforceWriteScope({ changedPaths: undefined as unknown as string[], allow: DOC_WRITE_SCOPE })).toEqual([]);
  });

  it("generalizes to an arbitrary allowlist (e.g. a frontend persona)", () => {
    const FRONTEND: WriteScopeAllow = { prefixes: ["frontend/"], extensions: [".css"] };
    expect(
      enforceWriteScope({
        changedPaths: ["frontend/app.tsx", "styles.css", "backend/api.ts"],
        allow: FRONTEND,
      }),
    ).toEqual(["backend/api.ts"]);
  });
});

describe("write-scope-guard — isPathInScope", () => {
  it("strips ./ and treats dev/null as neutral", () => {
    expect(isPathInScope("./README.md", DOC_WRITE_SCOPE)).toBe(true);
    expect(isPathInScope("dev/null", DOC_WRITE_SCOPE)).toBe(true);
  });
  it("matches case-insensitively on extension", () => {
    expect(isPathInScope("CHANGELOG.MD", DOC_WRITE_SCOPE)).toBe(true);
  });
});

describe("write-scope-guard — checkWriteScope (FAIL-CLOSED)", () => {
  it("ok when every changed path is in scope", async () => {
    const v = await checkWriteScope({
      listChangedPaths: async () => ["README.md", ".claude/x.md"],
      allow: DOC_WRITE_SCOPE,
    });
    expect(v.ok).toBe(true);
  });

  it("rejects out-of-scope paths", async () => {
    const v = await checkWriteScope({
      listChangedPaths: async () => ["README.md", "src/app.ts"],
      allow: DOC_WRITE_SCOPE,
    });
    expect(v).toEqual({ ok: false, reason: "out-of-scope", outOfScope: ["src/app.ts"] });
  });

  it("FAILS CLOSED when the lister throws (indeterminate) — never passes on unknown", async () => {
    const v = await checkWriteScope({
      listChangedPaths: async () => {
        throw new Error("git diff failed in worktree");
      },
      allow: DOC_WRITE_SCOPE,
    });
    expect(v.ok).toBe(false);
    expect(v).toMatchObject({ reason: "indeterminate" });
  });
});
