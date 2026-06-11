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
const ME = "test_user_runexec";
let repoPath = "";

beforeAll(async () => {
  // These tests focus on execution + gate semantics; auto-merge-back (GIT-2) is
  // covered in run-executor.merge.test.ts. Opt out here so merge side effects
  // (worktree removal / base promotion) don't perturb execution assertions.
  process.env.ORCH_AUTO_MERGE = "false";
  await connectDB();
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
  // a real temp git repo for the worktree to fork from
  repoPath = await mkdtemp(path.join(os.tmpdir(), "runexec-"));
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

describe("executeRun (full runtime path)", () => {
  it("runs a fake Execute node and persists success to Mongo", async () => {
    // graph with one fake execute node
    const graph = await GraphModel.create({
      ownerId: ME,
      name: "Runtime e2e",
      rootRepoPath: repoPath,
      baseBranch: "HEAD",
      nodes: [
        {
          id: "n_exec",
          kind: "execute",
          label: "fake task",
          position: { x: 0, y: 0 },
          status: "pending",
          data: { cli: "fake", prompt: "do the thing" },
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

    await executeRun(String(run._id), ME);

    const reloaded = await RunModel.findById(run._id).lean();
    expect(reloaded?.status).toBe("success");
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<
      string,
      { status?: string; events?: unknown[] }
    >;
    // the node ran, produced events, and ended success
    expect(nodeRuns.n_exec).toBeDefined();
    expect(nodeRuns.n_exec.status).toBe("success");
    expect((nodeRuns.n_exec.events?.length ?? 0)).toBeGreaterThan(0);
  });

  it("gates flow descendants: B is skipped (and never runs) when A fails", async () => {
    const graph = await GraphModel.create({
      ownerId: ME,
      name: "DAG gating",
      rootRepoPath: repoPath,
      baseBranch: "HEAD",
      nodes: [
        { id: "A", kind: "execute", label: "upstream", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } },
        { id: "B", kind: "execute", label: "downstream", position: { x: 1, y: 0 }, status: "pending", data: { cli: "fake" } },
      ],
      edges: [{ id: "e1", source: "A", target: "B", kind: "flow" }],
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

    // Capture the live SSE stream to prove node.skipped is emitted for B.
    const frames: string[] = [];
    const unsub = sseHub.subscribe(runId, { write: (d) => frames.push(d) });

    process.env.FAKE_AGENT_SHOULD_FAIL = "true"; // make A fail deterministically
    try {
      await executeRun(runId, ME);
    } finally {
      delete process.env.FAKE_AGENT_SHOULD_FAIL;
      unsub();
    }

    const reloaded = await RunModel.findById(runId).lean();
    expect(reloaded?.status).toBe("failed");
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<
      string,
      { status?: string; events?: unknown[] }
    >;
    expect(nodeRuns.A.status).toBe("failed");
    expect(nodeRuns.B.status).toBe("skipped");
    // B was gated → it never EXECUTED, but the runtime persists a single
    // `node.skipped` marker so the audit trail explains why B was skipped.
    expect(nodeRuns.B.events?.length ?? 0).toBe(1);
    expect(
      (nodeRuns.B.events?.[0] as { payload?: { type?: string } } | undefined)
        ?.payload?.type,
    ).toBe("node.skipped");

    const skippedFrame = frames.find(
      (f) => f.includes('"type":"node.skipped"') && f.includes('"nodeId":"B"'),
    );
    expect(skippedFrame).toBeDefined();
  });

  it("runs independent nodes (no flow edge gates them)", async () => {
    const graph = await GraphModel.create({
      ownerId: ME,
      name: "DAG independent",
      rootRepoPath: repoPath,
      baseBranch: "HEAD",
      nodes: [
        { id: "X", kind: "execute", label: "x", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } },
        { id: "Y", kind: "execute", label: "y", position: { x: 1, y: 0 }, status: "pending", data: { cli: "fake" } },
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

    await executeRun(String(run._id), ME);

    const reloaded = await RunModel.findById(run._id).lean();
    expect(reloaded?.status).toBe("success");
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<string, { status?: string }>;
    expect(nodeRuns.X.status).toBe("success");
    expect(nodeRuns.Y.status).toBe("success");
  });

  it("walks all node kinds: a gate with no upstreams blocks while a context node is skipped (no runner)", async () => {
    const graph = await GraphModel.create({
      ownerId: ME,
      name: "Mixed graph",
      rootRepoPath: repoPath,
      baseBranch: "HEAD",
      nodes: [
        { id: "ex", kind: "execute", label: "do it", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } },
        { id: "g", kind: "gate", label: "quality gate", position: { x: 1, y: 0 }, status: "pending", data: {} },
        { id: "ctx", kind: "context", label: "context", position: { x: 2, y: 0 }, status: "pending", data: {} },
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

    const reloaded = await RunModel.findById(runId).lean();
    // RUN-3: a gate with no gated upstreams is blocked because it is not
    // converging anything; a `context` node still has no runner → skipped.
    // Neither fails the run.
    expect(reloaded?.status).toBe("success");
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<string, { status?: string; outputs?: Record<string, unknown> }>;
    expect(nodeRuns.ex.status).toBe("success");
    expect(nodeRuns.g.status).toBe("blocked");
    expect(nodeRuns.ctx.status).toBe("skipped");
    expect(nodeRuns.g.outputs?.gate).toMatchObject({
      kind: "gate",
      status: "blocked",
      upstreamTotal: 0,
      reason: "gate blocked: no incoming flow predecessors",
    });

    const gateBlocked = frames.find(
      (f) => f.includes('"type":"node.gate.blocked"') && f.includes('"nodeId":"g"'),
    );
    expect(gateBlocked).toBeDefined();
    expect(gateBlocked).toContain("no incoming flow predecessors");

    const contextSkip = frames.find(
      (f) => f.includes('"type":"node.skipped"') && f.includes('"nodeId":"ctx"'),
    );
    expect(contextSkip).toBeDefined();
    expect(contextSkip).toContain("no runner");
  });

  it("gate runner: all-of gate blocks and skips descendants when one upstream fails; any-of passes when one succeeds", async () => {
    // A: ok, B: fail → all-of gate G(A,B) blocked; any-of gate H(A,B) passes.
    const graph = await GraphModel.create({
      ownerId: ME,
      name: "Gate fan-in",
      rootRepoPath: repoPath,
      baseBranch: "HEAD",
      nodes: [
        { id: "A", kind: "execute", label: "A ok", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } },
        { id: "B", kind: "execute", label: "B fail", position: { x: 0, y: 1 }, status: "pending", data: { cli: "fake" } },
        { id: "G", kind: "gate", label: "all-of gate", position: { x: 1, y: 0 }, status: "pending", data: {} },
        { id: "H", kind: "gate", label: "any-of gate", position: { x: 1, y: 1 }, status: "pending", data: {} },
        { id: "C", kind: "execute", label: "after blocked gate", position: { x: 2, y: 0 }, status: "pending", data: { cli: "fake" } },
      ],
      edges: [
        { id: "e1", source: "A", target: "G", kind: "flow" },
        { id: "e2", source: "B", target: "G", kind: "flow" },
        { id: "e3", source: "A", target: "H", kind: "flow", fanInMode: "any-of" },
        { id: "e4", source: "B", target: "H", kind: "flow", fanInMode: "any-of" },
        { id: "e5", source: "G", target: "C", kind: "flow" },
      ],
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
    process.env.FAKE_AGENT_FAIL_NODES = "B";
    try {
      await executeRun(runId, ME);
    } finally {
      delete process.env.FAKE_AGENT_FAIL_NODES;
      unsub();
    }

    const reloaded = await RunModel.findById(runId).lean();
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<string, { status?: string; outputs?: Record<string, unknown> }>;
    expect(nodeRuns.A.status).toBe("success");
    expect(nodeRuns.B.status).toBe("failed");
    // all-of gate G: one upstream failed → blocked.
    expect(nodeRuns.G.status).toBe("blocked");
    // any-of gate H: A succeeded → passes.
    expect(nodeRuns.H.status).toBe("success");
    // Downstream of the blocked all-of gate is skipped.
    expect(nodeRuns.C.status).toBe("skipped");
    expect(nodeRuns.G.outputs?.gate).toMatchObject({
      kind: "gate",
      status: "blocked",
      fanInMode: "all-of",
      upstreamTotal: 2,
      upstreamSucceeded: 1,
      upstreamFailed: 1,
    });
    expect(nodeRuns.H.outputs?.gate).toMatchObject({
      kind: "gate",
      status: "passed",
      fanInMode: "any-of",
      upstreamTotal: 2,
      upstreamSucceeded: 1,
    });

    const blockedFrame = frames.find(
      (f) => f.includes('"type":"node.gate.blocked"') && f.includes('"nodeId":"G"'),
    );
    expect(blockedFrame).toBeDefined();
    const passedFrame = frames.find(
      (f) =>
        f.includes('"type":"node.gate.passed"') &&
        f.includes('"nodeId":"H"') &&
        f.includes('"status":"passed"'),
    );
    expect(passedFrame).toBeDefined();
  });
});
