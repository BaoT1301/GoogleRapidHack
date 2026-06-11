import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  RuntimeCleanupConflictError,
  RuntimeStorageManager,
  classifyStorageWarning
} from "./runtime-storage-manager";

const execFileAsync = promisify(execFile);
const GIB = 1024 * 1024 * 1024;

describe("RuntimeStorageManager", () => {
  const tempRoots: string[] = [];
  const processStates = new Map<string, "not_found" | "running">();
  const manager = new RuntimeStorageManager({
    getProcessState: (runId, nodeId) => processStates.get(`${runId}:${nodeId}`) ?? "not_found"
  });

  afterEach(async () => {
    processStates.clear();
    for (const tempRoot of tempRoots.splice(0)) {
      await removeRuntimeWorktrees(tempRoot);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("classifies disk pressure thresholds", () => {
    expect(classifyStorageWarning(6 * GIB)).toBe("ok");
    expect(classifyStorageWarning(4 * GIB)).toBe("low");
    expect(classifyStorageWarning(1 * GIB)).toBe("critical");
  });

  it("reports worktree sizes and cleans only the selected dirty node after confirmation", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    const frontend = await createAgentWorktree(rootRepoPath, "run_storage", "node_frontend");
    const backend = await createAgentWorktree(rootRepoPath, "run_storage", "node_backend");
    await writeFile(path.join(frontend, "frontend.md"), "frontend pending edit\n", "utf8");
    await writeFile(path.join(backend, "backend.md"), "backend pending edit\n", "utf8");

    const before = await manager.inspect(rootRepoPath);
    const run = before.runs.find((candidate) => candidate.runId === "run_storage");
    expect(run?.agentWorktreeCount).toBe(2);
    expect(run?.agentWorktreeBytes).toBeGreaterThan(0);
    expect(run?.dirtyAgentWorktrees).toBe(true);

    await expect(manager.cleanup({
      rootRepoPath,
      scope: "node",
      runId: "run_storage",
      nodeId: "node_frontend",
      confirm: true
    })).rejects.toBeInstanceOf(RuntimeCleanupConflictError);

    const cleaned = await manager.cleanup({
      rootRepoPath,
      scope: "node",
      runId: "run_storage",
      nodeId: "node_frontend",
      confirm: true,
      discardAgentChanges: true
    });

    expect(cleaned.removedWorktrees).toContain(frontend);
    await expect(pathExists(frontend)).resolves.toBe(false);
    await expect(pathExists(backend)).resolves.toBe(true);
    await expect(branchExists(rootRepoPath, "agent/run_storage/node_frontend")).resolves.toBe(false);
    await expect(branchExists(rootRepoPath, "agent/run_storage/node_backend")).resolves.toBe(true);
  });

  it("requires explicit confirmation before deleting isolated merge results", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    await createAgentWorktree(rootRepoPath, "run_merge", "node_docs");
    const mergeWorktreePath = path.join(
      rootRepoPath,
      ".orchestrator",
      "merge-worktrees",
      "run_merge",
      "node_docs",
      "1234"
    );
    await runGit(rootRepoPath, [
      "worktree",
      "add",
      "-b",
      "merge/run_merge/node_docs/1234",
      mergeWorktreePath,
      "main"
    ]);

    await expect(manager.cleanup({
      rootRepoPath,
      scope: "run",
      runId: "run_merge",
      confirm: true
    })).rejects.toBeInstanceOf(RuntimeCleanupConflictError);

    const cleaned = await manager.cleanup({
      rootRepoPath,
      scope: "run",
      runId: "run_merge",
      confirm: true,
      discardMergeResults: true
    });
    expect(cleaned.removedWorktrees).toContain(mergeWorktreePath);
    await expect(branchExists(rootRepoPath, "merge/run_merge/node_docs/1234")).resolves.toBe(false);
  });

  it("rejects cleanup for running nodes and unsafe IDs", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    await createAgentWorktree(rootRepoPath, "run_live", "node_live");
    processStates.set("run_live:node_live", "running");

    await expect(manager.cleanup({
      rootRepoPath,
      scope: "node",
      runId: "run_live",
      nodeId: "node_live",
      confirm: true
    })).rejects.toThrow("still running");

    await expect(manager.cleanup({
      rootRepoPath,
      scope: "node",
      runId: "../run_live",
      nodeId: "node_live",
      confirm: true
    })).rejects.toThrow("safe runtime identifier");
  });

  it("rejects non-absolute repository paths", async () => {
    await expect(manager.inspect("relative/repo")).rejects.toThrow("absolute path");
  });

  it("does not follow symlinks outside .orchestrator during cleanup", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    await createAgentWorktree(rootRepoPath, "run_symlink", "node_link");
    const outsideFile = path.join(rootRepoPath, "outside.txt");
    const runtimeDirectory = path.join(
      rootRepoPath,
      ".orchestrator",
      "tmp",
      "run_symlink",
      "node_link"
    );
    await writeFile(outsideFile, "must remain\n", "utf8");
    await mkdir(runtimeDirectory, { recursive: true });
    await symlink(outsideFile, path.join(runtimeDirectory, "outside-link"));

    await manager.cleanup({
      rootRepoPath,
      scope: "node",
      runId: "run_symlink",
      nodeId: "node_link",
      confirm: true,
    });

    await expect(readFile(outsideFile, "utf8")).resolves.toBe("must remain\n");
    await expect(pathExists(runtimeDirectory)).resolves.toBe(false);
  });

  it("refuses merged cleanup preview for an unmerged branch", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    const worktreePath = await createCommittedAgentWorktree(rootRepoPath, "run_preview", "node_unmerged", "unmerged.md");

    const result = await manager.previewMergedCleanup({
      ownerId: "owner_1",
      rootRepoPath,
      runId: "run_preview",
      nodeId: "node_unmerged",
      targetBranch: "main",
      sourceBranch: "agent/run_preview/node_unmerged",
      worktreePath,
      nodeStatus: "success",
    });

    expect(result.status).toBe("refused");
    expect(result.wouldDeleteBranch).toBe(false);
    expect(result.checks.find((check) => check.name === "merge proof")?.passed).toBe(false);
  });

  it("allows merged cleanup preview for a no-ff branch proven by ancestry", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    const worktreePath = await createCommittedAgentWorktree(rootRepoPath, "run_preview", "node_noff", "noff.md");
    await runGit(rootRepoPath, ["merge", "--no-ff", "agent/run_preview/node_noff", "-m", "Merge noff agent"]);

    const result = await manager.previewMergedCleanup({
      ownerId: "owner_1",
      rootRepoPath,
      runId: "run_preview",
      nodeId: "node_noff",
      targetBranch: "main",
      sourceBranch: "agent/run_preview/node_noff",
      worktreePath,
      nodeStatus: "success",
      merge: {
        status: "merged",
        targetBranch: "main",
        sourceBranch: "agent/run_preview/node_noff",
        strategy: "no-ff",
        appliedAt: new Date().toISOString(),
        mergeCommit: (await runGit(rootRepoPath, ["rev-parse", "HEAD"])).stdout.trim(),
      },
    });

    expect(result.status).toBe("preview_ready");
    expect(result.wouldRemoveWorktree).toBe(true);
    expect(result.wouldDeleteBranch).toBe(true);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it("refuses squash cleanup without successful merge metadata", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    const worktreePath = await createCommittedAgentWorktree(rootRepoPath, "run_preview", "node_squash", "squash.md");
    await runGit(rootRepoPath, ["merge", "--squash", "agent/run_preview/node_squash"]);
    await runGit(rootRepoPath, ["commit", "-m", "Squash agent changes"]);

    const result = await manager.previewMergedCleanup({
      ownerId: "owner_1",
      rootRepoPath,
      runId: "run_preview",
      nodeId: "node_squash",
      targetBranch: "main",
      sourceBranch: "agent/run_preview/node_squash",
      worktreePath,
      nodeStatus: "success",
      merge: { strategy: "squash" },
    });

    expect(result.status).toBe("refused");
    expect(result.checks.find((check) => check.name === "merge proof")?.message)
      .toContain("squash cleanup requires successful merge metadata");
  });

  it("allows squash cleanup preview with successful merge metadata", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    const worktreePath = await createCommittedAgentWorktree(rootRepoPath, "run_preview", "node_squash_ok", "squash-ok.md");
    await runGit(rootRepoPath, ["merge", "--squash", "agent/run_preview/node_squash_ok"]);
    await runGit(rootRepoPath, ["commit", "-m", "Squash agent changes"]);
    const mergeCommit = (await runGit(rootRepoPath, ["rev-parse", "HEAD"])).stdout.trim();

    const result = await manager.previewMergedCleanup({
      ownerId: "owner_1",
      rootRepoPath,
      runId: "run_preview",
      nodeId: "node_squash_ok",
      targetBranch: "main",
      sourceBranch: "agent/run_preview/node_squash_ok",
      worktreePath,
      nodeStatus: "success",
      merge: {
        status: "merged",
        targetBranch: "main",
        sourceBranch: "agent/run_preview/node_squash_ok",
        strategy: "squash",
        appliedAt: new Date().toISOString(),
        mergeCommit,
      },
    });

    expect(result.status).toBe("preview_ready");
    expect(result.checks.find((check) => check.name === "merge proof")?.passed).toBe(true);
  });

  it("refuses preview for unsafe worktree paths, non-agent branches, running nodes, and dirty worktrees", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    const worktreePath = await createCommittedAgentWorktree(rootRepoPath, "run_preview", "node_guard", "guard.md");
    await runGit(rootRepoPath, ["merge", "--no-ff", "agent/run_preview/node_guard", "-m", "Merge guard agent"]);

    const baseInput = {
      ownerId: "owner_1",
      rootRepoPath,
      runId: "run_preview",
      nodeId: "node_guard",
      targetBranch: "main",
      sourceBranch: "agent/run_preview/node_guard",
      worktreePath,
      nodeStatus: "success",
      merge: {
        status: "merged",
        targetBranch: "main",
        sourceBranch: "agent/run_preview/node_guard",
        strategy: "no-ff" as const,
        appliedAt: new Date().toISOString(),
        mergeCommit: (await runGit(rootRepoPath, ["rev-parse", "HEAD"])).stdout.trim(),
      },
    };

    await expect(manager.previewMergedCleanup({
      ...baseInput,
      worktreePath: path.join(rootRepoPath, "outside-worktree"),
    })).resolves.toMatchObject({ status: "refused" });

    await runGit(rootRepoPath, ["branch", "feature/not-agent"]);
    await expect(manager.previewMergedCleanup({
      ...baseInput,
      sourceBranch: "feature/not-agent",
    })).resolves.toMatchObject({ status: "refused" });

    processStates.set("run_preview:node_guard", "running");
    await expect(manager.previewMergedCleanup(baseInput)).resolves.toMatchObject({ status: "refused" });
    processStates.clear();

    await writeFile(path.join(worktreePath, "dirty.md"), "dirty\n", "utf8");
    const dirty = await manager.previewMergedCleanup(baseInput);
    expect(dirty.status).toBe("refused");
    expect(dirty.checks.find((check) => check.name === "agent worktree clean")?.passed).toBe(false);
  });

  it("does not mutate Git state during merged cleanup preview", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    const worktreePath = await createCommittedAgentWorktree(rootRepoPath, "run_preview", "node_dry", "dry.md");
    await runGit(rootRepoPath, ["merge", "--no-ff", "agent/run_preview/node_dry", "-m", "Merge dry agent"]);
    const branchesBefore = await listBranches(rootRepoPath);
    const worktreesBefore = await listWorktrees(rootRepoPath);

    const result = await manager.previewMergedCleanup({
      ownerId: "owner_1",
      rootRepoPath,
      runId: "run_preview",
      nodeId: "node_dry",
      targetBranch: "main",
      sourceBranch: "agent/run_preview/node_dry",
      worktreePath,
      nodeStatus: "success",
      merge: {
        status: "merged",
        targetBranch: "main",
        sourceBranch: "agent/run_preview/node_dry",
        strategy: "no-ff",
        appliedAt: new Date().toISOString(),
        mergeCommit: (await runGit(rootRepoPath, ["rev-parse", "HEAD"])).stdout.trim(),
      },
    });

    expect(result.status).toBe("preview_ready");
    await expect(listBranches(rootRepoPath)).resolves.toEqual(branchesBefore);
    await expect(listWorktrees(rootRepoPath)).resolves.toEqual(worktreesBefore);
  });

  it("refuses merged cleanup apply without confirm true", async () => {
    const result = await manager.applyMergedCleanup({
      ownerId: "owner_1",
      rootRepoPath: "/tmp/not-used",
      runId: "run_apply",
      nodeId: "node_confirm",
      targetBranch: "main",
      confirm: false,
    } as never);

    expect(result.status).toBe("refused");
    expect(result.removedWorktree).toBe(false);
    expect(result.deletedBranch).toBe(false);
  });

  it("applies merged cleanup after no-ff merge without force deleting the branch", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    const worktreePath = await createCommittedAgentWorktree(rootRepoPath, "run_apply", "node_noff", "apply-noff.md");
    await runGit(rootRepoPath, ["merge", "--no-ff", "agent/run_apply/node_noff", "-m", "Merge noff apply"]);

    const result = await manager.applyMergedCleanup({
      ownerId: "owner_1",
      rootRepoPath,
      runId: "run_apply",
      nodeId: "node_noff",
      targetBranch: "main",
      sourceBranch: "agent/run_apply/node_noff",
      worktreePath,
      nodeStatus: "success",
      merge: {
        status: "merged",
        targetBranch: "main",
        sourceBranch: "agent/run_apply/node_noff",
        strategy: "no-ff",
        appliedAt: new Date().toISOString(),
        mergeCommit: (await runGit(rootRepoPath, ["rev-parse", "HEAD"])).stdout.trim(),
      },
      confirm: true,
    });

    expect(result.status).toBe("cleaned");
    expect(result.removedWorktree).toBe(true);
    expect(result.deletedBranch).toBe(true);
    await expect(pathExists(worktreePath)).resolves.toBe(false);
    await expect(branchExists(rootRepoPath, "agent/run_apply/node_noff")).resolves.toBe(false);
    await expect(runGit(rootRepoPath, ["status", "--porcelain"])).resolves.toMatchObject({ stdout: "" });
  });

  it("applies merged cleanup after squash merge only with proof metadata and explicit branch force", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    const worktreePath = await createCommittedAgentWorktree(rootRepoPath, "run_apply", "node_squash", "apply-squash.md");
    await runGit(rootRepoPath, ["merge", "--squash", "agent/run_apply/node_squash"]);
    await runGit(rootRepoPath, ["commit", "-m", "Squash apply"]);
    const mergeCommit = (await runGit(rootRepoPath, ["rev-parse", "HEAD"])).stdout.trim();
    const merge = {
      status: "merged",
      targetBranch: "main",
      sourceBranch: "agent/run_apply/node_squash",
      strategy: "squash" as const,
      appliedAt: new Date().toISOString(),
      mergeCommit,
    };

    const refused = await manager.applyMergedCleanup({
      ownerId: "owner_1",
      rootRepoPath,
      runId: "run_apply",
      nodeId: "node_squash",
      targetBranch: "main",
      sourceBranch: "agent/run_apply/node_squash",
      worktreePath,
      nodeStatus: "success",
      merge,
      confirm: true,
    });
    expect(refused.status).toBe("refused");
    expect(refused.checks.find((check) => check.name === "branch deletion mode")?.passed).toBe(false);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(branchExists(rootRepoPath, "agent/run_apply/node_squash")).resolves.toBe(true);

    const cleaned = await manager.applyMergedCleanup({
      ownerId: "owner_1",
      rootRepoPath,
      runId: "run_apply",
      nodeId: "node_squash",
      targetBranch: "main",
      sourceBranch: "agent/run_apply/node_squash",
      worktreePath,
      nodeStatus: "success",
      merge,
      confirm: true,
      forceBranchDelete: true,
    });
    expect(cleaned.status).toBe("cleaned");
    expect(cleaned.deletedBranch).toBe(true);
    await expect(pathExists(worktreePath)).resolves.toBe(false);
    await expect(branchExists(rootRepoPath, "agent/run_apply/node_squash")).resolves.toBe(false);
  });

  it("refuses merged cleanup apply for unmerged, dirty, running, non-agent, and unsafe worktree cases", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    const worktreePath = await createCommittedAgentWorktree(rootRepoPath, "run_apply", "node_guard", "apply-guard.md");

    await expect(manager.applyMergedCleanup({
      ownerId: "owner_1",
      rootRepoPath,
      runId: "run_apply",
      nodeId: "node_guard",
      targetBranch: "main",
      sourceBranch: "agent/run_apply/node_guard",
      worktreePath,
      nodeStatus: "success",
      confirm: true,
    })).resolves.toMatchObject({ status: "refused", removedWorktree: false, deletedBranch: false });

    await runGit(rootRepoPath, ["merge", "--no-ff", "agent/run_apply/node_guard", "-m", "Merge guard apply"]);
    const baseInput = {
      ownerId: "owner_1",
      rootRepoPath,
      runId: "run_apply",
      nodeId: "node_guard",
      targetBranch: "main",
      sourceBranch: "agent/run_apply/node_guard",
      worktreePath,
      nodeStatus: "success",
      merge: {
        status: "merged",
        targetBranch: "main",
        sourceBranch: "agent/run_apply/node_guard",
        strategy: "no-ff" as const,
        appliedAt: new Date().toISOString(),
        mergeCommit: (await runGit(rootRepoPath, ["rev-parse", "HEAD"])).stdout.trim(),
      },
      confirm: true as const,
    };

    processStates.set("run_apply:node_guard", "running");
    await expect(manager.applyMergedCleanup(baseInput)).resolves.toMatchObject({ status: "refused" });
    processStates.clear();

    await expect(manager.applyMergedCleanup({
      ...baseInput,
      sourceBranch: "feature/not-agent",
    })).resolves.toMatchObject({ status: "refused" });

    await expect(manager.applyMergedCleanup({
      ...baseInput,
      worktreePath: path.join(rootRepoPath, "outside"),
    })).resolves.toMatchObject({ status: "refused" });

    await writeFile(path.join(worktreePath, "dirty.md"), "dirty\n", "utf8");
    await expect(manager.applyMergedCleanup(baseInput)).resolves.toMatchObject({ status: "refused" });
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(branchExists(rootRepoPath, "agent/run_apply/node_guard")).resolves.toBe(true);
  });

  it("preserves merge worktrees by default and removes them only with discardMergeResults", async () => {
    const rootRepoPath = await createTempGitRepo();
    tempRoots.push(rootRepoPath);
    const keepWorktreePath = await createCommittedAgentWorktree(rootRepoPath, "run_apply_keep", "node_merge", "keep.md");
    await runGit(rootRepoPath, ["merge", "--no-ff", "agent/run_apply_keep/node_merge", "-m", "Merge keep"]);
    const keepMergeWorktree = await createMergeWorktree(rootRepoPath, "run_apply_keep", "node_merge", "1111");
    const keepResult = await manager.applyMergedCleanup({
      ownerId: "owner_1",
      rootRepoPath,
      runId: "run_apply_keep",
      nodeId: "node_merge",
      targetBranch: "main",
      sourceBranch: "agent/run_apply_keep/node_merge",
      worktreePath: keepWorktreePath,
      nodeStatus: "success",
      merge: {
        status: "merged",
        targetBranch: "main",
        sourceBranch: "agent/run_apply_keep/node_merge",
        strategy: "no-ff",
        appliedAt: new Date().toISOString(),
        mergeCommit: (await runGit(rootRepoPath, ["rev-parse", "HEAD"])).stdout.trim(),
      },
      confirm: true,
    });

    expect(keepResult.status).toBe("cleaned");
    expect(keepResult.removedMergeWorktrees).toEqual([]);
    await expect(pathExists(keepMergeWorktree)).resolves.toBe(true);
    await expect(branchExists(rootRepoPath, "merge/run_apply_keep/node_merge/1111")).resolves.toBe(true);

    const discardWorktreePath = await createCommittedAgentWorktree(rootRepoPath, "run_apply_discard", "node_merge", "discard.md");
    await runGit(rootRepoPath, ["merge", "--no-ff", "agent/run_apply_discard/node_merge", "-m", "Merge discard"]);
    const discardMergeWorktree = await createMergeWorktree(rootRepoPath, "run_apply_discard", "node_merge", "2222");
    const discardResult = await manager.applyMergedCleanup({
      ownerId: "owner_1",
      rootRepoPath,
      runId: "run_apply_discard",
      nodeId: "node_merge",
      targetBranch: "main",
      sourceBranch: "agent/run_apply_discard/node_merge",
      worktreePath: discardWorktreePath,
      nodeStatus: "success",
      merge: {
        status: "merged",
        targetBranch: "main",
        sourceBranch: "agent/run_apply_discard/node_merge",
        strategy: "no-ff",
        appliedAt: new Date().toISOString(),
        mergeCommit: (await runGit(rootRepoPath, ["rev-parse", "HEAD"])).stdout.trim(),
      },
      confirm: true,
      discardMergeResults: true,
    });

    expect(discardResult.status).toBe("cleaned");
    expect(discardResult.removedMergeWorktrees).toContain(discardMergeWorktree);
    expect(discardResult.deletedMergeBranches).toContain("merge/run_apply_discard/node_merge/2222");
    await expect(pathExists(discardMergeWorktree)).resolves.toBe(false);
    await expect(branchExists(rootRepoPath, "merge/run_apply_discard/node_merge/2222")).resolves.toBe(false);
  });
});

