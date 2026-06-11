import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel, RunModel } from "../../db/models";
import { executeRun } from "./run-executor";

const ex = promisify(execFile);
const ME = "test_user_runexec_databind";
let repoPath = "";

beforeAll(async () => {
  process.env.ORCH_AUTO_MERGE = "false";
  await connectDB();
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
  repoPath = await mkdtemp(path.join(os.tmpdir(), "runexec-databind-"));
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

/**
 * Run a graph capturing the prompt the DOWNSTREAM node received. Both nodes
 * write the shared FAKE_AGENT_PROMPT_FILE; a `flow` edge orders them so the
 * downstream node (which runs last) wins the file.
 */
async function runAndReadDownstreamPrompt(nodes: unknown[], edges: unknown[]): Promise<string> {
  const promptFile = path.join(
    await mkdtemp(path.join(os.tmpdir(), "databind-prompt-")),
    "prompt.txt",
  );
  const graph = await GraphModel.create({
    ownerId: ME,
    name: "databind graph",
    rootRepoPath: repoPath,
    baseBranch: "HEAD",
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
  process.env.FAKE_AGENT_PROMPT_FILE = promptFile;
  try {
    await executeRun(String(run._id), ME);
  } finally {
    delete process.env.FAKE_AGENT_PROMPT_FILE;
  }
  return readFile(promptFile, "utf8");
}

describe("executeRun — MODEL-2 data-edge bindings", () => {
  it("substitutes an upstream node's parsed output into a downstream prompt via a data edge", async () => {
    // The fake agent emits `{"summary":"Fake agent <id> completed successfully", …}`.
    const prompt = await runAndReadDownstreamPrompt(
      [
        { id: "up", kind: "execute", label: "produce", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake", prompt: "produce output" } },
        { id: "down", kind: "execute", label: "consume", position: { x: 1, y: 0 }, status: "pending", data: { cli: "fake", prompt: "Upstream said: {{upstream.up.summary}}" } },
      ],
      [
        // flow edge orders up → down; data edge carries the binding.
        { id: "f1", source: "up", target: "down", kind: "flow" },
        { id: "d1", source: "up", target: "down", kind: "data", outputKey: "summary" },
      ],
    );
    expect(prompt).toContain("Upstream said: Fake agent up completed successfully");
    expect(prompt).not.toContain("{{upstream.up.summary}}");
  });

  it("leaves the prompt byte-identical when there is no data edge", async () => {
    const prompt = await runAndReadDownstreamPrompt(
      [
        { id: "up", kind: "execute", label: "produce", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake", prompt: "produce output" } },
        { id: "down", kind: "execute", label: "consume", position: { x: 1, y: 0 }, status: "pending", data: { cli: "fake", prompt: "no bindings here" } },
      ],
      [{ id: "f1", source: "up", target: "down", kind: "flow" }],
    );
    expect(prompt).toBe("no bindings here");
  });
});
