import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel, RunModel } from "../../db/models";
import { sseHub } from "../sse/hub";
import { executeRun, sharedProcessManager } from "./run-executor";

const ex = promisify(execFile);
const ME = "test_user_mergewire";
let repoPath = "";

// GIT-2: auto-merge-back wired into the run lifecycle. Uses a real temp git repo
// with a `main` base branch and the fake agent.
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
  delete process.env.ORCH_AUTO_MERGE; // default ON unless a test opts out
  delete process.env.FAKE_AGENT_STEPS;
  delete process.env.FAKE_AGENT_DELAY_MS;
  repoPath = await mkdtemp(path.join(os.tmpdir(), "mergewire-"));
  await ex("git", ["init", "-b", "main"], { cwd: repoPath });
  await ex("git", ["config", "user.email", "t@t.co"], { cwd: repoPath });
  await ex("git", ["config", "user.name", "t"], { cwd: repoPath });
  await ex("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repoPath });
});

afterEach(async () => {
  await removeRuntimeWorktrees(repoPath);
  await rm(repoPath, { recursive: true, force: true });
});

describe("executeRun auto-merge-back (GIT-2)", () => {
  it("auto-merges a successful node (default ON), promotes base, and removes the worktree", async () => {
    const { runId, frames, unsub } = await startGraph([
      { id: "solo", kind: "execute", label: "solo", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } },
    ], []);
    try {
      await executeRun(runId, ME);
    } finally {
      unsub();
    }

    const reloaded = await RunModel.findById(runId).lean();
    expect(reloaded?.status).toBe("success");

    // Base advanced to include the node's edit.
    const onBase = await ex("git", ["show", "main:ORCH_FAKE_AGENT_EDIT.md"], { cwd: repoPath });
    expect(onBase.stdout).toContain("solo");

    // merge.started + merge.completed streamed.
    expect(frames.some((f) => f.includes('"type":"merge.started"'))).toBe(true);
    const completed = frames.find(
      (f) => f.includes('"type":"merge.completed"') && f.includes('"nodeId":"solo"'),
    );
    expect(completed).toBeDefined();
    expect(completed).toContain('"promoted":true');

    // Agent + merge worktrees and branches are removed on successful promotion.
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<string, { worktreePath?: string }>;
    const worktreePath = nodeRuns.solo.worktreePath as string;
    expect(worktreePath).toBeTruthy();
    await expect(pathExists(worktreePath)).resolves.toBe(false);
    const branches = await localBranches(repoPath);
    expect(branches).not.toContain(`agent/${runId}/solo`);
    expect(branches.some((branch) => branch.startsWith(`merge/${runId}/solo/`))).toBe(false);
    const cleanupFrame = frames.find((f) => f.includes('"type":"cleanup.completed"'));
    expect(cleanupFrame).toBeDefined();
    expect(cleanupFrame).toContain('"checkedWith":"git branch"');
    expect(cleanupFrame).toContain('"branchCleanupComplete":true');
  });

  it("ORCH_AUTO_MERGE=false → no merge, base untouched, worktree kept", async () => {
    process.env.ORCH_AUTO_MERGE = "false";
    const { runId, frames, unsub } = await startGraph([
      { id: "solo", kind: "execute", label: "solo", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } },
    ], []);
    try {
      await executeRun(runId, ME);
    } finally {
      delete process.env.ORCH_AUTO_MERGE;
      unsub();
    }

    const reloaded = await RunModel.findById(runId).lean();
    expect(reloaded?.status).toBe("success");
    // No merge events at all.
    expect(frames.some((f) => f.includes('"type":"merge.'))).toBe(false);
    // Base NOT advanced (the file never landed on main).
    await expect(
      ex("git", ["show", "main:ORCH_FAKE_AGENT_EDIT.md"], { cwd: repoPath }),
    ).rejects.toBeTruthy();
    // Worktree kept (today's behaviour preserved).
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<string, { worktreePath?: string }>;
    await expect(pathExists(nodeRuns.solo.worktreePath as string)).resolves.toBe(true);
  });

  it("a cancelled run finalizes `cancelled`, not `failed`", async () => {
    process.env.FAKE_AGENT_STEPS = "40";
    process.env.FAKE_AGENT_DELAY_MS = "60";
    const { runId, unsub } = await startGraph([
      { id: "long", kind: "execute", label: "long", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } },
    ], []);

    const done = executeRun(runId, ME);
    // Let the node start, then stop the run (kills live processes).
    await new Promise((r) => setTimeout(r, 600));
    await sharedProcessManager.cancelRun(runId);
    try {
      await done;
    } finally {
      delete process.env.FAKE_AGENT_STEPS;
      delete process.env.FAKE_AGENT_DELAY_MS;
      unsub();
    }

    const reloaded = await RunModel.findById(runId).lean();
    expect(reloaded?.status).toBe("cancelled");
    expect(reloaded?.status).not.toBe("failed");
  });

  it("keeps the worktree and marks the node blocked when its merge conflicts", async () => {
    // Two parallel fake nodes both edit ORCH_FAKE_AGENT_EDIT.md → the 2nd merge
    // ADD/ADD conflicts on base after the 1st promotes.
    const { runId, frames, unsub } = await startGraph(
      [
        { id: "P", kind: "execute", label: "P", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } },
        { id: "Q", kind: "execute", label: "Q", position: { x: 1, y: 0 }, status: "pending", data: { cli: "fake" } },
      ],
      [],
    );
    try {
      await executeRun(runId, ME);
    } finally {
      unsub();
    }

    const reloaded = await RunModel.findById(runId).lean();
    // Execution succeeded for both → the run is success (a merge conflict does not
    // fail the run); exactly one node is merge-blocked.
    expect(reloaded?.status).toBe("success");
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<
      string,
      { status?: string; worktreePath?: string }
    >;
    const statuses = [nodeRuns.P.status, nodeRuns.Q.status].sort();
    expect(statuses).toEqual(["blocked", "success"]);

    // A merge.conflicted frame was streamed.
    expect(frames.some((f) => f.includes('"type":"merge.conflicted"'))).toBe(true);

    // The conflicted node's worktree is KEPT (not removed).
    const blockedNodeId = nodeRuns.P.status === "blocked" ? "P" : "Q";
    await expect(pathExists(nodeRuns[blockedNodeId].worktreePath as string)).resolves.toBe(true);
  });
});

async function startGraph(
  nodes: unknown[],
  edges: unknown[],
): Promise<{ runId: string; frames: string[]; unsub: () => void }> {
  const graph = await GraphModel.create({
    ownerId: ME,
    name: "merge wire",
    rootRepoPath: repoPath,
    baseBranch: "main",
    nodes,
    edges,
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
  return { runId, frames, unsub };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function localBranches(root: string): Promise<string[]> {
  const { stdout } = await ex("git", ["branch", "--format", "%(refname:short)"], { cwd: root });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
