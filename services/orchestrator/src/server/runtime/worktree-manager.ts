import { execFile } from "node:child_process";
import { access, mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { assertSafeGitArgs } from "./git-guard";

const execFileAsync = promisify(execFile);
const ORCHESTRATOR_GITIGNORE_ENTRY = ".orchestrator/";
const ORCHESTRATOR_GITIGNORE_BACKUP = ".gitignore.orch-backup";
const GIT_TIMEOUT_MS = 60_000;
const MIN_FREE_BYTES_FOR_WORKTREE = 2 * 1024 * 1024 * 1024;
const SPARSE_CHECKOUT_PATTERNS = [
  "/*",
  "!**/node_modules/",
  "!**/node_modules/**",
  "!**/dist/",
  "!**/dist/**",
  "!**/build/",
  "!**/build/**",
  "!**/.vite/",
  "!**/.vite/**",
  "!**/.cache/",
  "!**/.cache/**",
  "!**/.turbo/",
  "!**/.turbo/**",
  "!**/.next/",
  "!**/.next/**",
  "!**/coverage/",
  "!**/coverage/**",
  "!**/*.tsbuildinfo"
];

export class WorktreeManager {
  private static worktreeCreationQueue: Promise<void> = Promise.resolve();

  async ensureOrchestratorGitignore(rootRepoPath: string): Promise<void> {
    const gitignorePath = path.join(rootRepoPath, ".gitignore");

    let current = "";

    try {
      current = await readFile(gitignorePath, "utf8");
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }

    const lines = current.split(/\r?\n/).map((line) => line.trim());

    if (lines.includes(ORCHESTRATOR_GITIGNORE_ENTRY)) {
      // Already managed — strictly idempotent no-op (no backup, no rewrite).
      return;
    }

    // GIT-4: before the FIRST edit, take a one-time, non-destructive backup of
    // the user's original `.gitignore` so the runtime's edit is always
    // reversible. Only back up real pre-existing content, and only once (the
    // backup is never overwritten on subsequent runs).
    if (current.length > 0) {
      await writeGitignoreBackupOnce(rootRepoPath, current);
    }

    const separator = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
    await writeFile(
      gitignorePath,
      `${current}${separator}${ORCHESTRATOR_GITIGNORE_ENTRY}\n`,
      "utf8"
    );
  }

  /**
   * GIT-4: safely remove an orchestrator-managed worktree after a successful
   * merge-back (called by GIT-2). Strictly scoped to `<rootRepoPath>/.orchestrator/`
   * — it refuses any path outside that tree and never deletes user files.
   * Best-effort and non-throwing: a missing worktree is success (idempotent),
   * and any git failure is reported via the returned status rather than thrown
   * so it can never fail a run.
   */
  async removeWorktree(input: {
    rootRepoPath: string;
    worktreePath: string;
    branchName?: string;
  }): Promise<RemoveWorktreeResult> {
    const rootRepoPath = path.resolve(input.rootRepoPath);
    const worktreePath = path.resolve(input.worktreePath);
    const orchestratorRoot = path.join(rootRepoPath, ".orchestrator");

    // Containment guard: never operate outside `.orchestrator/`.
    if (!isPathInside(worktreePath, orchestratorRoot)) {
      return {
        status: "refused",
        worktreeRemoved: false,
        branchDeleted: false,
        reason: `Refusing to remove a worktree outside ${orchestratorRoot}: ${worktreePath}`
      };
    }

    let worktreeRemoved = false;

    if (await pathExists(worktreePath)) {
      try {
        await runGit(rootRepoPath, ["worktree", "remove", "--force", worktreePath]);
        worktreeRemoved = true;
      } catch (error) {
        return {
          status: "error",
          worktreeRemoved: false,
          branchDeleted: false,
          reason: errorMessage(error)
        };
      }
    }

    // Prune stale administrative entries (best-effort; never fatal).
    try {
      await runGit(rootRepoPath, ["worktree", "prune"]);
    } catch {
      // ignore — pruning is housekeeping only.
    }

    // Optionally delete the now-merged agent branch. Best-effort: if the branch
    // is still checked out by another worktree, `git branch -D` fails — we do
    // NOT force it blindly (see issues.md "removeWorktree branch-in-use" edge
    // case for GIT-2), we just report it.
    let branchDeleted = false;
    let branchReason: string | undefined;
    if (input.branchName) {
      try {
        await runGit(rootRepoPath, ["branch", "-D", input.branchName]);
        branchDeleted = true;
      } catch (error) {
        branchReason = `Worktree removed; branch "${input.branchName}" left in place: ${errorMessage(error)}`;
      }
    }

    return {
      status: worktreeRemoved ? "removed" : "noop",
      worktreeRemoved,
      branchDeleted,
      reason: branchReason
    };
  }

  async createWorktree(input: {
    rootRepoPath: string;
    runId: string;
    nodeId: string;
    baseRef?: string;
  }): Promise<{
    worktreePath: string;
    branchName: string;
    baseRef: string;
  }> {
    const rootRepoPath = path.resolve(input.rootRepoPath);
    const runId = sanitizeWorktreeSegment(input.runId, "runId");
    const nodeId = sanitizeWorktreeSegment(input.nodeId, "nodeId");
    const baseRef = input.baseRef ?? "HEAD";
    const branchName = `agent/${runId}/${nodeId}`;
    const worktreePath = path.join(
      rootRepoPath,
      ".orchestrator",
      "worktrees",
      runId,
      nodeId
    );

    await WorktreeManager.enqueueWorktreeCreation(async () => {
      await mkdir(path.dirname(worktreePath), { recursive: true });
      await this.ensureOrchestratorGitignore(rootRepoPath);
      await assertEnoughFreeSpace(rootRepoPath);
      await assertNoWorktreeCollision(rootRepoPath, worktreePath, branchName);

      await runGit(rootRepoPath, [
        "worktree",
        "add",
        "--no-checkout",
        "-b",
        branchName,
        worktreePath,
        baseRef
      ]);

      await configureSparseCheckout(worktreePath);
      await runGit(worktreePath, ["checkout", "--force"]);
    });

    return {
      worktreePath,
      branchName,
      baseRef
    };
  }

  /**
   * RUN-5 / SEC-3: list the repo-relative paths a worktree changed vs its base —
   * clean names straight from git. Combines tracked
   * `git diff --name-only base...HEAD` with untracked files. A genuinely empty
   * diff returns `[]`; a git FAILURE now THROWS (fail-closed) so the doc/write
   * scope guard treats an indeterminate listing as a violation rather than
   * silently passing an empty set (SEC-3 — `checkWriteScope`).
   */
  async listChangedPaths(input: {
    worktreePath: string;
    baseRef: string;
  }): Promise<string[]> {
    const worktreePath = path.resolve(input.worktreePath);
    const out = new Set<string>();
    const tracked = await runGit(worktreePath, [
      "diff",
      "--name-only",
      `${input.baseRef}...HEAD`
    ]);
    for (const line of tracked.stdout.split(/\r?\n/)) {
      const p = line.trim();
      if (p) out.add(p);
    }
    for (const p of await listUntrackedFiles(worktreePath)) out.add(p);
    return [...out];
  }

  async getDiff(input: {
    worktreePath: string;
    baseRef: string;
  }): Promise<string> {
    const worktreePath = path.resolve(input.worktreePath);
    const trackedDiff = await runGit(worktreePath, [
      "diff",
      `${input.baseRef}...HEAD`
    ]);
    const stagedDiff = await runGit(worktreePath, [
      "diff",
      "--cached",
      "HEAD"
    ]);
    const unstagedDiff = await runGit(worktreePath, [
      "diff",
      "HEAD"
    ]);
    const untrackedFiles = await listUntrackedFiles(worktreePath);
    const untrackedDiffs = await Promise.all(
      untrackedFiles.map((file) => buildUntrackedFileDiff(worktreePath, file))
    );

    return [
      trackedDiff.stdout,
      stagedDiff.stdout,
      unstagedDiff.stdout,
      ...untrackedDiffs,
    ].filter(Boolean).join("\n");
  }

  async getChangedFiles(input: {
    worktreePath: string;
    baseRef: string;
  }): Promise<string[]> {
    const worktreePath = path.resolve(input.worktreePath);
    const tracked = await runGit(worktreePath, [
      "diff",
      "--name-only",
      `${input.baseRef}...HEAD`
    ]);
    const staged = await runGit(worktreePath, [
      "diff",
      "--name-only",
      "--cached",
      "HEAD"
    ]);
    const unstaged = await runGit(worktreePath, [
      "diff",
      "--name-only",
      "HEAD"
    ]);
    const untracked = await listUntrackedFiles(worktreePath);
    return [...new Set([
      ...tracked.stdout.split(/\r?\n/),
      ...staged.stdout.split(/\r?\n/),
      ...unstaged.stdout.split(/\r?\n/),
      ...untracked,
    ].map((line) => line.trim()).filter(Boolean))];
  }

  private static async enqueueWorktreeCreation<T>(
    task: () => Promise<T>
  ): Promise<T> {
    const previous = WorktreeManager.worktreeCreationQueue;
    let release: () => void = () => undefined;
    WorktreeManager.worktreeCreationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await task();
    } finally {
      release();
    }
  }
}

