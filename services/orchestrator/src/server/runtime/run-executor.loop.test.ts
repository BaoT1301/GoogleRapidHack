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
const ME = "test_user_runexec_loop";
let repoPath = "";

beforeAll(async () => {
  process.env.ORCH_AUTO_MERGE = "false";
  process.env.FAKE_AGENT_DELAY_MS = "10"; // keep child runs snappy
  await connectDB();
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
  repoPath = await mkdtemp(path.join(os.tmpdir(), "runexec-loop-"));
  await ex("git", ["init"], { cwd: repoPath });
  await ex("git", ["config", "user.email", "t@t.co"], { cwd: repoPath });
  await ex("git", ["config", "user.name", "t"], { cwd: repoPath });
  await ex("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repoPath });
});

afterAll(async () => {
  delete process.env.ORCH_AUTO_MERGE;
  delete process.env.FAKE_AGENT_DELAY_MS;
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
  await rm(repoPath, { recursive: true, force: true });
  await disconnectDB();
});

async function makeChildGraph(): Promise<string> {
  const child = await GraphModel.create({
    ownerId: ME,
    name: "loop child",
    rootRepoPath: repoPath,
    baseBranch: "HEAD",
    nodes: [
      { id: "c_exec", kind: "execute", label: "child task", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } },
    ],
    edges: [],
  });
  return String(child._id);
}

async function runLoopGraph(
  childGraphId: string,
  maxIterations: number,
  extraData: Record<string, unknown> = {},
  extraNodes: unknown[] = [],
  extraEdges: unknown[] = [],
): Promise<{ runId: string; frames: string[] }> {
  const graph = await GraphModel.create({
    ownerId: ME,
    name: "loop parent",
    rootRepoPath: repoPath,
    baseBranch: "HEAD",
    nodes: [
      { id: "lp", kind: "loop", label: "retry loop", position: { x: 0, y: 0 }, status: "pending", data: { childGraphId, maxIterations, ...extraData } },
      ...extraNodes,
    ],
    edges: extraEdges,
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
  return { runId, frames };
}

function iterationFrames(frames: string[]): string[] {
  return frames.filter((f) => f.includes('"type":"node.loop.iteration"'));
}

describe("executeRun — RUN-6 loop runner", () => {
  it("re-runs the child until it passes (fail once, then succeed) and the loop node succeeds", async () => {
    const childGraphId = await makeChildGraph();
    const attemptFile = path.join(await mkdtemp(path.join(os.tmpdir(), "attempt-")), "n.txt");
    process.env.FAKE_AGENT_ATTEMPT_FILE = attemptFile;
    process.env.FAKE_AGENT_FAIL_TIMES = "1"; // fail iteration 1, pass iteration 2
    let runId = "";
    let frames: string[] = [];
    try {
      ({ runId, frames } = await runLoopGraph(childGraphId, 3));
    } finally {
      delete process.env.FAKE_AGENT_ATTEMPT_FILE;
      delete process.env.FAKE_AGENT_FAIL_TIMES;
    }

    const reloaded = await RunModel.findById(runId).lean();
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<string, { status?: string; outputs?: Record<string, unknown> }>;
    expect(nodeRuns.lp.status).toBe("success");
    expect(reloaded?.status).toBe("success");
    expect(nodeRuns.lp.outputs?.loop).toMatchObject({
      kind: "loop",
      status: "completed",
      childGraphId,
      iterations: 2,
      maxIterations: 3,
      breakConditionEvaluated: false,
      breakReason: "child_run_success",
    });

    // Two iterations emitted: #1 failed, #2 success.
    const its = iterationFrames(frames);
    expect(its.length).toBe(2);
    expect(its[0]).toContain('"iteration":1');
    expect(its[0]).toContain('"status":"failed"');
    expect(its[1]).toContain('"iteration":2');
    expect(its[1]).toContain('"status":"success"');
    expect(frames.some((f) => f.includes('"type":"node.loop.started"'))).toBe(true);
    expect(frames.some((f) => f.includes('"type":"node.loop.iteration.started"'))).toBe(true);
    expect(frames.some((f) => f.includes('"type":"node.loop.iteration.completed"'))).toBe(true);
    expect(frames.some((f) => f.includes('"type":"node.loop.break"'))).toBe(true);
  });

  it("stops and FAILS the loop node at maxIterations when the child keeps failing", async () => {
    const childGraphId = await makeChildGraph();
    process.env.FAKE_AGENT_SHOULD_FAIL = "true";
    let runId = "";
    let frames: string[] = [];
    try {
      ({ runId, frames } = await runLoopGraph(childGraphId, 2));
    } finally {
      delete process.env.FAKE_AGENT_SHOULD_FAIL;
    }

    const reloaded = await RunModel.findById(runId).lean();
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<string, { status?: string; outputs?: Record<string, unknown> }>;
    expect(nodeRuns.lp.status).toBe("failed");
    expect(reloaded?.status).toBe("failed");
    expect(nodeRuns.lp.outputs?.loop).toMatchObject({
      kind: "loop",
      status: "exhausted",
      childGraphId,
      iterations: 2,
      maxIterations: 2,
      breakConditionEvaluated: false,
      breakReason: "max_iterations_exhausted",
    });

    // Exactly maxIterations (2) iterations attempted, all failed.
    const its = iterationFrames(frames);
    expect(its.length).toBe(2);
    expect(its.every((f) => f.includes('"status":"failed"'))).toBe(true);
    expect(frames.some((f) => f.includes('"type":"node.loop.exhausted"'))).toBe(true);
  });

  it("fails the loop node when no child sub-graph can be resolved", async () => {
    const graph = await GraphModel.create({
      ownerId: ME,
      name: "loop no child",
      rootRepoPath: repoPath,
      baseBranch: "HEAD",
      nodes: [{ id: "lp", kind: "loop", label: "loop", position: { x: 0, y: 0 }, status: "pending", data: {} }],
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
    await executeRun(String(run._id), ME);
    const reloaded = await RunModel.findById(run._id).lean();
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<string, { status?: string; outputs?: Record<string, unknown> }>;
    expect(nodeRuns.lp.status).toBe("failed");
    expect(nodeRuns.lp.outputs?.loop).toMatchObject({
      kind: "loop",
      status: "failed",
      breakReason: expect.stringMatching(/no child sub-graph/i),
      breakConditionEvaluated: false,
    });
  });

  it("persists breakCondition as a non-evaluated hint and allows downstream only after loop success", async () => {
    const childGraphId = await makeChildGraph();
    const { runId } = await runLoopGraph(
      childGraphId,
      20,
      { breakCondition: "stop when tests pass" },
      [
        { id: "after", kind: "execute", label: "after loop", position: { x: 1, y: 0 }, status: "pending", data: { cli: "fake" } },
      ],
      [{ id: "lp_after", source: "lp", target: "after", kind: "flow" }],
    );

    const reloaded = await RunModel.findById(runId).lean();
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<string, { status?: string; outputs?: Record<string, unknown> }>;
    expect(nodeRuns.lp.status).toBe("success");
    expect(nodeRuns.after.status).toBe("success");
    expect(nodeRuns.lp.outputs?.loop).toMatchObject({
      breakCondition: "stop when tests pass",
      breakConditionEvaluated: false,
      maxIterations: 10,
    });
  });
});
