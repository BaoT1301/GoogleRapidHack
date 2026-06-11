import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { GitMergeCoordinator } from "./git-merge-coordinator";

const execFileAsync = promisify(execFile);

describe("GitMergeCoordinator", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    for (const tempRoot of tempRoots.splice(0)) {
      await removeRuntimeWorktrees(tempRoot);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("previews a clean source branch", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    await createAgentBranch(rootRepoPath, "run_preview", "node_frontend", {
      "frontend.md": "frontend change\n"
    });

    const coordinator = new GitMergeCoordinator();
    const preview = await coordinator.previewMerge({
      rootRepoPath,
      runId: "run_preview",
      nodeId: "node_frontend",
      targetBranch: "main"
    });

    expect(preview.status).toBe("preview_ready");
    expect(preview.filesChanged.length).toBeGreaterThan(0);
    expect(preview.filesChanged).toContain("A\tfrontend.md");
    expect(preview.patchLength).toBeGreaterThan(0);
    expect(preview.patchPreview).toContain("frontend change");
  });

  it("applies a squash merge in an isolated merge worktree", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    await createAgentBranch(rootRepoPath, "run_squash", "node_backend", {
      "backend.md": "backend change\n"
    });

    const coordinator = new GitMergeCoordinator();
    const result = await coordinator.applyMerge({
      rootRepoPath,
      runId: "run_squash",
      nodeId: "node_backend",
      targetBranch: "main",
      strategy: "squash",
      commitMessage: "Merge backend agent changes"
    });

    expect(result.status).toBe("merged");
    expect(result.mergeCommit).toMatch(/[0-9a-f]{40}/);

    const mergeWorktreePath = extractMergeWorktreePath(result.message);
    await expectFileContains(path.join(mergeWorktreePath, "backend.md"), "backend change");
  });

  it("applies a no-ff merge in an isolated merge worktree", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    await createAgentBranch(rootRepoPath, "run_noff", "node_docs", {
      "docs.md": "docs change\n"
    });

    const coordinator = new GitMergeCoordinator();
    const result = await coordinator.applyMerge({
      rootRepoPath,
      runId: "run_noff",
      nodeId: "node_docs",
      targetBranch: "main",
      strategy: "no-ff",
      commitMessage: "Merge docs agent changes"
    });

    expect(result.status).toBe("merged");
    expect(result.mergeCommit).toMatch(/[0-9a-f]{40}/);
  });

  it("uses sparse checkout exclusions for merge worktrees", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    await mkdir(path.join(rootRepoPath, "node_modules", "fixture"), { recursive: true });
    await writeFile(path.join(rootRepoPath, "node_modules", "fixture", "large.txt"), "dependency\n", "utf8");
    await runGit(rootRepoPath, ["add", "-f", "node_modules/fixture/large.txt"]);
    await runGit(rootRepoPath, ["commit", "-m", "Commit dependency fixture"]);
    await createAgentBranch(rootRepoPath, "run_sparse", "node_sparse", {
      "sparse.md": "sparse merge change\n"
    });

    const coordinator = new GitMergeCoordinator();
    const result = await coordinator.applyMerge({
      rootRepoPath,
      runId: "run_sparse",
      nodeId: "node_sparse",
      targetBranch: "main",
      strategy: "squash"
    });

    expect(result.status).toBe("merged");
    const mergeWorktreePath = extractMergeWorktreePath(result.message);
    await expect(pathExists(path.join(mergeWorktreePath, "node_modules"))).resolves.toBe(false);
    await expect(pathExists(path.join(mergeWorktreePath, "sparse.md"))).resolves.toBe(true);
  });

  it("checkpoints pending agent worktree edits before applying a squash merge", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    const worktreePath = await createAgentWorktree(
      rootRepoPath,
      "run_pending",
      "node_codex"
    );
    await writeFile(
      path.join(worktreePath, "CODEX_RUNTIME_TEST.md"),
      "pending Codex worktree change\n",
      "utf8"
    );

    const coordinator = new GitMergeCoordinator();
    const preview = await coordinator.previewMerge({
      rootRepoPath,
      runId: "run_pending",
      nodeId: "node_codex",
      targetBranch: "main"
    });

    expect(preview.filesChanged).toContain("?? CODEX_RUNTIME_TEST.md");
    expect(preview.hasPendingWorktreeChanges).toBe(true);
    expect(preview.patchPreview).toContain("pending Codex worktree change");

    const result = await coordinator.applyMerge({
      rootRepoPath,
      runId: "run_pending",
      nodeId: "node_codex",
      targetBranch: "main",
      strategy: "squash",
      commitMessage: "Merge pending Codex changes"
    });

    expect(result.status).toBe("merged");
    const mergeWorktreePath = extractMergeWorktreePath(result.message);
    await expectFileContains(
      path.join(mergeWorktreePath, "CODEX_RUNTIME_TEST.md"),
      "pending Codex worktree change"
    );
  });

  it("returns a clear no-op result when the agent worktree has no changes", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    await createAgentWorktree(rootRepoPath, "run_empty", "node_empty");

    const coordinator = new GitMergeCoordinator();
    const result = await coordinator.applyMerge({
      rootRepoPath,
      runId: "run_empty",
      nodeId: "node_empty",
      targetBranch: "main",
      strategy: "squash"
    });

    expect(result.status).toBe("failed");
    expect(result.message).toContain("No mergeable changes were detected");
  });

  it("returns conflicted status when source and target change the same line", async () => {
    const rootRepoPath = await createTempGitRepo({
      "shared.txt": "base\n"
    });
    tempRoots.push(rootRepoPath);

    await createAgentBranch(rootRepoPath, "run_conflict", "node_tests", {
      "shared.txt": "source change\n"
    });
    await runGit(rootRepoPath, ["checkout", "main"]);
    await writeFile(path.join(rootRepoPath, "shared.txt"), "target change\n", "utf8");
    await runGit(rootRepoPath, ["add", "shared.txt"]);
    await runGit(rootRepoPath, ["commit", "-m", "Target branch change"]);

    const coordinator = new GitMergeCoordinator();
    const result = await coordinator.applyMerge({
      rootRepoPath,
      runId: "run_conflict",
      nodeId: "node_tests",
      targetBranch: "main",
      strategy: "no-ff",
      commitMessage: "Merge conflicting tests agent changes"
    });

    expect(result.status).toBe("conflicted");
    expect(result.conflictFiles).toContain("shared.txt");
  });

  it("rejects invalid paths", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    await createAgentBranch(rootRepoPath, "run_invalid", "node_paths", {
      "paths.md": "paths change\n"
    });

    const coordinator = new GitMergeCoordinator();

    await expect(
      coordinator.previewMerge({
        rootRepoPath: "relative/path",
        runId: "run_invalid",
        nodeId: "node_paths",
        targetBranch: "main"
      })
    ).rejects.toThrow("rootRepoPath must be an absolute path");

    await expect(
      coordinator.previewMerge({
        rootRepoPath,
        runId: "run_invalid",
        nodeId: "node_paths",
        targetBranch: "main",
        worktreePath: path.join(os.tmpdir(), "outside-worktree")
      })
    ).rejects.toThrow("worktreePath must be under");
  });

  it("aborts an in-progress conflicted merge in a merge worktree", async () => {
    const rootRepoPath = await createTempGitRepo({
      "shared.txt": "base\n"
    });
    tempRoots.push(rootRepoPath);

    await createAgentBranch(rootRepoPath, "run_abort", "node_conflict", {
      "shared.txt": "source change\n"
    });
    await runGit(rootRepoPath, ["checkout", "main"]);
    await writeFile(path.join(rootRepoPath, "shared.txt"), "target change\n", "utf8");
    await runGit(rootRepoPath, ["add", "shared.txt"]);
    await runGit(rootRepoPath, ["commit", "-m", "Target branch change"]);

    const coordinator = new GitMergeCoordinator();
    const conflict = await coordinator.applyMerge({
      rootRepoPath,
      runId: "run_abort",
      nodeId: "node_conflict",
      targetBranch: "main",
      strategy: "no-ff",
      commitMessage: "Merge conflicting branch"
    });
    expect(conflict.status).toBe("conflicted");

    const mergeWorktreePath = extractMergeWorktreePath(conflict.message);
    const aborted = await coordinator.abortMerge({
      rootRepoPath,
      targetBranch: "main",
      mergeWorktreePath
    });

    expect(aborted.status).toBe("aborted");
  });
});

