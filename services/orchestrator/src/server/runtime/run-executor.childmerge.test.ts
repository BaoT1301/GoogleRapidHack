import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel, RunModel } from "../../db/models";
import { sseHub } from "../sse/hub";
import { executeRun } from "./run-executor";

const ex = promisify(execFile);
const ME = "test_user_childmerge";
let repoPath = "";

// WOW-2: a CHILD sub-graph shares the parent's baseBranch, so a successful child
// run promotes onto the shared base via the existing auto-merge-back, AND signals
// the parent node that its fixer landed (`merge.promoted_to_parent`).
beforeAll(async () => {
  await connectDB();
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
});

afterAll(async () => {
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
  await disconnectDB();
});

beforeEach(async () => {
  delete process.env.ORCH_AUTO_MERGE; // default ON
  repoPath = await mkdtemp(path.join(os.tmpdir(), "childmerge-"));
  await ex("git", ["init", "-b", "main"], { cwd: repoPath });
  await ex("git", ["config", "user.email", "t@t.co"], { cwd: repoPath });
  await ex("git", ["config", "user.name", "t"], { cwd: repoPath });
  await ex("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repoPath });
});

afterEach(async () => {
  await removeRuntimeWorktrees(repoPath);
  await rm(repoPath, { recursive: true, force: true });
});

describe("executeRun — child-success promotion to parent (WOW-2)", () => {
  it("promotes the child's patch onto the shared base and emits merge.promoted_to_parent", async () => {
    const child = await GraphModel.create({
      ownerId: ME,
      name: "Fixer child",
      rootRepoPath: repoPath,
      baseBranch: "main",
      parentGraphId: "parent_g",
      parentNodeId: "parent_node_42",
      nodes: [
        { id: "fix", kind: "execute", label: "fix", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } },
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

    const frames: string[] = [];
    const unsub = sseHub.subscribe(runId, { write: (d) => frames.push(d) });
    try {
      await executeRun(runId, ME);
    } finally {
      unsub();
    }

    const reloaded = await RunModel.findById(runId).lean();
    expect(reloaded?.status).toBe("success");

    // The child's patch promoted onto the shared base.
    const onBase = await ex("git", ["show", "main:ORCH_FAKE_AGENT_EDIT.md"], { cwd: repoPath });
    expect(onBase.stdout).toContain("fix");

    // Parent signal emitted with the originating parent node id + child ids.
    const sig = frames.find((f) => f.includes('"type":"merge.promoted_to_parent"'));
    expect(sig).toBeDefined();
    const parsed = JSON.parse(sig!.replace(/^data: /, "").trim()) as {
      nodeId?: string;
      payload: Record<string, unknown>;
    };
    expect(parsed.nodeId).toBeUndefined(); // run-level
    expect(parsed.payload).toMatchObject({
      parentNodeId: "parent_node_42",
      childGraphId: String(child._id),
      childRunId: runId,
      baseBranch: "main",
    });
    expect(typeof parsed.payload.mergeCommit).toBe("string");
    expect(parsed.payload.promotedNodeCount).toBe(1);
  });

  it("does NOT emit merge.promoted_to_parent for a top-level (non-child) run", async () => {
    const graph = await GraphModel.create({
      ownerId: ME,
      name: "Top-level",
      rootRepoPath: repoPath,
      baseBranch: "main",
      nodes: [
        { id: "n", kind: "execute", label: "n", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } },
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

    // Base still promoted (top-level fan-in), but no parent signal.
    expect(frames.some((f) => f.includes('"type":"merge.completed"'))).toBe(true);
    expect(frames.some((f) => f.includes('"type":"merge.promoted_to_parent"'))).toBe(false);
  });
});

async function removeRuntimeWorktrees(root: string): Promise<void> {
  try {
    const { stdout } = await ex("git", ["worktree", "list", "--porcelain"], { cwd: root });
    const worktrees = stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .filter((wt) => wt.includes(`${path.sep}.orchestrator${path.sep}`));
    for (const wt of worktrees) {
      await ex("git", ["worktree", "remove", "--force", wt], { cwd: root });
    }
    await ex("git", ["worktree", "prune"], { cwd: root });
  } catch {
    // best-effort
  }
}
