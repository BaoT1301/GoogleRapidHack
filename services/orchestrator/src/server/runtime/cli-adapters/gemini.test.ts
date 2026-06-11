import { describe, expect, it } from "vitest";
import { geminiAdapter } from "./gemini";

describe("geminiAdapter", () => {
  it("builds the verified non-interactive Gemini command", () => {
    const worktreePath = "/tmp/agent-worktree";
    const command = geminiAdapter.buildCommand({
      prompt: "Create a smoke file",
      nodeId: "node_gemini",
      worktreePath,
    });

    expect(command.command).toBe("gemini");
    expect(command.cwd).toBe(worktreePath);
    expect(command.args).toEqual(["-p", "Create a smoke file"]);
  });

  it("emits `-m <model>` when a model is resolved (MODEL-1)", () => {
    const command = geminiAdapter.buildCommand({
      prompt: "Create a smoke file",
      nodeId: "node_gemini",
      worktreePath: "/tmp/agent-worktree",
      model: "gemini-2.5-pro",
    });
    expect(command.args).toEqual(["-m", "gemini-2.5-pro", "-p", "Create a smoke file"]);
  });

  it("does not include broad permission or auto-approval flags", () => {
    const command = geminiAdapter.buildCommand({
      prompt: "Do work",
      nodeId: "node_gemini",
      worktreePath: "/tmp/agent-worktree",
    });

    expect(command.args).not.toContain("--yolo");
    expect(command.args).not.toContain("--skip-trust");
    expect(command.args).not.toContain("--approval-mode");
    expect(command.args).not.toContain("yolo");
    expect(command.args).not.toContain("auto_edit");
    expect(command.args).not.toContain("--allowed-tools");
  });
});