async function createTempGitRepo(): Promise<string> {
  const rootRepoPath = await mkdtemp(path.join(os.tmpdir(), "orchestrator-storage-"));
  await runGit(rootRepoPath, ["init", "-b", "main"]);
  await runGit(rootRepoPath, ["config", "user.email", "test@example.com"]);
  await runGit(rootRepoPath, ["config", "user.name", "Orchestrator Test"]);
  await writeFile(path.join(rootRepoPath, "README.md"), "# Storage test\n", "utf8");
  await runGit(rootRepoPath, ["add", "."]);
  await runGit(rootRepoPath, ["commit", "-m", "Initial commit"]);
  return rootRepoPath;
}

async function createAgentWorktree(rootRepoPath: string, runId: string, nodeId: string): Promise<string> {
  const worktreePath = path.join(rootRepoPath, ".orchestrator", "worktrees", runId, nodeId);
  await runGit(rootRepoPath, [
    "worktree",
    "add",
    "-b",
    `agent/${runId}/${nodeId}`,
    worktreePath,
    "main"
  ]);
  return worktreePath;
}

async function createCommittedAgentWorktree(
  rootRepoPath: string,
  runId: string,
  nodeId: string,
  fileName: string
): Promise<string> {
  const worktreePath = await createAgentWorktree(rootRepoPath, runId, nodeId);
  await writeFile(path.join(worktreePath, fileName), `${nodeId} change\n`, "utf8");
  await runGit(worktreePath, ["add", fileName]);
  await runGit(worktreePath, ["commit", "-m", `Commit ${nodeId}`]);
  return worktreePath;
}

