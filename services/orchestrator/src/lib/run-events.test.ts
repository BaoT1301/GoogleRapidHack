import { describe, expect, it } from "vitest";
import {
  applyEvents,
  initialRunState,
  MAX_TERMINAL_LINES,
  nodeElapsedLabelMap,
  nodeStatusMap,
  runReducer,
  runDocToEvents,
  worktreeMap,
  type RuntimeEvent,
} from "@/lib/run-events";

const ev = (
  type: string,
  nodeId?: string,
  payload: Record<string, unknown> = {},
  timestamp?: string,
): RuntimeEvent => ({ type, runId: "r1", nodeId, payload, timestamp });

describe("runReducer — node-scoped routing", () => {
  it("routes interleaved stdout/stderr to the correct node terminal", () => {
    const events: RuntimeEvent[] = [
      ev("run.started"),
      ev("node.queued", "A"),
      ev("node.queued", "B"),
      ev("node.running", "A"),
      ev("node.stdout", "A", { line: "a-1" }),
      ev("node.running", "B"),
      ev("node.stdout", "B", { line: "b-1" }),
      ev("node.stdout", "A", { line: "a-2" }),
      ev("node.stderr", "B", { line: "b-err" }),
      ev("node.patch", "A", { patchLength: 12, patchPreview: "diff --git" }),
      ev("node.output", "A", { output: { ok: true } }),
      ev("node.completed", "A"),
      ev("node.failed", "B"),
      ev("run.completed"),
    ];

    const state = applyEvents(initialRunState, events);

    expect(state.status).toBe("completed");
    expect(state.order).toEqual(["A", "B"]);

    // Node A: only its own lines, in order.
    expect(state.nodes.A.lines).toEqual([
      { stream: "stdout", text: "a-1" },
      { stream: "stdout", text: "a-2" },
    ]);
    expect(state.nodes.A.status).toBe("success");
    expect(state.nodes.A.patch).toEqual({ length: 12, preview: "diff --git" });
    expect(state.nodes.A.output).toEqual({ ok: true });

    // Node B: its own stdout + stderr, never A's.
    expect(state.nodes.B.lines).toEqual([
      { stream: "stdout", text: "b-1" },
      { stream: "stderr", text: "b-err" },
    ]);
    expect(state.nodes.B.status).toBe("failed");
  });

  it("flags a non-blocking output parse failure", () => {
    const state = applyEvents(initialRunState, [
      ev("node.queued", "A"),
      ev("node.output_parse_failed", "A"),
    ]);
    expect(state.nodes.A.outputParseFailed).toBe(true);
  });

  it("maps run.status payloads to run state", () => {
    expect(
      runReducer(initialRunState, ev("run.status", undefined, { status: "failed" }))
        .status,
    ).toBe("failed");
  });

  it("maps backend success run.status events to completed", () => {
    expect(
      runReducer(initialRunState, ev("run.status", undefined, { status: "success" }))
        .status,
    ).toBe("completed");
    expect(
      runReducer(initialRunState, { type: "run.status", runId: "r1", status: "success" } as RuntimeEvent & { status: string })
        .status,
    ).toBe("completed");
  });

  it("tracks per-node elapsed runtime labels from lifecycle timestamps", () => {
    const state = applyEvents(initialRunState, [
      ev("node.running", "A", {}, "2026-06-11T00:00:00.000Z"),
      ev("node.running", "B", {}, "2026-06-11T00:00:30.000Z"),
      ev("node.completed", "A", {}, "2026-06-11T00:01:05.000Z"),
    ]);
    expect(
      nodeElapsedLabelMap(state, Date.parse("2026-06-11T00:01:40.000Z")),
    ).toEqual({
      A: "1:05",
      B: "1:10",
    });
  });

  it("ignores node events with no nodeId", () => {
    const state = runReducer(initialRunState, ev("node.stdout", undefined, { line: "x" }));
    expect(state).toBe(initialRunState);
  });
});

