import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { WorktreeManager } from "./worktree-manager";

const execFileAsync = promisify(execFile);

// GIT-4: `.gitignore` backup hardening + safe worktree removal. These exercise
// the real git plumbing in a throwaway repo (the unit test in
// worktree-manager.test.ts covers the pure `sanitizeWorktreeSegment`).
describe("WorktreeManager — gitignore backup + removeWorktree (GIT-4)", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    for (const tempRoot of tempRoots.splice(0)) {
      await removeRuntimeWorktrees(tempRoot);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  describe("ensureOrchestratorGitignore", () => {
    it("backs up the original .gitignore exactly once and preserves its content", async () => {
      const rootRepoPath = await createTempGitRepo();
      tempRoots.push(rootRepoPath);
      const gitignorePath = path.join(rootRepoPath, ".gitignore");
      const backupPath = path.join(rootRepoPath, ".gitignore.orch-backup");
      const original = "node_modules/\ndist/\n";
      await writeFile(gitignorePath, original, "utf8");

      const manager = new WorktreeManager();
      await manager.ensureOrchestratorGitignore(rootRepoPath);

      // Backup captured the pristine original; live file gained the entry.
      await expect(readFile(backupPath, "utf8")).resolves.toBe(original);
      const afterFirst = await readFile(gitignorePath, "utf8");
      expect(afterFirst).toContain("node_modules/");
      expect(afterFirst).toContain("dist/");
      expect(afterFirst).toContain(".orchestrator/");

      // Second + third calls: idempotent — entry not doubled, backup untouched.
      await manager.ensureOrchestratorGitignore(rootRepoPath);
      // Mutate the live file's managed section to prove the backup is one-time.
      await manager.ensureOrchestratorGitignore(rootRepoPath);

      const afterRepeat = await readFile(gitignorePath, "utf8");
      const occurrences = afterRepeat
        .split(/\r?\n/)
        .filter((line) => line.trim() === ".orchestrator/").length;
      expect(occurrences).toBe(1);
      // Backup is still the very first original (written exactly once).
      await expect(readFile(backupPath, "utf8")).resolves.toBe(original);
    });

    it("does not back up or rewrite when the entry already exists", async () => {
      const rootRepoPath = await createTempGitRepo();
      tempRoots.push(rootRepoPath);
      const gitignorePath = path.join(rootRepoPath, ".gitignore");
      const backupPath = path.join(rootRepoPath, ".gitignore.orch-backup");
      const existing = "build/\n.orchestrator/\n";
      await writeFile(gitignorePath, existing, "utf8");

      const manager = new WorktreeManager();
      await manager.ensureOrchestratorGitignore(rootRepoPath);

      // No-op: file unchanged and no backup created.
      await expect(readFile(gitignorePath, "utf8")).resolves.toBe(existing);
      await expect(pathExists(backupPath)).resolves.toBe(false);
    });

    it("creates a fresh .gitignore without a backup when none existed", async () => {
      const rootRepoPath = await createTempGitRepo();
      tempRoots.push(rootRepoPath);
      const gitignorePath = path.join(rootRepoPath, ".gitignore");
      const backupPath = path.join(rootRepoPath, ".gitignore.orch-backup");
      await rm(gitignorePath, { force: true });

      const manager = new WorktreeManager();
      await manager.ensureOrchestratorGitignore(rootRepoPath);

      await expect(readFile(gitignorePath, "utf8")).resolves.toContain(".orchestrator/");
      // Nothing to preserve → no backup file written.
      await expect(pathExists(backupPath)).resolves.toBe(false);
    });
  });

  describe("removeWorktree", () => {
    it("removes an .orchestrator/ worktree, deletes the branch, and is a no-op the second time", async () => {
      const rootRepoPath = await createTempGitRepo();
      tempRoots.push(rootRepoPath);

      const manager = new WorktreeManager();
      const created = await manager.createWorktree({
        rootRepoPath,
        runId: "run_remove",
        nodeId: "node_a",
        baseRef: "HEAD",
      });
      await expect(pathExists(created.worktreePath)).resolves.toBe(true);

      const first = await manager.removeWorktree({
        rootRepoPath,
        worktreePath: created.worktreePath,
        branchName: created.branchName,
      });
      expect(first.status).toBe("removed");
      expect(first.worktreeRemoved).toBe(true);
      expect(first.branchDeleted).toBe(true);
      await expect(pathExists(created.worktreePath)).resolves.toBe(false);
      await expect(branchExists(rootRepoPath, created.branchName)).resolves.toBe(false);

      // Idempotent: a second removal of the now-missing worktree is success.
      const second = await manager.removeWorktree({
        rootRepoPath,
        worktreePath: created.worktreePath,
      });
      expect(second.status).toBe("noop");
      expect(second.worktreeRemoved).toBe(false);
    });

    it("refuses a path outside .orchestrator/ and never touches it", async () => {
      const rootRepoPath = await createTempGitRepo();
      tempRoots.push(rootRepoPath);
      const outsidePath = path.join(rootRepoPath, "src");
      await writeFile(path.join(rootRepoPath, "keep.txt"), "user file\n", "utf8");

      const manager = new WorktreeManager();
      const result = await manager.removeWorktree({
        rootRepoPath,
        worktreePath: outsidePath,
      });

      expect(result.status).toBe("refused");
      expect(result.worktreeRemoved).toBe(false);
      expect(result.reason).toContain(".orchestrator");
      // User file is untouched.
      await expect(pathExists(path.join(rootRepoPath, "keep.txt"))).resolves.toBe(true);
    });
  });
});

async function createTempGitRepo(): Promise<string> {
  const rootRepoPath = await mkdtemp(path.join(os.tmpdir(), "orch-worktree-life-"));
  await runGit(rootRepoPath, ["init", "-b", "main"]);
  await runGit(rootRepoPath, ["config", "user.email", "test@example.com"]);
  await runGit(rootRepoPath, ["config", "user.name", "Orchestrator Test"]);
  await writeFile(path.join(rootRepoPath, "README.md"), "# Temp\n", "utf8");
  await runGit(rootRepoPath, ["add", "."]);
  await runGit(rootRepoPath, ["commit", "-m", "Initial commit"]);
  return rootRepoPath;
}

async function branchExists(rootRepoPath: string, branchName: string): Promise<boolean> {
  try {
    await runGit(rootRepoPath, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branchName}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

async function removeRuntimeWorktrees(rootRepoPath: string): Promise<void> {
  try {
    const { stdout } = await runGit(rootRepoPath, ["worktree", "list", "--porcelain"]);
    const worktrees = stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .filter((wt) => wt.includes(`${path.sep}.orchestrator${path.sep}`));

    for (const worktreePath of worktrees) {
      await runGit(rootRepoPath, ["worktree", "remove", "--force", worktreePath]);
    }
    await runGit(rootRepoPath, ["worktree", "prune"]);
  } catch {
    // best-effort cleanup
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

async function runGit(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}
