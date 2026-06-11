// merge-back-coordinator (GIT-1) — an orchestration layer OVER the existing
// `GitMergeCoordinator`. The coordinator merges an agent branch into a throwaway
// `merge/...` branch in an isolated worktree and deliberately does NOT advance
// the real base. This module:
//   1. orders the run's successful nodes in TOPOLOGICAL order over flow edges,
//   2. for each node calls `GitMergeCoordinator.applyMerge` (reused as-is),
//   3. PROMOTES the resulting merge commit onto the real base branch (always a
//      fast-forward — the merge commit's first parent is the base tip; never
//      force-push, never reset --hard). Promotion is CHECKOUT-AWARE: when base is
//      the branch checked out in the main repo we ff-MERGE inside it so the ref AND
//      the working tree advance together; otherwise we move the ref via CAS
//      `update-ref`. A bare ref move under a live checkout would leave the working
//      tree behind HEAD (stale-on-disk-but-committed) — the bug this avoids.
//   4. records a pre-merge backup ref of base before the first promotion, and
//   5. short-circuits a branch's flow-descendants when an ancestor conflicts/fails.
//
// The `MergeApplyResponse` contract is canonical and untouched — we orchestrate
// and promote it, never alter it.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitMergeCoordinator, sanitizeId } from "./git-merge-coordinator";
import { assertSafeGitArgs } from "./git-guard";
import {
  flowDescendants,
  topologicalOrder,
  type SimpleSchedulerEdge,
} from "./simple-scheduler";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;
const GIT_MAX_BUFFER = 20 * 1024 * 1024;

export type MergeBackStatus = "merged" | "conflicted" | "failed" | "skipped";

export interface MergeBackNode {
  nodeId: string;
  /** Agent branch to merge, e.g. `agent/<runId>/<nodeId>`. */
  branchName: string;
  /** Agent worktree (`.orchestrator/worktrees/<runId>/<nodeId>`), if known. */
  worktreePath?: string;
}

export interface MergeBackNodeResult {
  nodeId: string;
  branchName: string;
  status: MergeBackStatus;
  /** True only when the merge landed AND base was advanced to include it. */
  promoted: boolean;
  mergeCommit?: string;
  mergeBranchName?: string;
  conflictFiles?: string[];
  /** Preserved merge worktree (kept on conflict for GIT-3 / the reviewer). */
  mergeWorktreePath?: string;
  /** Capped conflict diff preview (conflicted only) for GIT-3 persistence. */
  diffPreview?: string;
  message?: string;
}

export interface MergeBackResult {
  baseBranch: string;
  /** Backup ref of base recorded before the first promotion (if any). */
  backupRef?: string;
  /** Base tip after all promotions (or the original tip if nothing landed). */
  baseTip?: string;
  results: MergeBackNodeResult[];
}

export interface MergeBackInput {
  rootRepoPath: string;
  runId: string;
  baseBranch: string;
  /** The run's successful, mergeable nodes (each with its agent branch). */
  nodes: MergeBackNode[];
  /** Graph edges (flow edges drive topological order + descendant blocking). */
  edges: SimpleSchedulerEdge[];
  strategy?: "no-ff" | "squash";
  /** Injectable for testing (defaults to a real `GitMergeCoordinator`). */
  coordinator?: Pick<GitMergeCoordinator, "applyMerge">;
}

/**
 * Merge every successful node's agent branch back into the run's base branch in
 * topological order and promote the result onto the real base. Returns an
 * ordered per-node outcome. Pure-ish: only touches git (merge worktrees + base
 * ref). Never force-pushes, never resets --hard.
 */
