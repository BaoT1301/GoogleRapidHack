import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel, RunModel } from "../../db/models";
import { executeRun } from "./run-executor";
import { REVIEWER_AGENT_NAME } from "./reviewer-agent";

const ex = promisify(execFile);
const ME = "test_user_runexec_review";
let repoPath = "";

beforeAll(async () => {
  process.env.ORCH_AUTO_MERGE = "false";
  await connectDB();
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
  repoPath = await mkdtemp(path.join(os.tmpdir(), "runexec-review-"));
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

describe("executeRun — RUN-4 review runner", () => {
  it("runs a review node read-only (orch-reviewer materialized), persists non-skipped, persona-locked", async () => {
    const graph = await GraphModel.create({
      ownerId: ME,
      name: "review graph",
      rootRepoPath: repoPath,
      baseBranch: "HEAD",
      nodes: [
        {
          id: "rv",
          kind: "review",
          label: "audit it",
          position: { x: 0, y: 0 },
          status: "pending",
          // persona-lock probe: a bogus persona must be ignored (always reviewer).
          data: { cli: "fake", persona: "backend_engineer" },
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
    const runId = String(run._id);

    // SEC-3: a real reviewer runs read-only (fs_read) → empty patch. Model that
    // with FAKE_AGENT_READONLY so the read-only assertion passes.
    process.env.FAKE_AGENT_READONLY = "true";
    try {
      await executeRun(runId, ME);
    } finally {
      delete process.env.FAKE_AGENT_READONLY;
    }

    const reloaded = await RunModel.findById(runId).lean();
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<string, { status?: string }>;
    // The review node ran (NOT skipped) and finished success on the fake CLI.
    expect(nodeRuns.rv.status).toBe("success");
    expect(reloaded?.status).toBe("success");

    // Persona-lock proof: regardless of data.persona, the orch-reviewer agent
    // config was materialized into the node's worktree (read-only).
    const agentPath = path.join(
      repoPath,
      ".orchestrator",
      "worktrees",
      runId,
      "rv",
      ".kiro",
      "agents",
      `${REVIEWER_AGENT_NAME}.json`,
    );
    const agent = JSON.parse(await readFile(agentPath, "utf8"));
    expect(agent.name).toBe(REVIEWER_AGENT_NAME);
    expect(agent.tools.join(" ")).not.toContain("write");
    expect(agent.tools.join(" ")).not.toContain("shell");
  });

  it("SEC-3: FAILS a review node that produced a patch (read-only violation)", async () => {
    const graph = await GraphModel.create({
      ownerId: ME,
      name: "review writes",
      rootRepoPath: repoPath,
      baseBranch: "HEAD",
      nodes: [
        {
          id: "rvw",
          kind: "review",
          label: "audit it",
          position: { x: 0, y: 0 },
          status: "pending",
          data: { cli: "fake" },
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
    const runId = String(run._id);

    // No FAKE_AGENT_READONLY → the fake agent writes a file → non-empty patch →
    // the review must be rejected as a read-only violation.
    await executeRun(runId, ME);

    const reloaded = await RunModel.findById(runId).lean();
    const nodeRuns = reloaded?.nodeRuns as unknown as Record<string, { status?: string }>;
    expect(nodeRuns.rvw.status).toBe("failed");
    expect(reloaded?.status).toBe("failed");
  });
});
