import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel, RunModel } from "../../db/models";
import { sseHub } from "../sse/hub";
import { executeRun } from "./run-executor";

const ex = promisify(execFile);
const ME = "test_user_runexec_breaker";
let repoPath = "";

beforeAll(async () => {
  process.env.ORCH_AUTO_MERGE = "false";
  await connectDB();
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
  repoPath = await mkdtemp(path.join(os.tmpdir(), "runexec-breaker-"));
  await ex("git", ["init"], { cwd: repoPath });
  await ex("git", ["config", "user.email", "t@t.co"], { cwd: repoPath });
  await ex("git", ["config", "user.name", "t"], { cwd: repoPath });
  await ex("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repoPath });
});

afterEach(() => {
  delete process.env.FAKE_AGENT_SHOULD_FAIL;
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

describe("executeRun — circuit breaker (SEC-4)", () => {
  it("halts the run after 3 identical consecutive failures and leaves later nodes skipped", async () => {
    // Eight INDEPENDENT execute nodes that all fail identically (exit:1). With
    // maxConcurrency=4, the first batch of 4 fail (3 identical → breaker trips);
    // the remaining nodes are short-circuited to `skipped` rather than run.
    process.env.FAKE_AGENT_SHOULD_FAIL = "true";
    const nodes = Array.from({ length: 8 }, (_, i) => ({
      id: `n${i}`,
      kind: "execute",
      label: `task ${i}`,
      position: { x: 0, y: 0 },
      status: "pending",
      data: { cli: "fake" },
    }));

    const { runId, frames } = await runGraph({ name: "breaker graph", cli: "fake", nodes, edges: [] });

    // Run finalized failed with the breaker reason on the EXISTING run.failed event.
    const runFailed = frames.find((f) => f.includes('"type":"run.failed"'));
    expect(runFailed).toBeDefined();
    expect(runFailed).toContain("circuit breaker");

    const run = await RunModel.findById(runId).lean();
    const nodeRuns = (run?.nodeRuns ?? {}) as Record<string, { status?: string }>;
    const statuses = Object.values(nodeRuns).map((nr) => nr.status);
    const failed = statuses.filter((s) => s === "failed").length;
    const skipped = statuses.filter((s) => s === "skipped").length;

    // At least the breaker threshold worth of failures, and the breaker prevented
    // some nodes from ever running (skipped) — the run did not run all 8.
    expect(failed).toBeGreaterThanOrEqual(3);
    expect(skipped).toBeGreaterThanOrEqual(1);
    expect(failed + skipped).toBe(8);
    // A breaker-skipped node emits node.skipped carrying the breaker flag.
    expect(frames.some((f) => f.includes('"breaker":true'))).toBe(true);
  });

  it("does NOT trip the breaker when a single node fails (run still finalizes failed, no breaker reason)", async () => {
    process.env.FAKE_AGENT_SHOULD_FAIL = "true";
    const { frames } = await runGraph({
      name: "single fail",
      cli: "fake",
      nodes: [{ id: "solo", kind: "execute", label: "solo", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake" } }],
      edges: [],
    });
    const runFailed = frames.find((f) => f.includes('"type":"run.failed"'));
    expect(runFailed).toBeDefined();
    expect(runFailed).not.toContain("circuit breaker");
  });
});