export async function runMergeBack(input: MergeBackInput): Promise<MergeBackResult> {
  const { rootRepoPath, runId, baseBranch, nodes, edges } = input;
  const strategy = input.strategy ?? "no-ff";
  const coordinator = input.coordinator ?? new GitMergeCoordinator();

  if (nodes.length === 0) {
    return { baseBranch, results: [] };
  }

  // The scheduler helpers key on `id`; expose `id = nodeId` so we can reuse the
  // exact same flow-edge/topological logic (Do-Not-Invent).
  const schedulerNodes = nodes.map((node) => ({ ...node, id: node.nodeId }));
  const ordered = topologicalOrder(schedulerNodes, edges);
  const results: MergeBackNodeResult[] = [];
  const blocked = new Set<string>(); // flow-descendants of a conflicted/failed node

  // Backup ref of base BEFORE the first promotion (so a human can restore).
  const originalBaseTip = await revParse(rootRepoPath, baseBranch);
  const backupRef = `refs/orch-backup/${baseBranch}/${sanitizeId(runId, "runId")}`;
  await updateRef(rootRepoPath, backupRef, originalBaseTip);

  let currentBaseTip = originalBaseTip;

  // How to promote depends on whether base is the branch checked out in the main repo.
  // Captured ONCE up front: a clean tree now means we may fast-forward it; after the
  // first ff-merge the tree stays clean, so the same decision holds for the whole run.
  const checkout = await detectBaseCheckout(rootRepoPath, baseBranch);

  for (const node of ordered) {
    // Short-circuit: an ancestor already conflicted/failed → do not merge.
    if (blocked.has(node.nodeId)) {
      results.push({
        nodeId: node.nodeId,
        branchName: node.branchName,
        status: "skipped",
        promoted: false,
        message: "Skipped — an upstream merge conflicted or failed.",
      });
      continue;
    }

    let response;
    try {
      response = await coordinator.applyMerge({
        rootRepoPath,
        runId,
        nodeId: node.nodeId,
        targetBranch: baseBranch,
        sourceBranch: node.branchName,
        worktreePath: node.worktreePath,
        strategy,
      });
    } catch (error) {
      blockDescendants(node.nodeId, schedulerNodes, edges, blocked);
      results.push({
        nodeId: node.nodeId,
        branchName: node.branchName,
        status: "failed",
        promoted: false,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (response.status === "merged" && response.mergeCommit) {
      // Promote base to the merge commit. Always a fast-forward (the merge commit's
      // first parent is the current base tip, so this never rewrites history). HOW we
      // advance depends on whether base is checked out in the main repo:
      //   • not checked out  → CAS update-ref (working tree there is another branch).
      //   • checked out+clean → ff-only MERGE inside the main repo so the ref AND the
      //     index/worktree advance together (a bare update-ref would desync them).
      //   • checked out+dirty → skip; never clobber the user's uncommitted edits.
      const promoted = checkout.baseCheckedOut
        ? checkout.clean
          ? await promoteCheckedOutBase(rootRepoPath, currentBaseTip, response.mergeCommit)
          : false
        : await promoteBase(rootRepoPath, baseBranch, currentBaseTip, response.mergeCommit);
      if (promoted) currentBaseTip = response.mergeCommit;
      results.push({
        nodeId: node.nodeId,
        branchName: node.branchName,
        status: "merged",
        promoted,
        mergeCommit: response.mergeCommit,
        mergeBranchName: response.mergeBranchName,
        mergeWorktreePath: extractMergeWorktreePath(response.message),
        message: promoted ? response.message : `${promotionSkipNote(checkout)}: ${response.message}`,
      });
      continue;
    }

    // conflicted | failed | (merged without a commit) → block descendants.
    blockDescendants(node.nodeId, schedulerNodes, edges, blocked);
    const mergeWorktreePath = extractMergeWorktreePath(response.message);
    results.push({
      nodeId: node.nodeId,
      branchName: node.branchName,
      status: response.status === "conflicted" ? "conflicted" : "failed",
      promoted: false,
      mergeBranchName: response.mergeBranchName,
      conflictFiles: response.conflictFiles,
      mergeWorktreePath,
      diffPreview:
        response.status === "conflicted" && mergeWorktreePath
          ? await captureConflictDiffPreview(mergeWorktreePath)
          : undefined,
      message: response.message,
    });
  }

  return { baseBranch, backupRef, baseTip: currentBaseTip, results };
}

function blockDescendants(
  nodeId: string,
  nodes: Array<{ id: string }>,
  edges: SimpleSchedulerEdge[],
  blocked: Set<string>,
): void {
  for (const descendant of flowDescendants(nodeId, nodes, edges)) {
    blocked.add(descendant);
  }
}

async function revParse(rootRepoPath: string, ref: string): Promise<string> {
  const { stdout } = await runGit(rootRepoPath, ["rev-parse", "--verify", ref]);
  return stdout.trim();
}

async function updateRef(
  rootRepoPath: string,
  ref: string,
  value: string,
): Promise<void> {
  await runGit(rootRepoPath, ["update-ref", ref, value]);
}

/**
 * Advance `refs/heads/<base>` to `newCommit`, but only if it is still at
 * `expectedTip` (compare-and-swap). Returns false on a benign failure (e.g. the
 * tip moved) rather than throwing — promotion is never destructive.
 */
async function promoteBase(
  rootRepoPath: string,
  baseBranch: string,
  expectedTip: string,
  newCommit: string,
): Promise<boolean> {
  try {
    await runGit(rootRepoPath, [
      "update-ref",
      `refs/heads/${baseBranch}`,
      newCommit,
      expectedTip,
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Is `baseBranch` the branch checked out in the main repo, and is its tree clean? */
async function detectBaseCheckout(
  rootRepoPath: string,
  baseBranch: string,
): Promise<{ baseCheckedOut: boolean; clean: boolean }> {
  try {
    const head = (
      await runGit(rootRepoPath, ["rev-parse", "--abbrev-ref", "HEAD"])
    ).stdout.trim();
    if (head !== baseBranch) return { baseCheckedOut: false, clean: true };
    const porcelain = (await runGit(rootRepoPath, ["status", "--porcelain"])).stdout;
    // "Clean" = no changes to TRACKED files. Untracked entries ("?? …", e.g. the
    // runtime .orchestrator/worktrees dir) are ignored: a fast-forward-only merge never
    // overwrites untracked files (git refuses if it would), so they don't endanger the
    // tree. Only real local edits to tracked files should block promotion.
    const hasTrackedChanges = porcelain
      .split(/\r?\n/)
      .some((line) => line.trim().length > 0 && !line.startsWith("??"));
    return { baseCheckedOut: true, clean: !hasTrackedChanges };
  } catch {
    // Can't determine → use the safe ref-only CAS path (treat as not checked out).
    return { baseCheckedOut: false, clean: true };
  }
}

/**
 * Advance the CHECKED-OUT base via a fast-forward-only merge in the main repo, so the
 * branch ref AND index/worktree move together. CAS-guarded on the expected tip; git
 * refuses a non-ff, and we never force / never reset --hard / never clobber. Returns
 * false on any unexpected state (base left untouched).
 */
async function promoteCheckedOutBase(
  rootRepoPath: string,
  expectedTip: string,
  mergeCommit: string,
): Promise<boolean> {
  try {
    const head = (await runGit(rootRepoPath, ["rev-parse", "HEAD"])).stdout.trim();
    if (head !== expectedTip) return false;
    await runGit(rootRepoPath, ["merge", "--ff-only", mergeCommit]);
    return true;
  } catch {
    return false;
  }
}

function promotionSkipNote(checkout: { baseCheckedOut: boolean; clean: boolean }): string {
  if (checkout.baseCheckedOut && !checkout.clean) {
    return "Merge succeeded but base was not advanced: the base branch has uncommitted changes in the main checkout (commit or stash them, then merge manually)";
  }
  return "Merge succeeded but base promotion was skipped (base moved unexpectedly)";
}

/** Pull the preserved merge-worktree path out of the coordinator's message. */
function extractMergeWorktreePath(message?: string): string | undefined {
  if (!message) return undefined;
  const line = message
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith("Merge worktree: "));
  return line ? line.slice("Merge worktree: ".length) : undefined;
}

const CONFLICT_DIFF_PREVIEW_LENGTH = 4_000;

/** Best-effort capped conflict diff (with markers) from a preserved merge worktree. */
async function captureConflictDiffPreview(
  mergeWorktreePath: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", mergeWorktreePath, "diff"],
      { encoding: "utf8", maxBuffer: GIT_MAX_BUFFER, timeout: GIT_TIMEOUT_MS },
    );
    return stdout.length > CONFLICT_DIFF_PREVIEW_LENGTH
      ? stdout.slice(0, CONFLICT_DIFF_PREVIEW_LENGTH)
      : stdout;
  } catch {
    return undefined;
  }
}

async function runGit(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  assertSafeGitArgs(args); // SEC-6: never promote/merge via a destructive op
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      maxBuffer: GIT_MAX_BUFFER,
      timeout: GIT_TIMEOUT_MS,
    });
    return { stdout, stderr };
  } catch (error) {
    const err = error as Error & { stderr?: string };
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${err.stderr || err.message}`);
  }
}