async function assertNoWorktreeCollision(
  rootRepoPath: string,
  worktreePath: string,
  branchName: string
): Promise<void> {
  if (await pathExists(worktreePath)) {
    throw new Error(
      [
        `Refusing to create worktree because target path already exists: ${worktreePath}`,
        "The runtime will not delete existing files automatically.",
        "Cleanup:",
        `  git worktree remove --force ${quoteForMessage(worktreePath)}`,
        `  rm -rf ${quoteForMessage(worktreePath)}`
      ].join("\n")
    );
  }

  if (await branchExists(rootRepoPath, branchName)) {
    throw new Error(
      [
        `Refusing to create worktree because branch already exists: ${branchName}`,
        "The runtime will not delete existing branches automatically.",
        "Cleanup:",
        "  git worktree list",
        `  git branch -D ${quoteForMessage(branchName)}`
      ].join("\n")
    );
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export interface RemoveWorktreeResult {
  /** "removed" = worktree existed and was removed; "noop" = nothing to remove;
   *  "refused" = path outside `.orchestrator/`; "error" = git failed (non-fatal). */
  status: "removed" | "noop" | "refused" | "error";
  worktreeRemoved: boolean;
  branchDeleted: boolean;
  reason?: string;
}

/**
 * Write a one-time backup of the user's original `.gitignore`. Never overwrites
 * an existing backup (idempotent across runs) so the very first pre-edit state
 * is always preserved.
 */
async function writeGitignoreBackupOnce(
  rootRepoPath: string,
  originalContent: string
): Promise<void> {
  const backupPath = path.join(rootRepoPath, ORCHESTRATOR_GITIGNORE_BACKUP);

  if (await pathExists(backupPath)) {
    return;
  }

  await writeFile(backupPath, originalContent, "utf8");
}

/** True when `candidatePath` is the same as, or nested under, `parentPath`. */
function isPathInside(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative.length === 0 ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function branchExists(
  rootRepoPath: string,
  branchName: string
): Promise<boolean> {
  try {
    await execFileAsync(
      "git",
      ["-C", rootRepoPath, "show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
      {
        encoding: "utf8",
        timeout: GIT_TIMEOUT_MS
      }
    );
    return true;
  } catch (error) {
    if (isExecExitCode(error, 1)) {
      return false;
    }

    if (isExecError(error)) {
      throw new Error(
        `git show-ref failed in ${rootRepoPath}: ${error.stderr || error.message}`
      );
    }

    throw error;
  }
}

async function assertEnoughFreeSpace(rootRepoPath: string): Promise<void> {
  const stats = await statfs(rootRepoPath);
  const freeBytes = stats.bavail * stats.bsize;

  if (freeBytes < MIN_FREE_BYTES_FOR_WORKTREE) {
    throw new Error(
      `Refusing to create worktree with only ${formatBytes(
        freeBytes
      )} free. Free at least ${formatBytes(
        MIN_FREE_BYTES_FOR_WORKTREE
      )} or remove old .orchestrator/worktrees entries.`
    );
  }
}

export async function configureSparseCheckout(worktreePath: string): Promise<void> {
  await runGit(worktreePath, ["config", "core.sparseCheckout", "true"]);
  await runGit(worktreePath, ["config", "core.sparseCheckoutCone", "false"]);

  const sparseCheckoutPath = (
    await runGit(worktreePath, ["rev-parse", "--git-path", "info/sparse-checkout"])
  ).stdout.trim();

  if (sparseCheckoutPath.length === 0) {
    throw new Error("Unable to resolve sparse-checkout path for worktree");
  }

  await mkdir(path.dirname(sparseCheckoutPath), { recursive: true });
  await writeFile(
    sparseCheckoutPath,
    `${SPARSE_CHECKOUT_PATTERNS.join("\n")}\n`,
    "utf8"
  );
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GiB`;
}

function quoteForMessage(value: string): string {
  return JSON.stringify(value);
}

async function listUntrackedFiles(worktreePath: string): Promise<string[]> {
  const { stdout } = await runGit(worktreePath, [
    "ls-files",
    "--others",
    "--exclude-standard"
  ]);

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function buildUntrackedFileDiff(
  worktreePath: string,
  relativePath: string
): Promise<string> {
  const fullPath = path.join(worktreePath, relativePath);

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--no-index", "--", "/dev/null", fullPath],
      {
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
        timeout: GIT_TIMEOUT_MS
      }
    );

    return normalizeNoIndexDiff(stdout, worktreePath);
  } catch (error) {
    if (isExecError(error) && typeof error.stdout === "string") {
      return normalizeNoIndexDiff(error.stdout, worktreePath);
    }

    throw error;
  }
}

function normalizeNoIndexDiff(diff: string, worktreePath: string): string {
  return diff
    .replaceAll(`${worktreePath}${path.sep}`, "")
    .replaceAll("/dev/null", "a/dev/null");
}

async function runGit(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  assertSafeGitArgs(args); // SEC-6: reject destructive git from the orchestrator's plumbing
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: GIT_TIMEOUT_MS
    });

    return { stdout, stderr };
  } catch (error) {
    if (isExecError(error)) {
      throw new Error(
        `git ${args.join(" ")} failed in ${cwd}: ${error.stderr || error.message}`
      );
    }

    throw error;
  }
}

export function sanitizeWorktreeSegment(value: string, label = "segment"): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (sanitized.length === 0) {
    throw new Error(`${label} must contain at least one path-safe character`);
  }

  if (
    sanitized === "." ||
    sanitized === ".." ||
    sanitized.includes("..") ||
    sanitized.startsWith(".") ||
    sanitized.endsWith(".") ||
    sanitized.endsWith(".lock")
  ) {
    throw new Error(`${label} is not safe for git branch/path usage`);
  }

  return sanitized;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isExecError(
  error: unknown
): error is Error & { stdout?: string; stderr?: string } {
  return error instanceof Error && ("stdout" in error || "stderr" in error);
}

function isExecExitCode(error: unknown, code: number): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
