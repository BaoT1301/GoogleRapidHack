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
const ME = "test_user_runexec_ctx";
let repoPath = "";

beforeAll(async () => {
  process.env.ORCH_AUTO_MERGE = "false";
  await connectDB();
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
  repoPath = await mkdtemp(path.join(os.tmpdir(), "runexec-ctx-"));
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

async function runGraphCapturePrompt(nodes: unknown[], edges: unknown[]): Promise<string> {
  const promptFile = path.join(
    await mkdtemp(path.join(os.tmpdir(), "prompt-")),
    "prompt.txt",
  );
  const graph = await GraphModel.create({
    ownerId: ME,
    name: "ctx graph",
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

describe("executeRun — RUN-7 context materialization", () => {
  it("prepends an attached context node's text into the execute prompt", async () => {
    const prompt = await runGraphCapturePrompt(
      [
        { id: "ex", kind: "execute", label: "task", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake", prompt: "implement the widget" } },
        { id: "ctx", kind: "context", label: "Design notes", position: { x: 1, y: 0 }, status: "pending", data: { text: "The widget must be accessible." } },
      ],
      [{ id: "e1", source: "ctx", target: "ex", kind: "attaches-to" }],
    );

    expect(prompt).toContain("## Attached context");
    expect(prompt).toContain("### Design notes");
    expect(prompt).toContain("The widget must be accessible.");
    // The original prompt is preserved below the context block.
    expect(prompt).toContain("implement the widget");
  });

  it("leaves the prompt byte-identical when no context node is attached", async () => {
    const prompt = await runGraphCapturePrompt(
      [
        { id: "ex", kind: "execute", label: "task", position: { x: 0, y: 0 }, status: "pending", data: { cli: "fake", prompt: "implement the widget" } },
      ],
      [],
    );
    expect(prompt).toBe("implement the widget");
    expect(prompt).not.toContain("Attached context");
  });
});
