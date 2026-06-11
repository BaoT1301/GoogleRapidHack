import { describe, expect, it } from "vitest";
import { codexAdapter } from "./codex";

describe("codexAdapter", () => {
  it("builds the safe non-interactive Codex command", () => {
    const worktreePath = "/tmp/agent-worktree";
    const command = codexAdapter.buildCommand({
      prompt: "Create a smoke file",
      nodeId: "node_codex",
      worktreePath,
    });

    expect(command.command).toBe("codex");
    expect(command.cwd).toBe(worktreePath);
    expect(command.args.slice(0, 5)).toEqual([
      "exec",
      "--sandbox",
      "workspace-write",
      "--cd",
      worktreePath,
    ]);
    expect(command.args.at(-1)).toContain("Create a smoke file");
    expect(command.args.at(-1)).toContain("isolated git worktree");
    expect(command.args.at(-1)).toContain("Runtime node id: node_codex");
    expect(command.args.at(-1)).toContain("avoid editing broad/shared files");
    expect(command.args.at(-1)).toContain("<!-- orch:output -->");
  });

  it("does not include dangerous bypass flags", () => {
    const command = codexAdapter.buildCommand({
      prompt: "Do work",
      nodeId: "node_codex",
      worktreePath: "/tmp/agent-worktree",
    });

    expect(command.args).not.toContain("--yolo");
    expect(command.args).not.toContain("danger-full-access");
    expect(command.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("emits `-m <model>` after the fixed prefix when a model is resolved (MODEL-1)", () => {
    const worktreePath = "/tmp/agent-worktree";
    const command = codexAdapter.buildCommand({
      prompt: "Do work",
      nodeId: "node_codex",
      worktreePath,
      model: "gpt-4.1",
    });
    expect(command.args.slice(0, 5)).toEqual([
      "exec",
      "--sandbox",
      "workspace-write",
      "--cd",
      worktreePath,
    ]);
    expect(command.args.slice(5, 7)).toEqual(["-m", "gpt-4.1"]);
    expect(command.args.at(-1)).toContain("Do work");
  });

  it("omits the model flag when no model is provided", () => {
    const command = codexAdapter.buildCommand({
      prompt: "Do work",
      nodeId: "node_codex",
      worktreePath: "/tmp/agent-worktree",
    });
    expect(command.args).not.toContain("-m");
  });
});
