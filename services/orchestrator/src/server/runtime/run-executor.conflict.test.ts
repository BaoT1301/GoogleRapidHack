import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel, RunModel } from "../../db/models";
import { sseHub } from "../sse/hub";
import { executeRun } from "./run-executor";

const ex = promisify(execFile);
const ME = "test_user_conflict";
let repoPath = "";

// GIT-3: merge-conflict handling — mark blocked, persist conflict, auto-spawn an
// integration_reviewer child. Two+ fake nodes both edit ORCH_FAKE_AGENT_EDIT.md;
// a P→Q→R flow chain makes the ordering deterministic: P merges clean, Q
// conflicts (ADD/ADD), R is short-circuited.
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
  repoPath = await mkdtemp(path.join(os.tmpdir(), "conflict-"));
  await ex("git", ["init", "-b", "main"], { cwd: repoPath });
  await ex("git", ["config", "user.email", "t@t.co"], { cwd: repoPath });
  await ex("git", ["config", "user.name", "t"], { cwd: repoPath });
  await ex("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repoPath });
});

afterEach(async () => {
  await removeRuntimeWorktrees(repoPath);
  await rm(repoPath, { recursive: true, force: true });
});

describe("merge-conflict handling (GIT-3)", () => {
  it("marks the node blocked, persists the conflict, spawns a reviewer, and does not merge descendants", async () => {
    const { graphId, runId, frames, unsub } = await startChainGraph();
    try {
      await executeRun(runId, ME);
    } finally {
      unsub();
    }

    const reloaded = await RunModel.findById(runId).lean();
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<
      string,
      { status?: string; outputs?: { merge?: { conflictFiles?: string[]; mergeWorktreePath?: string; diffPreview?: string } }; worktreePath?: string }
    >;

    // Q (middle) conflicts → blocked; conflict persisted.
    expect(nodeRuns.Q.status).toBe("blocked");
    expect(nodeRuns.Q.outputs?.merge?.conflictFiles).toContain("ORCH_FAKE_AGENT_EDIT.md");
    expect(nodeRuns.Q.outputs?.merge?.mergeWorktreePath).toBeTruthy();

    // merge.conflicted streamed with a reviewerGraphId.
    const conflictFrame = frames.find(
      (f) => f.includes('"type":"merge.conflicted"') && f.includes('"nodeId":"Q"'),
    );
    expect(conflictFrame).toBeDefined();
    expect(conflictFrame).toContain('"reviewerGraphId"');

    // An integration_reviewer child sub-graph was spawned + linked to Q.
    const reviewer = await GraphModel.findOne({
      ownerId: ME,
      parentGraphId: graphId,
      parentNodeId: "Q",
    }).lean();
    expect(reviewer).toBeTruthy();
    const reviewerNodes = (reviewer as unknown as { nodes: { data?: Record<string, unknown> }[] }).nodes;
    expect(reviewerNodes[0]?.data?.persona).toBe("integration_reviewer");
    expect((reviewerNodes[0]?.data as { conflict?: unknown }).conflict).toBeTruthy();

    // Q's worktree is KEPT (reviewer needs it).
    await expect(pathExists(nodeRuns.Q.worktreePath as string)).resolves.toBe(true);

    // R is a flow-descendant of the blocked Q → it was NOT merged.
    expect(frames.some((f) => f.includes('"type":"merge.completed"') && f.includes('"nodeId":"R"'))).toBe(false);
    // P (the clean ancestor) DID merge.
    expect(frames.some((f) => f.includes('"type":"merge.completed"') && f.includes('"nodeId":"P"'))).toBe(true);
  });

  it("spawns exactly one reviewer per conflicted node (idempotent)", async () => {
    const { graphId, runId, unsub } = await startChainGraph();
    // Pre-seed a reviewer child for Q (simulating a prior conflict spawn).
    await GraphModel.create({
      ownerId: ME,
      name: "pre-existing reviewer",
      status: "draft",
      parentGraphId: graphId,
      parentNodeId: "Q",
      rootRepoPath: repoPath,
      baseBranch: "main",
      nodes: [
        { id: "pre", kind: "execute", label: "Resolve", position: { x: 0, y: 0 }, status: "pending", data: { persona: "integration_reviewer" } },
      ],
      edges: [],
    });

    try {
      await executeRun(runId, ME);
    } finally {
      unsub();
    }

    // No second reviewer was spawned for Q.
    const children = await GraphModel.find({
      ownerId: ME,
      parentGraphId: graphId,
      parentNodeId: "Q",
    }).lean();
    expect(children).toHaveLength(1);
  });
});

async function startChainGraph(): Promise<{
  graphId: string;
  runId: string;
  frames: string[];
  unsub: () => void;
}> {
  const graph = await GraphModel.create({
    ownerId: ME,
    name: "conflict chain",
    rootRepoPath: repoPath,
    baseBranch: "main",
    nodes: [
      { id: "P", kind: "execute", label: "P", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } },
      { id: "Q", kind: "execute", label: "Q", position: { x: 1, y: 0 }, status: "pending", data: { cli: "fake" } },
      { id: "R", kind: "execute", label: "R", position: { x: 2, y: 0 }, status: "pending", data: { cli: "fake" } },
    ],
    edges: [
      { id: "e1", source: "P", target: "Q", kind: "flow" },
      { id: "e2", source: "Q", target: "R", kind: "flow" },
    ],
  });
  const graphId = String(graph._id);
  const run = await RunModel.create({
    graphId,
    ownerId: ME,
    graphSnapshot: graph.toObject(),
    status: "running",
    startedAt: new Date().toISOString(),
    nodeRuns: new Map(),
  });
  const runId = String(run._id);
  const frames: string[] = [];
  const unsub = sseHub.subscribe(runId, { write: (d) => frames.push(d) });
  return { graphId, runId, frames, unsub };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

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
