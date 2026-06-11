import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  MergeAbortRequest,
  MergeApplyRequest,
  MergeApplyResponse,
  MergePreviewRequest,
  MergePreviewResponse
} from "./merge-types";
import { configureSparseCheckout } from "./worktree-manager";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;
const GIT_MAX_BUFFER = 20 * 1024 * 1024;
const PATCH_PREVIEW_LENGTH = 4_000;

interface NormalizedMergeInput {
  rootRepoPath: string;
  runId: string;
  nodeId: string;
  targetBranch: string;
  sourceBranch: string;
  worktreePath: string;
}

interface GitResult {
  stdout: string;
  stderr: string;
}

export class GitMergeCoordinator {
  async previewMerge(input: MergePreviewRequest): Promise<MergePreviewResponse> {
    const normalized = await normalizeMergeInput(input);
    const pendingWorktree = await inspectPendingWorktree(normalized);

    const [committedFiles, commits, committedDiffStat, committedPatch] = await Promise.all([
      changedFiles(normalized.rootRepoPath, normalized.targetBranch, normalized.sourceBranch),
      commitList(normalized.rootRepoPath, normalized.targetBranch, normalized.sourceBranch),
      diffStat(normalized.rootRepoPath, normalized.targetBranch, normalized.sourceBranch),
      diffPatch(normalized.rootRepoPath, normalized.targetBranch, normalized.sourceBranch)
    ]);
    const filesChanged = uniqueLines([...committedFiles, ...pendingWorktree.filesChanged]);
    const patch = joinText(committedPatch, pendingWorktree.patch);

    return {
      runId: normalized.runId,
      nodeId: normalized.nodeId,
      targetBranch: normalized.targetBranch,
      sourceBranch: normalized.sourceBranch,
      worktreePath: normalized.worktreePath,
      status: "preview_ready",
      filesChanged,
      commits,
      diffStat: joinText(committedDiffStat, pendingWorktree.diffStat),
      patchPreview: previewText(patch, PATCH_PREVIEW_LENGTH),
      patchLength: patch.length,
      hasPendingWorktreeChanges: pendingWorktree.filesChanged.length > 0,
      pendingWorktreeFiles: pendingWorktree.filesChanged,
      warnings: previewWarnings(filesChanged, commits, pendingWorktree.filesChanged)
    };
  }