async function createTempGitRepo(
  files: Record<string, string> = { "README.md": "# Temp Repo\n" }
): Promise<string> {
  const rootRepoPath = await mkdtemp(
    path.join(os.tmpdir(), "orchestrator-merge-git-")
  );

  await runGit(rootRepoPath, ["init", "-b", "main"]);
  await runGit(rootRepoPath, ["config", "user.email", "test@example.com"]);
  await runGit(rootRepoPath, ["config", "user.name", "Orchestrator Test"]);

  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(path.join(rootRepoPath, relativePath), content, "utf8");
  }

  await runGit(rootRepoPath, ["add", "."]);
  await runGit(rootRepoPath, ["commit", "-m", "Initial commit"]);

  return rootRepoPath;
}

async function createAgentBranch(
  rootRepoPath: string,
  runId: string,
  nodeId: string,
  files: Record<string, string>
): Promise<string> {
  const worktreePath = await createAgentWorktree(rootRepoPath, runId, nodeId);

  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(path.join(worktreePath, relativePath), content, "utf8");
  }

  await runGit(worktreePath, ["add", "."]);
  await runGit(worktreePath, ["commit", "-m", `Agent change ${nodeId}`]);

  return worktreePath;
}

async function createAgentWorktree(
  rootRepoPath: string,
  runId: string,
  nodeId: string
): Promise<string> {
  const branchName = `agent/${runId}/${nodeId}`;
  const worktreePath = path.join(
    rootRepoPath,
    ".orchestrator",
    "worktrees",
    runId,
    nodeId
  );

  await runGit(rootRepoPath, [
    "worktree",
    "add",
    "-b",
    branchName,
    worktreePath,
    "main"
  ]);
  await runGit(worktreePath, ["config", "user.email", "test@example.com"]);
  await runGit(worktreePath, ["config", "user.name", "Orchestrator Test"]);

  return worktreePath;
}

async function removeRuntimeWorktrees(rootRepoPath: string): Promise<void> {
  const { stdout } = await runGit(rootRepoPath, ["worktree", "list", "--porcelain"]);
  const worktrees = stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((worktreePath) =>
      worktreePath.includes(`${path.sep}.orchestrator${path.sep}`)
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
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

function extractMergeWorktreePath(message: string): string {
  const line = message
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith("Merge worktree: "));

  if (!line) {
    throw new Error(`Merge worktree path not found in message: ${message}`);
  }

  return line.slice("Merge worktree: ".length);
}
