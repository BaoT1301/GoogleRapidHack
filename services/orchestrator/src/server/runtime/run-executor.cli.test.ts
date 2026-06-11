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
const ME = "test_user_runexec_cli";
let repoPath = "";

beforeAll(async () => {
  process.env.ORCH_AUTO_MERGE = "false";
  await connectDB();
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
  repoPath = await mkdtemp(path.join(os.tmpdir(), "runexec-cli-"));
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

async function runGraph(graphDoc: Record<string, unknown>): Promise<{ runId: string; frames: string[] }> {
  const graph = await GraphModel.create({ ownerId: ME, rootRepoPath: repoPath, baseBranch: "HEAD", ...graphDoc });
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

/** The first node.starting frame reports which CLI the runner spawned. */
function startingCliFor(frames: string[], nodeId: string): string | undefined {
  const f = frames.find(
    (x) => x.includes('"type":"node.starting"') && x.includes(`"nodeId":"${nodeId}"`),
  );
  const m = f?.match(/"cli":"(\w+)"/);
  return m?.[1];
}

describe("executeRun — CLI-2 graph-level CLI resolution", () => {
  it("persists the additive graph-level cli field (round-trips through the snapshot)", async () => {
    const graph = await GraphModel.create({
      ownerId: ME,
      name: "cli graph",
      rootRepoPath: repoPath,
      baseBranch: "HEAD",
      cli: "codex",
      nodes: [],
      edges: [],
    });
    const reloaded = await GraphModel.findById(graph._id).lean();
    expect(reloaded?.cli).toBe("codex");
  });

  it("uses the graph-level cli when a node omits data.cli", async () => {
    // Node has NO data.cli; graph.cli = "fake" → the fake runner spawns.
    const { frames } = await runGraph({
      name: "graph cli used",
      cli: "fake",
      nodes: [{ id: "n1", kind: "execute", label: "task", position: { x: 0, y: 0 }, status: "pending", data: {} }],
      edges: [],
    });
    expect(startingCliFor(frames, "n1")).toBe("fake");
  });

  it("lets a node-level data.cli override the graph-level cli", async () => {
    // graph.cli = "codex" but the node pins data.cli = "fake" → fake wins.
    const { frames } = await runGraph({
      name: "node overrides graph",
      cli: "codex",
      nodes: [{ id: "n1", kind: "execute", label: "task", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } }],
      edges: [],
    });
    expect(startingCliFor(frames, "n1")).toBe("fake");
  });

  it("keeps fake available only when explicitly configured for deterministic tests", async () => {
    const { frames } = await runGraph({
      name: "explicit fake",
      nodes: [{ id: "n1", kind: "execute", label: "task", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } }],
      edges: [],
    });
    expect(startingCliFor(frames, "n1")).toBe("fake");
  });
});