  async applyMerge(input: MergeApplyRequest): Promise<MergeApplyResponse> {
    const normalized = await normalizeMergeInput(input);
    const strategy = input.strategy ?? "no-ff";
    const mergeWorktreePath = mergeWorktreePathFor(normalized);
    const commitMessage =
      input.commitMessage?.trim() ||
      `Merge ${normalized.sourceBranch} into ${normalized.targetBranch}`;
    const pendingWorktree = await inspectPendingWorktree(normalized);

    if (pendingWorktree.filesChanged.length > 0) {
      await checkpointAgentWorktree(normalized);
    }

    const commits = await commitList(
      normalized.rootRepoPath,
      normalized.targetBranch,
      normalized.sourceBranch
    );

    if (commits.length === 0) {
      return {
        runId: normalized.runId,
        nodeId: normalized.nodeId,
        targetBranch: normalized.targetBranch,
        sourceBranch: normalized.sourceBranch,
        status: "failed",
        message: "No mergeable changes were detected. Preview the node again and confirm the agent worktree contains a patch before applying a merge."
      };
    }

    await assertMergeWorktreeDoesNotExist(mergeWorktreePath);
    await mkdir(path.dirname(mergeWorktreePath), { recursive: true });
    const mergeBranch = mergeBranchName(normalized);

    try {
      await runGit(normalized.rootRepoPath, [
        "worktree",
        "add",
        "--no-checkout",
        "-b",
        mergeBranch,
        mergeWorktreePath,
        normalized.targetBranch
      ]);
      await configureSparseCheckout(mergeWorktreePath);
      await runGit(mergeWorktreePath, ["checkout", "--force"]);

      const mergeResult =
        strategy === "squash"
          ? await attemptSquashMerge(mergeWorktreePath, normalized.sourceBranch, commitMessage)
          : await attemptNoFfMerge(mergeWorktreePath, normalized.sourceBranch, commitMessage);

      const { stdout: mergeCommit } = await runGit(mergeWorktreePath, [
        "rev-parse",
        "HEAD"
      ]);

      return {
        runId: normalized.runId,
        nodeId: normalized.nodeId,
        targetBranch: normalized.targetBranch,
        sourceBranch: normalized.sourceBranch,
        mergeBranchName: mergeBranch,
        status: "merged",
        mergeCommit: mergeCommit.trim(),
        stdoutPreview: previewText(mergeResult.stdout),
        stderrPreview: previewText(mergeResult.stderr),
        message: [
          "Merge completed in an isolated merge worktree.",
          `Merge worktree: ${mergeWorktreePath}`,
          "The target branch in the main checkout was not modified."
        ].join("\n")
      };
    } catch (error) {
      if (error instanceof MergeConflictError) {
        return {
          runId: normalized.runId,
          nodeId: normalized.nodeId,
          targetBranch: normalized.targetBranch,
          sourceBranch: normalized.sourceBranch,
          mergeBranchName: mergeBranch,
          status: "conflicted",
          conflictFiles: error.conflictFiles,
          stdoutPreview: previewText(error.stdout),
          stderrPreview: previewText(error.stderr),
          message: [
            "Merge conflict detected. The merge worktree was preserved for manual inspection.",
            `Merge worktree: ${mergeWorktreePath}`
          ].join("\n")
        };
      }

      return {
        runId: normalized.runId,
        nodeId: normalized.nodeId,
        targetBranch: normalized.targetBranch,
        sourceBranch: normalized.sourceBranch,
        mergeBranchName: mergeBranch,
        status: "failed",
        stderrPreview: previewText(errorMessage(error)),
        message: errorMessage(error)
      };
    }
  }

  async abortMerge(input: MergeAbortRequest): Promise<MergeApplyResponse> {
    const rootRepoPath = normalizeRootRepoPath(input.rootRepoPath);
    await assertGitRepo(rootRepoPath);
    await assertBranchExists(rootRepoPath, input.targetBranch);

    const mergeWorktreePath = normalizeMergeAbortWorktreePath(
      rootRepoPath,
      input.mergeWorktreePath
    );
    const mergeHeadPath = (
      await runGit(mergeWorktreePath, ["rev-parse", "--git-path", "MERGE_HEAD"])
    ).stdout.trim();

    try {
      if (mergeHeadPath.length > 0 && await pathExists(mergeHeadPath)) {
        const result = await runGit(mergeWorktreePath, ["merge", "--abort"]);

        return {
          runId: "unknown",
          nodeId: "unknown",
          targetBranch: input.targetBranch,
          sourceBranch: "unknown",
          status: "aborted",
          stdoutPreview: previewText(result.stdout),
          stderrPreview: previewText(result.stderr),
          message: `Merge aborted in preserved merge worktree: ${mergeWorktreePath}`
        };
      }

      return {
        runId: "unknown",
        nodeId: "unknown",
        targetBranch: input.targetBranch,
        sourceBranch: "unknown",
        status: "aborted",
        message: `No active merge found in merge worktree: ${mergeWorktreePath}`
      };
    } catch (error) {
      return {
        runId: "unknown",
        nodeId: "unknown",
        targetBranch: input.targetBranch,
        sourceBranch: "unknown",
        status: "failed",
        stderrPreview: previewText(errorMessage(error)),
        message: errorMessage(error)
      };
    }
  }
}