describe("nodeStatusMap — live canvas status (RUN-8)", () => {
  it("reflects running → success as SSE events arrive", () => {
    let state = applyEvents(initialRunState, [ev("node.queued", "A"), ev("node.running", "A")]);
    expect(nodeStatusMap(state).A).toBe("running");
    state = runReducer(state, ev("node.completed", "A"));
    expect(nodeStatusMap(state).A).toBe("success");
  });

  it("reflects a skipped (gated) node", () => {
    const state = applyEvents(initialRunState, [ev("node.queued", "B"), ev("node.skipped", "B", { reason: "gated" })]);
    expect(nodeStatusMap(state).B).toBe("skipped");
  });

  it("reflects a blocked gate from the compatibility node.skipped envelope", () => {
    const state = applyEvents(initialRunState, [
      ev("node.gate.evaluating", "G", { kind: "gate", fanInMode: "all-of" }),
      ev("node.gate.blocked", "G", { kind: "gate", status: "blocked", fanInMode: "all-of" }),
      ev("node.skipped", "G", { kind: "gate", blocked: true, reason: "gate blocked" }),
    ]);
    expect(nodeStatusMap(state).G).toBe("blocked");
    expect(state.nodes.G.gate?.status).toBe("blocked");
  });

  it("tracks loop lifecycle state from node.loop events", () => {
    let state = applyEvents(initialRunState, [
      ev("node.loop.started", "L", { childGraphId: "g_child", maxIterations: 3 }),
      ev("node.loop.iteration.completed", "L", {
        iteration: 1,
        maxIterations: 3,
        childGraphId: "g_child",
        childRunId: "run_child_1",
        childRunStatus: "failed",
      }),
    ]);
    expect(nodeStatusMap(state).L).toBe("running");
    expect(state.nodes.L.loop?.status).toBe("running");

    state = runReducer(state, ev("node.loop.exhausted", "L", {
      kind: "loop",
      status: "exhausted",
      iterations: 3,
      maxIterations: 3,
      breakReason: "max_iterations_exhausted",
    }));
    expect(nodeStatusMap(state).L).toBe("failed");
    expect(state.nodes.L.loop?.status).toBe("exhausted");
  });

  it("tracks multiple nodes independently", () => {
    const state = applyEvents(initialRunState, [
      ev("node.running", "A"),
      ev("node.running", "B"),
      ev("node.completed", "A"),
      ev("node.failed", "B"),
    ]);
    expect(nodeStatusMap(state)).toEqual({ A: "success", B: "failed" });
  });

  it("stores failure and skip diagnostics for nodes with no stdout", () => {
    const state = applyEvents(initialRunState, [
      ev("node.failed", "A", {
        stage: "worktree",
        error: "Refusing to create worktree with only 1.7 GiB free.",
      }),
      ev("node.skipped", "B", {
        reason: "Dependency A did not complete successfully",
      }),
    ]);

    expect(state.nodes.A.status).toBe("failed");
    expect(state.nodes.A.diagnostic?.title).toBe("Node failed during worktree");
    expect(state.nodes.A.diagnostic?.message).toContain("Refusing to create worktree");
    expect(state.nodes.B.status).toBe("skipped");
    expect(state.nodes.B.diagnostic?.message).toContain("Dependency A");
  });

  it("tracks merge and cleanup activity separately from node terminals", () => {
    const state = applyEvents(initialRunState, [
      ev("run.started"),
      ev("merge.started", undefined, { nodeCount: 2, baseBranch: "main" }),
      ev("merge.completed", "A", {
        cleanup: { agentBranchDeleted: true },
      }),
      ev("cleanup.completed", undefined, {
        checkedWith: "git branch",
        branchCleanupComplete: false,
        remainingBranches: ["agent/r/B"],
      }),
    ]);

    expect(state.status).toBe("running");
    expect(state.order).toEqual([]);
    expect(state.activity.map((item) => item.type)).toEqual([
      "merge.started",
      "merge.completed",
      "cleanup.completed",
    ]);
    expect(state.activity.at(-1)?.message).toContain("1 runtime branch");
    expect(state.activity.at(-1)?.tone).toBe("warning");
  });
});