async function createMergeWorktree(
  rootRepoPath: string,
  runId: string,
  nodeId: string,
  suffix: string
): Promise<string> {
  const worktreePath = path.join(rootRepoPath, ".orchestrator", "merge-worktrees", runId, nodeId, suffix);
  await runGit(rootRepoPath, [
    "worktree",
    "add",
    "-b",
    `merge/${runId}/${nodeId}/${suffix}`,
    worktreePath,
    "main"
  ]);
  return worktreePath;
}

async function removeRuntimeWorktrees(rootRepoPath: string): Promise<void> {
  const { stdout } = await runGit(rootRepoPath, ["worktree", "list", "--porcelain"]);
  const worktrees = stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((worktreePath) => worktreePath.includes(`${path.sep}.orchestrator${path.sep}`));

  for (const worktreePath of worktrees) {
    await runGit(rootRepoPath, ["worktree", "remove", "--force", worktreePath]);
  }
  await runGit(rootRepoPath, ["worktree", "prune"]);
}

async function listBranches(rootRepoPath: string): Promise<string[]> {
  const { stdout } = await runGit(rootRepoPath, ["branch", "--format=%(refname:short)"]);
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).sort();
}

async function listWorktrees(rootRepoPath: string): Promise<string[]> {
  const { stdout } = await runGit(rootRepoPath, ["worktree", "list", "--porcelain"]);
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .sort();
}

async function branchExists(rootRepoPath: string, branch: string): Promise<boolean> {
  try {
    await runGit(rootRepoPath, ["rev-parse", "--verify", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024
  });
  return { stdout, stderr };
}
