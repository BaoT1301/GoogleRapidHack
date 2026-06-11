import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel } from "../../db/models/graph.model";
import { RunModel } from "../../db/models/run.model";

const ex = promisify(execFile);
const createCaller = createCallerFactory(appRouter);
const ME = "test_user_spawn_autostart";
const me = createCaller({ userId: ME });
let repoPath = "";

// WOW-1: graphs.spawnChild({ autoStart: true }) creates a child sub-graph AND
// starts it through the existing run path (snapshot → executeRun), returning the
// new childRunId. Uses a real temp git repo so executeRun runs the fake CLI to
// completion. Auto-merge off → focus on the spawn-and-run wiring.
beforeAll(async () => {
  process.env.ORCH_AUTO_MERGE = "false";
  await connectDB();
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
  repoPath = await mkdtemp(path.join(os.tmpdir(), "spawn-autostart-"));
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

async function waitForRunStatus(runId: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await RunModel.findById(runId).lean();
    const s = run?.status;
    if (s && s !== "running") return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  return "running";
}

describe("graphs.spawnChild — spawn-and-run (WOW-1)", () => {
  it("autoStart: persists a Run for the child graph, returns childRunId, and drives executeRun", async () => {
    const parent = await me.graphs.create({
      name: "Parent (real repo)",
      rootRepoPath: repoPath,
      baseBranch: "HEAD",
    });
    const parentGraphId = String(parent._id);

    const child = (await me.graphs.spawnChild({
      parentGraphId,
      parentNodeId: "node_failing",
      name: "Auto-started fixer",
      nodes: [
        {
          id: "fix",
          kind: "execute",
          label: "Fixer",
          position: { x: 0, y: 0 },
          status: "pending",
          data: { cli: "fake", prompt: "fix the failing test" },
        },
      ],
      autoStart: true,
    })) as { _id: unknown; childRunId?: string };

    // Additive childRunId on the returned child.
    expect(typeof child.childRunId).toBe("string");
    const childRunId = child.childRunId as string;

    // A Run was persisted for the CHILD graph (not the parent), owner-scoped.
    const run = await RunModel.findById(childRunId).lean();
    expect(run).toBeTruthy();
    expect(run?.ownerId).toBe(ME);
    expect(String(run?.graphId)).toBe(String(child._id));

    // executeRun was actually driven: the run reaches a terminal status and the
    // fixer node ran to success.
    const status = await waitForRunStatus(childRunId);
    expect(status).toBe("success");
    const reloaded = await RunModel.findById(childRunId).lean();
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<string, { status?: string }>;
    expect(nodeRuns.fix?.status).toBe("success");
  });

  it("without autoStart: persists the child but does NOT start a run (back-compatible)", async () => {
    const parent = await me.graphs.create({ name: "Parent no-autostart", rootRepoPath: repoPath });
    const child = (await me.graphs.spawnChild({
      parentGraphId: String(parent._id),
      parentNodeId: "n1",
      name: "Just persisted",
    })) as { _id: unknown; childRunId?: string };

    expect(child.childRunId).toBeUndefined();
    const runs = await RunModel.find({ graphId: String(child._id), ownerId: ME }).lean();
    expect(runs).toHaveLength(0);
  });

  it("autoStart is owner-scoped: a non-owner cannot spawn-and-run under my parent (404)", async () => {
    const other = createCaller({ userId: "test_user_spawn_autostart_other" });
    const parent = await me.graphs.create({ name: "Private parent", rootRepoPath: repoPath });
    await expect(
      other.graphs.spawnChild({
        parentGraphId: String(parent._id),
        parentNodeId: "n1",
        name: "hijack-and-run",
        autoStart: true,
      }),
    ).rejects.toThrow("NOT_FOUND");
  });
});