describe("worktreeMap — live worktree map (VIS-3)", () => {
  it("lists each node's worktree path + branch, in order, with live status", () => {
    const state = applyEvents(initialRunState, [
      ev("node.queued", "A"),
      ev("node.worktree.created", "A", { worktreePath: ".orchestrator/wt/r/A", branchName: "agent/r/A" }),
      ev("node.running", "A"),
      ev("node.queued", "B"),
      ev("node.worktree.created", "B", { worktreePath: ".orchestrator/wt/r/B", branchName: "agent/r/B" }),
      ev("node.completed", "B"),
    ]);
    expect(worktreeMap(state)).toEqual([
      { nodeId: "A", path: ".orchestrator/wt/r/A", branch: "agent/r/A", status: "running" },
      { nodeId: "B", path: ".orchestrator/wt/r/B", branch: "agent/r/B", status: "success" },
    ]);
  });

  it("excludes nodes without a worktree (gates/skipped/not-started)", () => {
    const state = applyEvents(initialRunState, [
      ev("node.worktree.created", "A", { worktreePath: ".orchestrator/wt/r/A", branchName: "agent/r/A" }),
      ev("node.skipped", "G", { kind: "gate", blocked: true }), // gate: no worktree
      ev("node.queued", "C"), // queued but no worktree event yet
    ]);
    const map = worktreeMap(state);
    expect(map).toHaveLength(1);
    expect(map[0].nodeId).toBe("A");
  });

  it("is empty before any worktree is created", () => {
    expect(worktreeMap(initialRunState)).toEqual([]);
  });
});

describe("terminal backpressure — bounded ring buffer (VIS-1)", () => {
  it("caps retained lines at MAX_TERMINAL_LINES and counts the rest as dropped", () => {
    const overflow = 50;
    const total = MAX_TERMINAL_LINES + overflow;
    const events: RuntimeEvent[] = [ev("node.running", "A")];
    for (let i = 0; i < total; i += 1) {
      events.push(ev("node.stdout", "A", { line: `line-${i}` }));
    }
    const state = applyEvents(initialRunState, events);

    expect(state.nodes.A.lines).toHaveLength(MAX_TERMINAL_LINES);
    expect(state.nodes.A.droppedLines).toBe(overflow);
    // Oldest dropped, newest retained (faithful, just bounded).
    expect(state.nodes.A.lines[0].text).toBe(`line-${overflow}`);
    expect(state.nodes.A.lines[MAX_TERMINAL_LINES - 1].text).toBe(`line-${total - 1}`);
  });

  it("does not drop lines under the cap (droppedLines stays 0) and keeps stderr labelling", () => {
    const state = applyEvents(initialRunState, [
      ev("node.stdout", "A", { line: "out" }),
      ev("node.stderr", "A", { line: "err" }),
    ]);
    expect(state.nodes.A.droppedLines).toBe(0);
    expect(state.nodes.A.lines).toEqual([
      { stream: "stdout", text: "out" },
      { stream: "stderr", text: "err" },
    ]);
  });
});


describe("runReducer — reset", () => {
  it("run.reset returns the initial state", () => {
    const dirty = applyEvents(initialRunState, [
      { type: "run.started", runId: "r1" },
      { type: "node.running", runId: "r1", nodeId: "A" },
      { type: "node.stdout", runId: "r1", nodeId: "A", payload: { line: "x" } },
    ]);
    expect(dirty.order.length).toBe(1);
    const reset = runReducer(dirty, { type: "run.reset", runId: "r1" });
    expect(reset).toEqual(initialRunState);
  });
});

