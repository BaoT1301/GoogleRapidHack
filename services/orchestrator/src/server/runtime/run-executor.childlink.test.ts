import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel, RunModel } from "../../db/models";
import { sseHub } from "../sse/hub";
import { executeRun } from "./run-executor";

const ex = promisify(execFile);
const ME = "test_user_childlink";
let repoPath = "";

// WOW-1: a run whose graph is a child sub-graph (parentGraphId + parentNodeId
// set) emits an additive, run-level `node.child_run.started` linkage event so
// the parent UI can follow its fixer's run. Auto-merge is off here — the linkage
// event is independent of the merge lifecycle.
beforeAll(async () => {
  process.env.ORCH_AUTO_MERGE = "false";
  await connectDB();
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
  repoPath = await mkdtemp(path.join(os.tmpdir(), "childlink-"));
  await ex("git", ["init"], { cwd: repoPath });
  await ex("git", ["config", "user.email", "t@t.co"], { cwd: repoPath });
  await ex("git", ["config", "user.name", "t"], { cwd: repoPath });
  await ex("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repoPath });
});

afterAll(async () => {
  delete process.env.ORCH_AUTO_MERGE;
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
  await rm(repoPath, { recursive: true, force: true });
  await disconnectDB();
});

describe("executeRun — child-run linkage (WOW-1)", () => {
  it("emits a run-level node.child_run.started with the correct parent/child ids", async () => {
    const child = await GraphModel.create({
      ownerId: ME,
      name: "Fixer child",
      rootRepoPath: repoPath,
      baseBranch: "HEAD",
      parentGraphId: "parent_graph_123",
      parentNodeId: "parent_node_abc",
      nodes: [
        {
          id: "fix",
          kind: "execute",
          label: "Fixer",
          position: { x: 0, y: 0 },
          status: "pending",
          data: { cli: "fake", prompt: "fix it" },
        },
      ],
      edges: [],
    });
    const run = await RunModel.create({
      graphId: String(child._id),
      ownerId: ME,
      graphSnapshot: child.toObject(),
      status: "running",
      startedAt: new Date().toISOString(),
      nodeRuns: new Map(),
    });
    const runId = String(run._id);

    // Subscribe BEFORE executing (the linkage frame is emitted up-front).
    const frames: string[] = [];
    const unsub = sseHub.subscribe(runId, { write: (d) => frames.push(d) });
    try {
      await executeRun(runId, ME);
    } finally {
      unsub();
    }

    const linkFrame = frames.find((f) => f.includes('"type":"node.child_run.started"'));
    expect(linkFrame).toBeDefined();
    const parsed = JSON.parse(linkFrame!.replace(/^data: /, "").trim()) as {
      type: string;
      nodeId?: string;
      payload: Record<string, unknown>;
    };
    // Run-level (no envelope nodeId → zero terminal pollution).
    expect(parsed.nodeId).toBeUndefined();
    expect(parsed.payload).toMatchObject({
      childGraphId: String(child._id),
      childRunId: runId,
      parentGraphId: "parent_graph_123",
      parentNodeId: "parent_node_abc",
    });
  });

  it("does NOT emit the linkage event for a normal (non-child) graph run", async () => {
    const graph = await GraphModel.create({
      ownerId: ME,
      name: "Top-level graph",
      rootRepoPath: repoPath,
      baseBranch: "HEAD",
      nodes: [
        {
          id: "n",
          kind: "execute",
          label: "task",
          position: { x: 0, y: 0 },
          status: "pending",
          data: { cli: "fake" },
        },
      ],
      edges: [],
    });
    const run = await RunModel.create({
      graphId: String(graph._id),
      ownerId: ME,
      graphSnapshot: graph.toObject(),
      status: "running",
      startedAt: new Date().toISOString(),
      nodeRuns: new Map(),
    });
    const runId = String(run._id);

    const frames: string[] = [];
    const unsub = sseHub.subscribe(runId, { write: (d) => frames.push(d) });
    try {
      await executeRun(runId, ME);
    } finally {
      unsub();
    }

    expect(frames.some((f) => f.includes('"type":"node.child_run.started"'))).toBe(false);
  });
});