async function normalizeMergeInput(
  input: MergePreviewRequest | MergeApplyRequest
): Promise<NormalizedMergeInput> {
  const rootRepoPath = normalizeRootRepoPath(input.rootRepoPath);
  const runId = sanitizeId(input.runId, "runId");
  const nodeId = sanitizeId(input.nodeId, "nodeId");
  const targetBranch = input.targetBranch.trim();
  const sourceBranch = input.sourceBranch?.trim() || `agent/${runId}/${nodeId}`;
  const worktreePath = normalizeAgentWorktreePath(
    rootRepoPath,
    input.worktreePath || path.join(rootRepoPath, ".orchestrator", "worktrees", runId, nodeId)
  );

  await assertGitRepo(rootRepoPath);
  await assertBranchExists(rootRepoPath, targetBranch);
  await assertBranchExists(rootRepoPath, sourceBranch);

  if (targetBranch === sourceBranch) {
    throw new Error("targetBranch and sourceBranch must be different");
  }

  return {
    rootRepoPath,
    runId,
    nodeId,
    targetBranch,
    sourceBranch,
    worktreePath
  };
}

function normalizeRootRepoPath(rootRepoPath: string): string {
  if (!path.isAbsolute(rootRepoPath)) {
    throw new Error("rootRepoPath must be an absolute path");
  }

  return path.resolve(rootRepoPath);
}

function normalizeAgentWorktreePath(
  rootRepoPath: string,
  worktreePath: string
): string {
  const resolved = path.resolve(worktreePath);
  const worktreesRoot = path.join(rootRepoPath, ".orchestrator", "worktrees");

  if (!isPathInside(resolved, worktreesRoot)) {
    throw new Error(
      `worktreePath must be under ${worktreesRoot}; received ${resolved}`
    );
  }

  return resolved;
}

function normalizeMergeAbortWorktreePath(
  rootRepoPath: string,
  mergeWorktreePath?: string
): string {
  if (!mergeWorktreePath) {
    throw new Error("mergeWorktreePath is required to abort a merge");
  }

  const resolved = path.resolve(mergeWorktreePath);
  const mergeWorktreesRoot = path.join(
    rootRepoPath,
    ".orchestrator",
    "merge-worktrees"
  );

  if (!isPathInside(resolved, mergeWorktreesRoot)) {
    throw new Error(
      `mergeWorktreePath must be under ${mergeWorktreesRoot}; received ${resolved}`
    );
  }

  return resolved;
}

async function assertGitRepo(rootRepoPath: string): Promise<void> {
  const { stdout } = await runGit(rootRepoPath, ["rev-parse", "--is-inside-work-tree"]);

  if (stdout.trim() !== "true") {
    throw new Error(`${rootRepoPath} is not a git work tree`);
  }
}

async function assertBranchExists(
  rootRepoPath: string,
  branchName: string
): Promise<void> {
  if (branchName.length === 0) {
    throw new Error("branch name is required");
  }

  await runGit(rootRepoPath, ["check-ref-format", "--branch", branchName]);
  await runGit(rootRepoPath, ["rev-parse", "--verify", branchName]);
}

