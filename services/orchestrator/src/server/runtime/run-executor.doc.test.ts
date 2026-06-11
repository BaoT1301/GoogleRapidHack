import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel, RunModel } from "../../db/models";
import { executeRun } from "./run-executor";
import { DOC_AGENT_NAME } from "./doc-agent";

const ex = promisify(execFile);
const ME = "test_user_runexec_doc";
let repoPath = "";

beforeAll(async () => {
  process.env.ORCH_AUTO_MERGE = "false";
  await connectDB();
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
  repoPath = await mkdtemp(path.join(os.tmpdir(), "runexec-doc-"));
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

async function runDocGraph(nodeId: string): Promise<string> {
  const graph = await GraphModel.create({
    ownerId: ME,
    name: "doc graph",
    rootRepoPath: repoPath,
    baseBranch: "HEAD",
    nodes: [
      {
        id: nodeId,
        kind: "doc",
        label: "update docs",
        position: { x: 0, y: 0 },
        status: "pending",
        data: { cli: "fake", persona: "backend_engineer" }, // persona-lock probe
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
  return String(run._id);
}

describe("executeRun — RUN-5 doc runner", () => {
  it("PASSES a docs-only patch and materializes the knowledge_manager-locked orch-doc agent", async () => {
    // fake agent writes ORCH_FAKE_AGENT_EDIT.md (a *.md file → in scope).
    const runId = await runDocGraph("dok");
    await executeRun(runId, ME);

    const reloaded = await RunModel.findById(runId).lean();
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<string, { status?: string }>;
    expect(nodeRuns.dok.status).toBe("success");
    expect(reloaded?.status).toBe("success");

    const agentPath = path.join(
      repoPath, ".orchestrator", "worktrees", runId, "dok",
      ".kiro", "agents", `${DOC_AGENT_NAME}.json`,
    );
    const agent = JSON.parse(await readFile(agentPath, "utf8"));
    expect(agent.name).toBe(DOC_AGENT_NAME);
    expect(agent.tools).toContain("write");
  });

  it("FAILS the node when the scope guard finds an out-of-scope (non-doc) write", async () => {
    const runId = await runDocGraph("dbad");
    process.env.FAKE_AGENT_EDIT_FILE = "src/app.ts"; // out of doc scope
    try {
      await executeRun(runId, ME);
    } finally {
      delete process.env.FAKE_AGENT_EDIT_FILE;
    }

    const reloaded = await RunModel.findById(runId).lean();
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<string, { status?: string }>;
    // The scope guard rejected the out-of-scope write → node failed → run failed.
    expect(nodeRuns.dbad.status).toBe("failed");
    expect(reloaded?.status).toBe("failed");
  });
});
