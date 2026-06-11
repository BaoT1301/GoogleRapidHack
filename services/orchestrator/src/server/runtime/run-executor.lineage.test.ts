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
const ME = "test_user_lineage";
let repoPath = "";

// Lineage merge mode: each node forks from its parent branch(es); convergence
// nodes merge their parents; only terminal/leaf nodes merge into base; intermediate
// branches are pruned. Forced via ORCH_MERGE_STRATEGY=lineage.
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
  process.env.ORCH_MERGE_STRATEGY = "lineage";
  delete process.env.FAKE_AGENT_PER_NODE_FILE;
  repoPath = await mkdtemp(path.join(os.tmpdir(), "lineage-"));
  await ex("git", ["init", "-b", "main"], { cwd: repoPath });
  await ex("git", ["config", "user.email", "t@t.co"], { cwd: repoPath });
  await ex("git", ["config", "user.name", "t"], { cwd: repoPath });
  await ex("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repoPath });
});

afterEach(async () => {
  delete process.env.ORCH_MERGE_STRATEGY;
  delete process.env.FAKE_AGENT_PER_NODE_FILE;
  await removeRuntimeWorktrees(repoPath);
  await rm(repoPath, { recursive: true, force: true });
});

describe("executeRun lineage mode", () => {
  it("a→b: b forks from a (builds on it); only the leaf b lands on base; branches pruned", async () => {
    const { runId, frames, unsub } = await startGraph(
      [
        { id: "a", kind: "execute", label: "a", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } },
        { id: "b", kind: "execute", label: "b", position: { x: 1, y: 0 }, status: "pending", data: { cli: "fake" } },
      ],
      [{ id: "e1", source: "a", target: "b", kind: "flow" }],
    );
    try {
      await executeRun(runId, ME);
    } finally {
      unsub();
    }

    const reloaded = await RunModel.findById(runId).lean();
    expect(reloaded?.status).toBe("success");

    // Leaf b built on a: base's shared file contains BOTH a's and b's marks.
    const onBase = (await ex("git", ["show", "main:ORCH_FAKE_AGENT_EDIT.md"], { cwd: repoPath })).stdout;
    expect(onBase).toContain("nodeId: a");
    expect(onBase).toContain("nodeId: b");

    // Only the leaf merged to base.
    expect(frames.some((f) => f.includes('"type":"merge.completed"') && f.includes('"nodeId":"b"'))).toBe(true);
    expect(frames.some((f) => f.includes('"type":"merge.completed"') && f.includes('"nodeId":"a"'))).toBe(false);

    // Intermediate + leaf agent branches were pruned.
    const branches = (await ex("git", ["branch", "--list", "agent/*"], { cwd: repoPath })).stdout.trim();
    expect(branches).toBe("");
  });

  it("a→c, b→c: c is seeded from merge(a,b) and is the only node merged to base", async () => {
    process.env.FAKE_AGENT_PER_NODE_FILE = "true"; // a/b/c touch distinct files → clean integration
    const { runId, frames, unsub } = await startGraph(
      [
        { id: "a", kind: "execute", label: "a", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } },
        { id: "b", kind: "execute", label: "b", position: { x: 0, y: 1 }, status: "pending", data: { cli: "fake" } },
        { id: "c", kind: "execute", label: "c", position: { x: 1, y: 0 }, status: "pending", data: { cli: "fake" } },
      ],
      [
        { id: "e1", source: "a", target: "c", kind: "flow" },
        { id: "e2", source: "b", target: "c", kind: "flow" },
      ],
    );
    try {
      await executeRun(runId, ME);
    } finally {
      unsub();
    }

    const reloaded = await RunModel.findById(runId).lean();
    expect(reloaded?.status).toBe("success");

    // c was seeded from the integration of a + b, so base (via leaf c) has all three files.
    await expect(showFile("ORCH_FAKE_a.md")).resolves.toContain("nodeId: a");
    await expect(showFile("ORCH_FAKE_b.md")).resolves.toContain("nodeId: b");
    await expect(showFile("ORCH_FAKE_c.md")).resolves.toContain("nodeId: c");

    // Only the convergence leaf c merged to base.
    expect(frames.some((f) => f.includes('"type":"merge.completed"') && f.includes('"nodeId":"c"'))).toBe(true);
    expect(frames.some((f) => f.includes('"type":"merge.completed"') && f.includes('"nodeId":"a"'))).toBe(false);
    expect(frames.some((f) => f.includes('"type":"merge.completed"') && f.includes('"nodeId":"b"'))).toBe(false);

    // Both agent branches and the integration branch were pruned.
    const agentBranches = (await ex("git", ["branch", "--list", "agent/*"], { cwd: repoPath })).stdout.trim();
    const integBranches = (await ex("git", ["branch", "--list", "integration/*"], { cwd: repoPath })).stdout.trim();
    expect(agentBranches).toBe("");
    expect(integBranches).toBe("");
  });
});

async function showFile(file: string): Promise<string> {
  return (await ex("git", ["show", `main:${file}`], { cwd: repoPath })).stdout;
}

async function startGraph(
  nodes: unknown[],
  edges: unknown[],
): Promise<{ runId: string; frames: string[]; unsub: () => void }> {
  const graph = await GraphModel.create({
    ownerId: ME,
    name: "lineage",
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