async function changedFiles(
  rootRepoPath: string,
  targetBranch: string,
  sourceBranch: string
): Promise<string[]> {
  const { stdout } = await runGit(rootRepoPath, [
    "diff",
    "--name-status",
    `${targetBranch}...${sourceBranch}`
  ]);

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function commitList(
  rootRepoPath: string,
  targetBranch: string,
  sourceBranch: string
): Promise<string[]> {
  const { stdout } = await runGit(rootRepoPath, [
    "log",
    "--oneline",
    `${targetBranch}..${sourceBranch}`
  ]);

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function diffStat(
  rootRepoPath: string,
  targetBranch: string,
  sourceBranch: string
): Promise<string> {
  return (
    await runGit(rootRepoPath, ["diff", "--stat", `${targetBranch}...${sourceBranch}`])
  ).stdout;
}

async function diffPatch(
  rootRepoPath: string,
  targetBranch: string,
  sourceBranch: string
): Promise<string> {
  return (
    await runGit(rootRepoPath, ["diff", `${targetBranch}...${sourceBranch}`])
  ).stdout;
}

interface PendingWorktreeInspection {
  filesChanged: string[];
  diffStat: string;
  patch: string;
}

async function inspectPendingWorktree(
  input: NormalizedMergeInput
): Promise<PendingWorktreeInspection> {
  await assertAgentWorktreeMatchesSourceBranch(input);

  const [{ stdout: status }, { stdout: trackedDiffStat }, { stdout: trackedPatch }, untrackedFiles] =
    await Promise.all([
      runGit(input.worktreePath, ["status", "--porcelain", "--untracked-files=all"]),
      runGit(input.worktreePath, ["diff", "--stat", "HEAD", "--"]),
      runGit(input.worktreePath, ["diff", "--binary", "HEAD", "--"]),
      listUntrackedFiles(input.worktreePath)
    ]);
  const untrackedPatches = await Promise.all(
    untrackedFiles.map((file) => buildUntrackedFileDiff(input.worktreePath, file))
  );
  const untrackedDiffStat = untrackedFiles
    .map((file) => `${file} | untracked`)
    .join("\n");

  return {
    filesChanged: status
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    diffStat: joinText(trackedDiffStat, untrackedDiffStat),
    patch: joinText(trackedPatch, ...untrackedPatches)
  };
}

async function assertAgentWorktreeMatchesSourceBranch(
  input: NormalizedMergeInput
): Promise<void> {
  if (!await pathExists(input.worktreePath)) {
    throw new Error(`Agent worktree does not exist: ${input.worktreePath}`);
  }

  const { stdout } = await runGit(input.worktreePath, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD"
  ]);
  const checkedOutBranch = stdout.trim();

  if (checkedOutBranch !== input.sourceBranch) {
    throw new Error(
      `Agent worktree branch mismatch: expected ${input.sourceBranch}, found ${checkedOutBranch}`
    );
  }
}

async function checkpointAgentWorktree(input: NormalizedMergeInput): Promise<void> {
  await runGit(input.worktreePath, ["add", "--all"]);
  await runGit(input.worktreePath, [
    "commit",
    "-m",
    `Checkpoint ${input.nodeId} agent worktree changes`
  ]);
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
    .filter(Boolean);
}

async function buildUntrackedFileDiff(
  worktreePath: string,
  relativePath: string
): Promise<string> {
  const filePath = path.join(worktreePath, relativePath);
  const { stdout } = await runGitAllowExitCodes(
    worktreePath,
    ["diff", "--no-index", "--binary", "--", "/dev/null", filePath],
    [1]
  );

  return stdout.replaceAll(filePath, relativePath);
}

async function attemptNoFfMerge(
  mergeWorktreePath: string,
  sourceBranch: string,
  commitMessage: string
): Promise<GitResult & { status: "merged" }> {
  try {
    const result = await runGit(mergeWorktreePath, [
      "merge",
      "--no-ff",
      sourceBranch,
      "-m",
      commitMessage
    ]);

    return {
      ...result,
      status: "merged"
    };
  } catch (error) {
    throw await conflictOrOriginalError(mergeWorktreePath, error);
  }
}

async function attemptSquashMerge(
  mergeWorktreePath: string,
  sourceBranch: string,
  commitMessage: string
): Promise<GitResult & { status: "merged" }> {
  try {
    const squash = await runGit(mergeWorktreePath, ["merge", "--squash", sourceBranch]);
    const commit = await runGit(mergeWorktreePath, ["commit", "-m", commitMessage]);

    return {
      stdout: [squash.stdout, commit.stdout].filter(Boolean).join("\n"),
      stderr: [squash.stderr, commit.stderr].filter(Boolean).join("\n"),
      status: "merged"
    };
  } catch (error) {
    throw await conflictOrOriginalError(mergeWorktreePath, error);
  }
}

async function conflictOrOriginalError(
  mergeWorktreePath: string,
  error: unknown
): Promise<unknown> {
  const conflictFiles = await listConflictFiles(mergeWorktreePath);

  if (conflictFiles.length > 0) {
    return new MergeConflictError(
      conflictFiles,
      execErrorStdout(error),
      execErrorStderr(error) || errorMessage(error)
    );
  }

  return error;
}

async function listConflictFiles(mergeWorktreePath: string): Promise<string[]> {
  const { stdout } = await runGit(mergeWorktreePath, [
    "diff",
    "--name-only",
    "--diff-filter=U"
  ]);

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function mergeWorktreePathFor(input: NormalizedMergeInput): string {
  return path.join(
    input.rootRepoPath,
    ".orchestrator",
    "merge-worktrees",
    input.runId,
    input.nodeId,
    new Date().toISOString().replace(/[^0-9A-Za-z._-]/g, "-")
  );
}

function mergeBranchName(input: NormalizedMergeInput): string {
  return `merge/${input.runId}/${input.nodeId}/${Date.now()}`;
}

async function assertMergeWorktreeDoesNotExist(
  mergeWorktreePath: string
): Promise<void> {
  if (await pathExists(mergeWorktreePath)) {
    throw new Error(
      `Refusing to create merge worktree because target path already exists: ${mergeWorktreePath}`
    );
  }
}

async function runGit(cwd: string, args: string[]): Promise<GitResult> {
  return runGitAllowExitCodes(cwd, args);
}

async function runGitAllowExitCodes(
  cwd: string,
  args: string[],
  allowedExitCodes: number[] = []
): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      maxBuffer: GIT_MAX_BUFFER,
      timeout: GIT_TIMEOUT_MS
    });

    return { stdout, stderr };
  } catch (error) {
    if (isExecError(error) && allowedExitCodes.includes(error.code ?? -1)) {
      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? ""
      };
    }

    if (isExecError(error)) {
      throw new Error(
        `git ${args.join(" ")} failed in ${cwd}: ${error.stderr || error.message}`
      );
    }

    throw error;
  }
}

