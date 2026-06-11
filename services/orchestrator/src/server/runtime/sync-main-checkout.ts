// sync-main-checkout (WOW-2 / GIT-1 follow-up) — after merge-back promotes the
// base *ref* (fast-forward `update-ref`, never force/reset), the base branch's
// *working tree* (if it is the one checked out in the main repo at rootRepoPath)
// can be left behind the promoted tip. This brings it forward with a
// **fast-forward-only** merge — strictly non-destructive:
//   • never `reset --hard`, never force, never abort the run;
//   • skips entirely when the base branch is NOT the checked-out branch;
//   • skips (no-op) when the working tree is dirty (no clobbering local edits);
//   • on a non-fast-forward divergence, git refuses and we skip + report.
//
// It is gated by the caller behind the existing `ORCH_AUTO_MERGE` knob.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertSafeGitArgs } from "./git-guard";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;
const GIT_MAX_BUFFER = 20 * 1024 * 1024;

export interface SyncMainCheckoutInput {
  rootRepoPath: string;
  baseBranch: string;
  /** The promoted base tip to fast-forward the checkout to. */
  targetCommit?: string;
}

export type SyncMainCheckoutReason =
  | "synced"
  | "no-target"
  | "base-branch-not-checked-out"
  | "working-tree-dirty"
  | "non-fast-forward"
  | "error";

export interface SyncMainCheckoutResult {
  synced: boolean;
  reason: SyncMainCheckoutReason;
  detail?: string;
}

/**
 * Best-effort fast-forward of the main working tree onto `targetCommit` when the
 * base branch is the one checked out there. Returns a structured result; never
 * throws (the run must not fail because of a working-tree housekeeping step).
 */
export async function syncMainCheckout(
  input: SyncMainCheckoutInput,
): Promise<SyncMainCheckoutResult> {
  const { rootRepoPath, baseBranch, targetCommit } = input;
  if (!targetCommit) return { synced: false, reason: "no-target" };

  try {
    // Only touch the main tree when the BASE branch is actually checked out
    // there (otherwise the ref already moved independently — nothing to sync).
    const { stdout: head } = await git(rootRepoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (head.trim() !== baseBranch) {
      return { synced: false, reason: "base-branch-not-checked-out", detail: head.trim() };
    }

    // Never clobber uncommitted local work — skip if the tree is dirty.
    const { stdout: porcelain } = await git(rootRepoPath, ["status", "--porcelain"]);
    if (porcelain.trim().length > 0) {
      return { synced: false, reason: "working-tree-dirty" };
    }

    // Fast-forward ONLY (git refuses a non-ff merge; we never force).
    await git(rootRepoPath, ["merge", "--ff-only", targetCommit]);
    return { synced: true, reason: "synced" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // A non-fast-forward refusal is the expected "safe skip" path.
    if (/fast-forward|not possible to fast-forward|Diverging/i.test(detail)) {
      return { synced: false, reason: "non-fast-forward", detail };
    }
    return { synced: false, reason: "error", detail };
  }
}

async function git(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  assertSafeGitArgs(args); // SEC-6: ff-only sync must never become destructive
  const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
    timeout: GIT_TIMEOUT_MS,
  });
  return { stdout, stderr };
}
