import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel } from "../../db/models/graph.model";
import { RunModel } from "../../db/models/run.model";
import { sseHub } from "../sse/hub";

vi.mock("../runtime/run-executor", () => ({
  executeRun: vi.fn(async () => undefined),
  sharedProcessManager: {
    cancelRun: vi.fn(async () => 0),
  },
}));

const createCaller = createCallerFactory(appRouter);
const ME = "test_user_p5";
const OTHER = "test_user_p5_other";
const me = createCaller({ userId: ME });
const other = createCaller({ userId: OTHER });

let graphId: string;

beforeAll(async () => {
  await connectDB();
  await GraphModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await RunModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  const g = await me.graphs.create({ name: "Run Graph" });
  graphId = String(g._id);
});

afterAll(async () => {
  await GraphModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await RunModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await disconnectDB();
});

describe("runs router", () => {
  it("create snapshots the graph; getById + listForGraph are scoped", async () => {
    const run = await me.runs.create({ graphId });
    expect(run.ownerId).toBe(ME);
    expect(run.status).toBe("running");
    expect((run.graphSnapshot as { name: string }).name).toBe("Run Graph");

    const fetched = await me.runs.getById({ runId: String(run._id) });
    expect(String(fetched._id)).toBe(String(run._id));

    const list = await me.runs.listForGraph({ graphId });
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("cannot create a run for someone else's graph", async () => {
    await expect(other.runs.create({ graphId })).rejects.toThrow("NOT_FOUND");
  });

  it("updateNodeRun + appendEventsBatch persist events AND stream to SSE", async () => {
    const run = await me.runs.create({ graphId });
    const runId = String(run._id);

    await me.runs.updateNodeRun({
      runId,
      nodeId: "n1",
      nodeRun: { nodeId: "n1", status: "running", attempt: 1, events: [] },
    });

    // Subscribe a fake SSE client to the run channel (same-process singleton hub).
    const streamed: string[] = [];
    const unsub = sseHub.subscribe(runId, { write: (d) => streamed.push(d) });

    const appended = await me.runs.appendEventsBatch({
      runId,
      nodeId: "n1",
      events: [
        { ts: "t1", level: "stdout", payload: "line 1" },
        { ts: "t2", level: "stdout", payload: "line 2" },
      ],
    });
    unsub();

    expect(appended.appended).toBe(2);
    expect(streamed).toHaveLength(2); // live-streamed to the run channel

    // Persisted to Mongo.
    const reloaded = await me.runs.getById({ runId });
    const nodeRuns = reloaded.nodeRuns as unknown as Record<
      string,
      { events: unknown[] }
    >;
    expect(nodeRuns.n1.events).toHaveLength(2);
  });

  it("appendEventsBatch auto-creates the nodeRun if it does not exist yet", async () => {
    const run = await me.runs.create({ graphId });
    const runId = String(run._id);
    // No updateNodeRun first — append straight to a brand-new nodeId.
    const r = await me.runs.appendEventsBatch({
      runId,
      nodeId: "fresh",
      events: [{ ts: "t1", level: "stdout", payload: "hello" }],
    });
    expect(r.appended).toBe(1);

    const reloaded = await me.runs.getById({ runId });
    const nodeRuns = reloaded.nodeRuns as unknown as Record<
      string,
      { events: unknown[] }
    >;
    expect(nodeRuns.fresh?.events).toHaveLength(1);
  });

  it("updateStatus sets status + finishedAt (scoped)", async () => {
    const run = await me.runs.create({ graphId });
    const updated = await me.runs.updateStatus({
      runId: String(run._id),
      status: "completed",
      finishedAt: "t-final",
    });
    expect(updated.status).toBe("completed");
    expect(updated.finishedAt).toBe("t-final");
  });

  it("createAndStartChild creates a child run with parent metadata and starts runtime", async () => {
    const { executeRun } = await import("../runtime/run-executor");
    vi.mocked(executeRun).mockClear();

    const parent = await me.graphs.create({
      name: "Parent Graph",
      rootRepoPath: "/repo",
      baseBranch: "main",
    });
    const parentRun = await me.runs.create({ graphId: String(parent._id) });
    const child = await me.graphs.spawnChild({
      parentGraphId: String(parent._id),
      parentNodeId: "node_parent",
      name: "Child fixer",
      nodes: [
        {
          id: "child_exec",
          kind: "execute",
          label: "Child Execute",
          position: { x: 0, y: 0 },
          status: "pending",
          data: { cli: "fake", prompt: "fix child" },
        },
      ],
    });

    const started = await me.runs.createAndStartChild({
      childGraphId: String(child._id),
      parentRunId: String(parentRun._id),
      parentNodeIds: ["node_parent", "node_lasso_extra"],
    });

    expect(started.started).toBe(true);
    expect(started.eventsUrl).toBe(`/api/runs/${started.runId}/events`);
    expect(started.childRunId).toBe(started.runId);
    expect(started.childGraphId).toBe(String(child._id));
    expect(started.parentGraphId).toBe(String(parent._id));
    expect(started.parentRunId).toBe(String(parentRun._id));
    expect(started.parentNodeIds).toEqual(["node_parent", "node_lasso_extra"]);
    expect(executeRun).toHaveBeenCalledWith(started.runId, ME, { token: undefined });

    const stored = await me.runs.getById({ runId: started.runId });
    expect(stored.parentGraphId).toBe(String(parent._id));
    expect(stored.parentRunId).toBe(String(parentRun._id));
    expect(stored.parentNodeIds).toEqual(["node_parent", "node_lasso_extra"]);
    expect(stored.childGraphId).toBe(String(child._id));
    expect(stored.childRunId).toBe(started.runId);
    expect((stored.graphSnapshot as { parentGraphId?: string }).parentGraphId).toBe(String(parent._id));
  });

  it("createAndStartChild rejects normal graphs and unowned parent runs", async () => {
    await expect(me.runs.createAndStartChild({ childGraphId: graphId })).rejects.toThrow(
      "Graph is not a spawned child graph",
    );

    const parent = await me.graphs.create({ name: "Parent for rejected child" });
    const child = await me.graphs.spawnChild({
      parentGraphId: String(parent._id),
      parentNodeId: "node_parent",
      name: "Rejected child",
    });

    await expect(
      me.runs.createAndStartChild({
        childGraphId: String(child._id),
        parentRunId: "000000000000000000000000",
      }),
    ).rejects.toThrow("Parent run not found");
  });
});