export function sanitizeId(value: string, label = "id"): string {
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

export function previewText(text: string, maxLength = PATCH_PREVIEW_LENGTH): string {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function previewWarnings(
  filesChanged: string[],
  commits: string[],
  pendingWorktreeFiles: string[]
): string[] {
  const warnings: string[] = [];

  if (filesChanged.length === 0) {
    warnings.push("No changed files were detected between target and source branches.");
  }

  if (commits.length === 0 && pendingWorktreeFiles.length === 0) {
    warnings.push("No source commits were detected ahead of target branch.");
  }

  if (pendingWorktreeFiles.length > 0) {
    warnings.push(
      "Pending agent worktree edits will be checkpointed onto the source branch when Apply Merge is clicked."
    );
  }

  return warnings;
}

function joinText(...values: string[]): string {
  return values.filter((value) => value.length > 0).join("\n");
}

function uniqueLines(values: string[]): string[] {
  return [...new Set(values)];
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

function isPathInside(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative.length === 0 ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function isExecError(
  error: unknown
): error is Error & { code?: number; stdout?: string; stderr?: string } {
  return error instanceof Error && ("stdout" in error || "stderr" in error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function execErrorStdout(error: unknown): string {
  return isExecError(error) && typeof error.stdout === "string"
    ? error.stdout
    : "";
}

function execErrorStderr(error: unknown): string {
  return isExecError(error) && typeof error.stderr === "string"
    ? error.stderr
    : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class MergeConflictError extends Error {
  constructor(
    readonly conflictFiles: string[],
    readonly stdout: string,
    readonly stderr: string
  ) {
    super("Merge conflict detected");
  }
}
