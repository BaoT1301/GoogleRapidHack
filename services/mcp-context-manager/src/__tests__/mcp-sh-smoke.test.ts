import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const FIXTURE = resolve(
  __dirname,
  "fixtures/mcp-sh-validate-workspace.sh"
);

function runFixture(testCase: string) {
  return spawnSync("bash", [FIXTURE, testCase], { encoding: "utf8" });
}

describe("validate_workspace (mcp.sh)", () => {
  it("exits 0 when WORKSPACE_PATH points at an existing directory", () => {
    const result = runFixture("existing");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("exit:0");
  });

  it("exits 1 when WORKSPACE_PATH points at a non-existent directory", () => {
    const result = runFixture("missing");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("does not resolve to an existing directory");
  });

  it("exits 0 with default '.' when no .env.mcp is present", () => {
    const result = runFixture("default");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("exit:0");
  });
});
