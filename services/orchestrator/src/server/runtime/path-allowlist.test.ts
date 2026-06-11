import { describe, expect, it } from "vitest";
import { checkPathAllowlist } from "./path-allowlist";

const base = {
  rootRepoPath: "/repo",
  worktreePath: "/repo/.orchestrator/worktrees/run_1/node_1",
};

describe("checkPathAllowlist", () => {
  it("allows all changed files when allowedPaths is missing", () => {
    const result = checkPathAllowlist({
      ...base,
      changedFiles: ["ORCH_FAKE_AGENT_EDIT.md"],
    });

    expect(result.ok).toBe(true);
    expect(result.violatingFiles).toEqual([]);
  });

  it("allows files inside allowed repo-relative prefixes", () => {
    const result = checkPathAllowlist({
      ...base,
      changedFiles: ["src/runtime/file.ts"],
      allowedPaths: ["src/runtime"],
    });

    expect(result.ok).toBe(true);
    expect(result.violatingFiles).toEqual([]);
  });

  it("warns by default for files outside allowed prefixes", () => {
    const result = checkPathAllowlist({
      ...base,
      changedFiles: ["ORCH_FAKE_AGENT_EDIT.md"],
      allowedPaths: ["src"],
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("warn");
    expect(result.violatingFiles).toEqual(["ORCH_FAKE_AGENT_EDIT.md"]);
  });

  it("fails in fail mode for files outside allowed prefixes", () => {
    const result = checkPathAllowlist({
      ...base,
      changedFiles: ["ORCH_FAKE_AGENT_EDIT.md"],
      allowedPaths: ["src"],
      enforcementMode: "fail",
    });

    expect(result.ok).toBe(false);
    expect(result.mode).toBe("fail");
    expect(result.violatingFiles).toEqual(["ORCH_FAKE_AGENT_EDIT.md"]);
  });

  it("rejects path traversal inputs safely", () => {
    const result = checkPathAllowlist({
      ...base,
      changedFiles: ["../outside.md", "src/ok.ts"],
      allowedPaths: ["../bad", "src"],
    });

    expect(result.changedFiles).toEqual(["src/ok.ts"]);
    expect(result.allowedPrefixes).toEqual(["src"]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "Ignored unsafe allowedPaths entry: ../bad",
        "Ignored unsafe changed file path: ../outside.md",
      ]),
    );
  });
});
