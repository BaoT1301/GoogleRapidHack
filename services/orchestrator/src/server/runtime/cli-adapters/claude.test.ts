import { describe, expect, it } from "vitest";
import { claudeAdapter } from "./claude";

describe("claudeAdapter command shape", () => {
  it("builds `claude --print <prompt>`", () => {
    const cmd = claudeAdapter.buildCommand({
      prompt: "explain this",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
    });
    expect(cmd.command).toBe("claude");
    expect(cmd.args).toEqual(["--print", "explain this"]);
    expect(cmd.cwd).toBe("/tmp/wt");
  });

  it("emits `--model <m>` before the prompt when a model is resolved (MODEL-1)", () => {
    const cmd = claudeAdapter.buildCommand({
      prompt: "explain this",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
      model: "claude-sonnet-4",
    });
    expect(cmd.args).toEqual(["--print", "--model", "claude-sonnet-4", "explain this"]);
  });

  it("throws if worktreePath is missing or not a string", () => {
    expect(() =>
      claudeAdapter.buildCommand({
        prompt: "explain this",
        nodeId: "n1",
        worktreePath: "" as any,
      })
    ).toThrow(/worktreePath is required/i);
  });

  it("throws if prompt is missing or empty", () => {
    expect(() =>
      claudeAdapter.buildCommand({
        prompt: "   ",
        nodeId: "n1",
        worktreePath: "/tmp/wt",
      })
    ).toThrow(/prompt is required/i);
  });
});
