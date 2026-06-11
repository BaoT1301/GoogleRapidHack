import { render, screen } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyEvents,
  initialRunState,
  MAX_TERMINAL_LINES,
  type RuntimeEvent,
} from "@/lib/run-events";

// Capture everything written into the (mocked) xterm surface so we can assert
// the run terminal forwards streamed lines as raw ANSI byte writes.
const writes: string[] = [];
vi.mock("@/components/run/XtermView", () => ({
  XtermView: forwardRef(function MockXtermView(_props: unknown, ref: unknown) {
    useImperativeHandle(ref as never, () => ({
      write: (d: string) => writes.push(d),
      clear: () => {},
      fit: () => {},
      focus: () => {},
    }));
    return <div data-testid="xterm" />;
  }),
}));

// Stub the interactive terminal — it opens a WebSocket we don't want in unit tests.
vi.mock("@/components/run/InteractiveTerminal", () => ({
  InteractiveTerminal: (props: { nodeId: string }) => (
    <div data-testid="interactive-terminal">{props.nodeId}</div>
  ),
}));

const { RunTerminal } = await import("@/components/run/RunTerminal");

const ev = (
  type: string,
  nodeId: string,
  payload: Record<string, unknown> = {},
): RuntimeEvent => ({ type, runId: "r1", nodeId, payload });

beforeEach(() => {
  writes.length = 0;
});
afterEach(() => vi.clearAllMocks());

describe("RunTerminal — xterm rendering", () => {
  it("writes stdout lines as ANSI byte writes terminated with CRLF", () => {
    const state = applyEvents(initialRunState, [
      ev("node.running", "A"),
      ev("node.stdout", "A", { line: "hello \x1b[38;5;11mworld\x1b[0m" }),
    ]);
    render(<RunTerminal terminal={state.nodes.A} label="Build" />);
    expect(writes).toContain("hello \x1b[38;5;11mworld\x1b[0m\r\n");
  });

  it("colours stderr lines red", () => {
    const state = applyEvents(initialRunState, [ev("node.stderr", "A", { line: "boom" })]);
    render(<RunTerminal terminal={state.nodes.A} label="Build" />);
    expect(writes).toContain("\x1b[31mboom\x1b[0m\r\n");
  });

  it("shows the dropped-line indicator under a flood (VIS-1 preserved)", () => {
    const overflow = 120;
    const total = MAX_TERMINAL_LINES + overflow;
    const events: RuntimeEvent[] = [ev("node.running", "A")];
    for (let i = 0; i < total; i += 1) events.push(ev("node.stdout", "A", { line: `L${i}` }));
    const state = applyEvents(initialRunState, events);

    render(<RunTerminal terminal={state.nodes.A} label="Build" />);
    expect(
      screen.getByText(new RegExp(`\\+${overflow} earlier lines dropped`, "i")),
    ).toBeInTheDocument();
  });

  it("shows failure diagnostics instead of empty output when a node failed before stdout", () => {
    const state = applyEvents(initialRunState, [
      ev("node.failed", "A", {
        stage: "worktree",
        error: "Refusing to create worktree with only 1.7 GiB free.",
      }),
    ]);

    render(<RunTerminal terminal={state.nodes.A} label="Build" />);

    expect(screen.queryByText(/No output yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Node failed during worktree/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Refusing to create worktree/i).length).toBeGreaterThanOrEqual(1);
  });

  it("shows skip diagnostics instead of empty output for dependency-skipped nodes", () => {
    const state = applyEvents(initialRunState, [
      ev("node.skipped", "B", {
        reason: "Dependency A did not complete successfully",
      }),
    ]);

    render(<RunTerminal terminal={state.nodes.B} label="Downstream" />);

    expect(screen.queryByText(/No output yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Node skipped/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Dependency A did not complete successfully/i).length).toBeGreaterThanOrEqual(1);
  });
});