describe("runDocToEvents — historical replay", () => {
  // Persisted shape: payload carries the original `type`; nodeId is the Map key.
  const persisted = (type: string, extra: Record<string, unknown> = {}, ts = "") => ({
    ts,
    level: "info",
    payload: { type, ...extra },
  });

  it("reconstructs terminals + final status from a finished run (Record nodeRuns)", () => {
    const run = {
      status: "completed",
      nodeRuns: {
        A: {
          nodeId: "A",
          status: "success",
          events: [
            persisted("node.running", {}, "2024-01-01T00:00:01Z"),
            persisted("node.stdout", { line: "a-1" }, "2024-01-01T00:00:02Z"),
            persisted("node.completed", {}, "2024-01-01T00:00:03Z"),
          ],
        },
        B: {
          nodeId: "B",
          status: "failed",
          events: [
            persisted("node.running", {}, "2024-01-01T00:00:01Z"),
            persisted("node.stderr", { line: "boom" }, "2024-01-01T00:00:02Z"),
          ],
        },
      },
    };
    const events = runDocToEvents("r1", run);
    const state = applyEvents(initialRunState, events);

    expect(state.status).toBe("completed");
    expect(state.order).toEqual(["A", "B"]);
    expect(state.nodes.A.status).toBe("success");
    expect(state.nodes.A.lines).toEqual([{ stream: "stdout", text: "a-1" }]);
    // B had no node.failed event among stored events; synthetic final status fills it.
    expect(state.nodes.B.status).toBe("failed");
    expect(state.nodes.B.lines).toEqual([{ stream: "stderr", text: "boom" }]);
  });

  it("maps persisted backend success runs to completed in the viewer", () => {
    const state = applyEvents(
      initialRunState,
      runDocToEvents("r1", {
        status: "success",
        nodeRuns: {
          A: {
            nodeId: "A",
            status: "success",
            events: [persisted("node.completed", {}, "2024-01-01T00:00:03Z")],
          },
        },
      }),
    );

    expect(state.status).toBe("completed");
    expect(state.nodes.A.status).toBe("success");
  });

  it("supports a Map-typed nodeRuns and chronological ordering by ts", () => {
    const nodeRuns = new Map([
      [
        "A",
        {
          nodeId: "A",
          status: "success",
          events: [persisted("node.running", {}, "2024-01-01T00:00:05Z")],
        },
      ],
      [
        "B",
        {
          nodeId: "B",
          status: "success",
          events: [persisted("node.running", {}, "2024-01-01T00:00:01Z")],
        },
      ],
    ]);
    const events = runDocToEvents("r1", { status: "completed", nodeRuns });
    const state = applyEvents(initialRunState, events);
    // B's event has the earlier ts, so it is seen first.
    expect(state.order).toEqual(["B", "A"]);
  });

  it("maps a cancelled run to a failed view status and reconstructs worktrees", () => {
    const run = {
      status: "cancelled",
      nodeRuns: {
        A: {
          nodeId: "A",
          status: "cancelled",
          events: [
            persisted(
              "node.worktree.created",
              { worktreePath: "/wt/A", branchName: "agent/r1/A" },
              "2024-01-01T00:00:01Z",
            ),
          ],
        },
      },
    };
    const state = applyEvents(initialRunState, runDocToEvents("r1", run));
    expect(state.status).toBe("failed");
    expect(state.nodes.A.worktree).toEqual({ path: "/wt/A", branch: "agent/r1/A" });
    expect(worktreeMap(state)).toHaveLength(1);
  });

  it("tolerates empty / missing nodeRuns", () => {
    expect(runDocToEvents("r1", {})).toEqual([{ type: "run.started", runId: "r1" }]);
    const state = applyEvents(
      initialRunState,
      runDocToEvents("r1", { status: "running", nodeRuns: {} }),
    );
    expect(state.status).toBe("running");
    expect(state.order).toEqual([]);
  });
});
