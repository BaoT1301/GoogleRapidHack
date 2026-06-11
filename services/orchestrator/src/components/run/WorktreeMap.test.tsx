import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { applyEvents, initialRunState, type RuntimeEvent } from "@/lib/run-events";
import { WorktreeMap } from "@/components/run/WorktreeMap";

const ev = (
  type: string,
  nodeId?: string,
  payload: Record<string, unknown> = {},
): RuntimeEvent => ({ type, runId: "r1", nodeId, payload });

describe("WorktreeMap panel (VIS-3)", () => {
  it("lists each execute node's branch + worktree path with a label", () => {
    const state = applyEvents(initialRunState, [
      ev("node.worktree.created", "A", {
        worktreePath: ".orchestrator/worktrees/r1/A",
        branchName: "agent/r1/A",
      }),
      ev("node.running", "A"),
      ev("node.worktree.created", "B", {
        worktreePath: ".orchestrator/worktrees/r1/B",
        branchName: "agent/r1/B",
      }),
      ev("node.completed", "B"),
    ]);

    render(<WorktreeMap state={state} labelFor={(id) => (id === "A" ? "Build" : "Test")} />);

    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("Test")).toBeInTheDocument();
    expect(screen.getByText("agent/r1/A")).toBeInTheDocument();
    expect(screen.getByText(".orchestrator/worktrees/r1/B")).toBeInTheDocument();
  });

  it("shows an empty state before any worktree exists", () => {
    render(<WorktreeMap state={initialRunState} />);
    expect(screen.getByText(/no worktrees yet/i)).toBeInTheDocument();
  });
});