describe("RunTerminal — shell tab gating", () => {
  it("disables the Shell tab when there is no runId / worktree", () => {
    const state = applyEvents(initialRunState, [ev("node.running", "A")]);
    render(<RunTerminal terminal={state.nodes.A} label="Build" />);
    const shellTab = screen.getByRole("button", { name: /shell/i });
    expect(shellTab).toBeDisabled();
  });

  it("enables the Shell tab once a worktree exists and runId is provided", () => {
    const state = applyEvents(initialRunState, [
      ev("node.worktree.created", "A", {
        worktreePath: "/wt/A",
        branchName: "agent/r1/A",
      }),
    ]);
    render(<RunTerminal terminal={state.nodes.A} label="Build" runId="r1" />);
    expect(screen.getByRole("button", { name: /shell/i })).not.toBeDisabled();
  });

  it("renders Plan context requests as user-friendly questions", async () => {
    const state = applyEvents(initialRunState, [
      ev("node.plan.context_required", "plan_1", { questionCount: 1 }),
    ]);
    render(
      <RunTerminal
        terminal={state.nodes.plan_1}
        label="Plan"
        planOutput={{
          kind: "plan",
          status: "context_required",
          provider: "cloud",
          contextRequest: {
            confidence: 0.7,
            questions: ["Which auth provider should be used?"],
            missingContext: ["auth requirements"],
          },
        }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^plan$/i }));
    expect(screen.getByText(/planner needs more context/i)).toBeInTheDocument();
    expect(screen.getByText(/which auth provider/i)).toBeInTheDocument();
    expect(screen.getByText("auth requirements")).toBeInTheDocument();
  });

  it("renders Plan proposal preview and calls apply", async () => {
    const onApply = vi.fn();
    const state = applyEvents(initialRunState, [
      ev("node.plan.proposal_ready", "plan_1", { proposedNodeCount: 1 }),
    ]);
    render(
      <RunTerminal
        terminal={state.nodes.plan_1}
        label="Plan"
        onApplyPlanProposal={onApply}
        planOutput={{
          kind: "plan",
          status: "proposal_ready",
          provider: "cloud",
          graphProposal: {
            featureName: "Better workflow",
            proposedNodes: [{ id: "node_tests", kind: "execute", label: "Tests" }],
            proposedEdges: [{ id: "edge_1", source: "plan_1", target: "node_tests", kind: "flow" }],
          },
          warnings: ["Review before applying."],
        }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^plan$/i }));
    expect(screen.getByText("Better workflow")).toBeInTheDocument();
    expect(screen.getByText(/Unapplied proposal/i)).toBeInTheDocument();
    expect(screen.getByText(/1 proposed nodes \/ 1 proposed edges/i)).toBeInTheDocument();
    expect(screen.getByText(/Review before applying/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /apply proposal to canvas/i }));
    expect(onApply).toHaveBeenCalledWith("plan_1");
  });

  it("renders applied Plan proposal state distinctly", async () => {
    const state = applyEvents(initialRunState, [
      ev("node.plan.applied", "plan_1", { appliedGraphId: "graph_1" }),
    ]);
    render(
      <RunTerminal
        terminal={state.nodes.plan_1}
        label="Plan"
        planOutput={{
          kind: "plan",
          status: "proposal_ready",
          provider: "cloud",
          applied: true,
          graphProposal: {
            featureName: "Applied workflow",
            proposedNodes: [{ id: "node_tests", kind: "execute", label: "Tests" }],
            proposedEdges: [],
          },
        }}
        onApplyPlanProposal={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^plan$/i }));
    expect(screen.getAllByText(/^Applied$/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /^applied$/i })).toBeDisabled();
  });

  it("renders Plan failure reason without looking like a context request", async () => {
    const state = applyEvents(initialRunState, [
      ev("node.plan.failed", "plan_1", { reason: "planner unavailable" }),
    ]);
    render(
      <RunTerminal
        terminal={state.nodes.plan_1}
        label="Plan"
        planOutput={{
          kind: "plan",
          status: "failed",
          provider: "cloud",
          warnings: ["provider unavailable"],
        }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /^plan$/i }));
    expect(screen.getByText(/Reason: planner unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/Planner needs more context/i)).not.toBeInTheDocument();
  });

  it("renders blocked Gate summaries without treating them as crashes", async () => {
    const state = applyEvents(initialRunState, [
      ev("node.gate.blocked", "gate_1", {
        kind: "gate",
        status: "blocked",
        fanInMode: "all-of",
        upstreamTotal: 3,
        upstreamSucceeded: 1,
        upstreamFailed: 1,
        upstreamSkipped: 1,
        upstreamBlocked: 0,
        reason: "gate blocked (all-of: 1/3 upstream succeeded)",
      }),
    ]);

    render(<RunTerminal terminal={state.nodes.gate_1} label="Quality Gate" />);

    await userEvent.click(screen.getByRole("button", { name: /^gate$/i }));
    expect(screen.getByText(/Gate blocked: 1\/3 upstream succeeded, all-of required/i)).toBeInTheDocument();
    expect(screen.getByText(/gate blocked \(all-of: 1\/3 upstream succeeded\)/i)).toBeInTheDocument();
  });

  it("renders Loop iteration summary and break-condition hint honestly", async () => {
    const state = applyEvents(initialRunState, [
      ev("node.loop.exhausted", "loop_1", {
        kind: "loop",
        status: "exhausted",
        childGraphId: "graph_child",
        iterations: 3,
        maxIterations: 3,
        breakCondition: "stop when tests pass",
        breakConditionEvaluated: false,
        breakReason: "max_iterations_exhausted",
        childRunIds: ["run_child_1", "run_child_2", "run_child_3"],
      }),
    ]);

    render(<RunTerminal terminal={state.nodes.loop_1} label="Retry Loop" />);

    await userEvent.click(screen.getByRole("button", { name: /^loop$/i }));
    expect(screen.getByText(/Loop exhausted: 3\/3 iterations/i)).toBeInTheDocument();
    expect(screen.getByText(/Break reason: max_iterations_exhausted/i)).toBeInTheDocument();
    expect(screen.getByText("graph_child")).toBeInTheDocument();
    expect(screen.getByText("run_child_2")).toBeInTheDocument();
    expect(screen.getByText(/Break condition is a planning hint/i)).toBeInTheDocument();
    expect(screen.getByText(/Evaluated by runtime: no/i)).toBeInTheDocument();
  });
});
