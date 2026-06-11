import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { ExecuteRunner } from "./execute-runner";
import { InMemoryRunRepository } from "./run-repository";

const execFileAsync = promisify(execFile);

describe("ExecuteRunner fake integration", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    for (const tempRoot of tempRoots.splice(0)) {
      await removeRuntimeWorktrees(tempRoot);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs two fake agents in isolated worktrees without editing the main checkout", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);

    const runner = new ExecuteRunner();
    const runId = "run_integration_fake";
    const [frontend, backend] = await Promise.all([
      runner.run({
        ownerId: "test_owner",
        runId,
        nodeId: "node_frontend",
        rootRepoPath,
        baseRef: "HEAD",
        prompt: "Fake frontend integration task",
        cli: "fake"
      }),
      runner.run({
        ownerId: "test_owner",
        runId,
        nodeId: "node_backend",
        rootRepoPath,
        baseRef: "HEAD",
        prompt: "Fake backend integration task",
        cli: "fake"
      })
    ]);

    expect(frontend.status).toBe("success");
    expect(backend.status).toBe("success");
    expect(frontend.worktreePath).not.toBe(backend.worktreePath);
    expect(frontend.patchLength).toBeGreaterThan(0);
    expect(backend.patchLength).toBeGreaterThan(0);

    await expectFileContains(
      path.join(frontend.worktreePath, "ORCH_FAKE_AGENT_EDIT.md"),
      "node_frontend"
    );
    await expectFileContains(
      path.join(backend.worktreePath, "ORCH_FAKE_AGENT_EDIT.md"),
      "node_backend"
    );

    await expect(
      fileExists(path.join(rootRepoPath, "ORCH_FAKE_AGENT_EDIT.md"))
    ).resolves.toBe(false);
  });

  it("keeps success and emits a warning when allowedPaths is violated in warn mode", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    const repository = new InMemoryRunRepository();
    repository.createRun({
      runId: "run_allowlist_warn",
      source: "graph",
      nodeIds: ["node_warn"],
    });

    const runner = new ExecuteRunner(undefined, undefined, repository);
    const result = await runner.run({
      ownerId: "test_owner",
      runId: "run_allowlist_warn",
      nodeId: "node_warn",
      rootRepoPath,
      baseRef: "HEAD",
      prompt: "Fake warn policy task",
      cli: "fake",
      allowedPaths: ["src"],
    });

    expect(result.status).toBe("success");
    expect(repository.getRun("run_allowlist_warn")?.events).toContainEqual(expect.objectContaining({
      type: "node.rule.warning",
      nodeId: "node_warn",
      payload: expect.objectContaining({
        rule: "allowedPaths",
        mode: "warn",
        allowedPaths: ["src"],
        violatingFiles: ["ORCH_FAKE_AGENT_EDIT.md"],
      }),
    }));
  });

  it("marks the node failed when allowedPaths is violated in fail mode", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    const repository = new InMemoryRunRepository();
    repository.createRun({
      runId: "run_allowlist_fail",
      source: "graph",
      nodeIds: ["node_fail"],
    });

    const runner = new ExecuteRunner(undefined, undefined, repository);
    const result = await runner.run({
      ownerId: "test_owner",
      runId: "run_allowlist_fail",
      nodeId: "node_fail",
      rootRepoPath,
      baseRef: "HEAD",
      prompt: "Fake fail policy task",
      cli: "fake",
      allowedPaths: ["src"],
      pathPolicyMode: "fail",
    });

    expect(result.status).toBe("failed");
    expect(repository.getRun("run_allowlist_fail")?.events.some((event) =>
      event.type === "node.failed" &&
      event.payload.reason === "path_policy_violation"
    )).toBe(true);
  });

  it("fails long-running fake nodes with timeout and preserves the worktree", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    const previousDelay = process.env.FAKE_AGENT_DELAY_MS;
    const previousSteps = process.env.FAKE_AGENT_STEPS;
    const repository = new InMemoryRunRepository();
    repository.createRun({
      runId: "run_fake_timeout",
      source: "graph",
      nodeIds: ["node_timeout"],
    });

    process.env.FAKE_AGENT_DELAY_MS = "250";
    process.env.FAKE_AGENT_STEPS = "100";

    try {
      const runner = new ExecuteRunner(undefined, undefined, repository);
      const result = await runner.run({
        ownerId: "test_owner",
        runId: "run_fake_timeout",
        nodeId: "node_timeout",
        rootRepoPath,
        baseRef: "HEAD",
        prompt: "Long fake task",
        cli: "fake",
        timeoutMs: 1_000,
      });

      expect(result.status).toBe("failed");
      expect(await fileExists(result.worktreePath)).toBe(true);
      expect(repository.getRun("run_fake_timeout")?.events).toContainEqual(expect.objectContaining({
        type: "node.timeout",
        nodeId: "node_timeout",
        payload: expect.objectContaining({
          timeoutMs: expect.any(Number),
        }),
      }));
      expect(repository.getRun("run_fake_timeout")?.events).toContainEqual(expect.objectContaining({
        type: "node.failed",
        nodeId: "node_timeout",
        payload: expect.objectContaining({
          reason: "timeout",
          timeoutMs: expect.any(Number),
        }),
      }));
    } finally {
      restoreEnvValue("FAKE_AGENT_DELAY_MS", previousDelay);
      restoreEnvValue("FAKE_AGENT_STEPS", previousSteps);
    }
  }, 10_000);
});

async function createTempGitRepo(): Promise<string> {
  const rootRepoPath = await mkdtemp(
    path.join(os.tmpdir(), "orchestrator-git-")
  );

  await runGit(rootRepoPath, ["init"]);
  await runGit(rootRepoPath, ["config", "user.email", "test@example.com"]);
  await runGit(rootRepoPath, ["config", "user.name", "Orchestrator Test"]);
  await writeFile(path.join(rootRepoPath, "README.md"), "# Temp Repo\n", "utf8");
  await runGit(rootRepoPath, ["add", "README.md"]);
  await runGit(rootRepoPath, ["commit", "-m", "Initial commit"]);

  return rootRepoPath;
}

async function removeRuntimeWorktrees(rootRepoPath: string): Promise<void> {
  const { stdout } = await runGit(rootRepoPath, ["worktree", "list", "--porcelain"]);
  const worktrees = stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((worktreePath) =>
      worktreePath.includes(`${path.sep}.orchestrator${path.sep}worktrees${path.sep}`)
    );

  for (const worktreePath of worktrees) {
    await runGit(rootRepoPath, ["worktree", "remove", "--force", worktreePath]);
  }

  await runGit(rootRepoPath, ["worktree", "prune"]);
}

async function expectFileContains(filePath: string, expected: string): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(filePath, "utf8");

  expect(content).toContain(expected);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

async function runGit(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024
  });

  return { stdout, stderr };
}
