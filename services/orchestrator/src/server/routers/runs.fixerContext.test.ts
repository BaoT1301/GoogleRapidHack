import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel } from "../../db/models/graph.model";
import { RunModel } from "../../db/models/run.model";

// WOW-3: read-only runs.fixerContext + additive data.context seeding on the
// spawned fixer node.
const createCaller = createCallerFactory(appRouter);
const ME = "test_user_fixerctx";
const OTHER = "test_user_fixerctx_other";
const me = createCaller({ userId: ME });
const other = createCaller({ userId: OTHER });

beforeAll(async () => {
  await connectDB();
  await GraphModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await RunModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
});

afterAll(async () => {
  await GraphModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await RunModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await disconnectDB();
});

describe("runs.fixerContext (WOW-3)", () => {
  it("returns the latest diff preview + last error for the selected nodes (owner-scoped)", async () => {
    const graph = await me.graphs.create({ name: "ctx graph" });
    const run = await RunModel.create({
      graphId: String(graph._id),
      ownerId: ME,
      graphSnapshot: {
        nodes: [
          { id: "A", label: "Build" },
          { id: "B", label: "Test" },
          { id: "C", label: "Untouched" },
        ],
      },
      status: "failed",
      startedAt: new Date().toISOString(),
      nodeRuns: {
        A: {
          nodeId: "A",
          status: "success",
          attempt: 1,
          events: [
            { ts: "t1", level: "tool", payload: { type: "node.patch", patchLength: 14, patchPreview: "diff --git a/A" } },
          ],
        },
        B: {
          nodeId: "B",
          status: "failed",
          attempt: 1,
          events: [
            { ts: "t1", level: "error", payload: { type: "node.failed", exitCode: 1, reason: "2 tests failed" } },
          ],
        },
      },
    });
    const runId = String(run._id);

    const ctx = await me.runs.fixerContext({ runId, nodeIds: ["A", "B", "C"] });
    expect(ctx).toHaveLength(3);
    expect(ctx[0]).toMatchObject({ nodeId: "A", label: "Build", diffPreview: "diff --git a/A" });
    expect(ctx[0].lastError).toBeUndefined();
    expect(ctx[1]).toMatchObject({ nodeId: "B", label: "Test", lastError: "2 tests failed" });
    expect(ctx[1].diffPreview).toBeUndefined();
    // C has no nodeRun → graceful: label from snapshot, no diff/error.
    expect(ctx[2]).toEqual({ nodeId: "C", label: "Untouched", diffPreview: undefined, lastError: undefined });
  });

  it("is owner-scoped: another owner cannot read my run's fixer context (404)", async () => {
    const graph = await me.graphs.create({ name: "private ctx" });
    const run = await RunModel.create({
      graphId: String(graph._id),
      ownerId: ME,
      graphSnapshot: { nodes: [{ id: "A", label: "A" }] },
      status: "running",
      nodeRuns: {},
    });
    await expect(
      other.runs.fixerContext({ runId: String(run._id), nodeIds: ["A"] }),
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("graphs.spawnChild — captured context seeding (WOW-3)", () => {
  it("seeds data.context onto the default fixer node", async () => {
    const parent = await me.graphs.create({ name: "ctx parent", rootRepoPath: "/repo" });
    const child = await me.graphs.spawnChild({
      parentGraphId: String(parent._id),
      parentNodeId: "pn",
      name: "Seeded fixer",
      context: { fromNodes: ["pn"], diffPreview: "diff --git x", lastError: "boom" },
    });
    expect(child.nodes).toHaveLength(1);
    expect(child.nodes[0].data).toMatchObject({
      context: { fromNodes: ["pn"], diffPreview: "diff --git x", lastError: "boom" },
    });
  });

  it("seeds context without clobbering caller-supplied node data fields", async () => {
    const parent = await me.graphs.create({ name: "ctx parent 2", rootRepoPath: "/repo" });
    const child = await me.graphs.spawnChild({
      parentGraphId: String(parent._id),
      parentNodeId: "pn",
      name: "Seeded + caller data",
      nodes: [
        {
          id: "seed",
          kind: "execute",
          label: "Fixer",
          position: { x: 0, y: 0 },
          status: "pending",
          data: { persona: "frontend_architect", prompt: "do it" },
        },
      ],
      context: { fromNodes: ["pn"], diffPreview: "diff" },
    });
    // Caller fields preserved AND context added.
    expect(child.nodes[0].data).toMatchObject({
      persona: "frontend_architect",
      prompt: "do it",
      context: { fromNodes: ["pn"], diffPreview: "diff" },
    });
  });

  it("without context behaves exactly as before (no context field)", async () => {
    const parent = await me.graphs.create({ name: "ctx parent 3", rootRepoPath: "/repo" });
    const child = await me.graphs.spawnChild({
      parentGraphId: String(parent._id),
      parentNodeId: "pn",
      name: "No context",
    });
    expect((child.nodes[0].data ?? {}).context).toBeUndefined();
  });
});
