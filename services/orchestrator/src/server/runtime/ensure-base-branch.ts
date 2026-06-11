import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertSafeGitArgs } from "./git-guard";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;

export interface EnsureBaseBranchResult {
  /** "existed" = already present; "created" = freshly forked from HEAD;
   *  "skipped" = not applicable (HEAD/detached-style ref or unsafe name);
   *  "error" = creation attempted but git failed (non-fatal — reported, not thrown). */
  status: "existed" | "created" | "skipped" | "error";
  branch: string;
  reason?: string;
}

/**
 * Base-branch create-at-run-start (picker choice 3=b). The run path requires the
 * graph's `baseBranch` to EXIST as a ref — the worktree manager branches each
 * agent worktree FROM it (`worktree add -b agent/… <baseBranch>`), and the
 * spec validator does `rev-parse --verify <baseBranch>`. The base-branch combobox
 * lets a user type a NEW name; this helper materializes that name from the current
 * HEAD just before the worktrees are created.
 *
 * Idempotent + non-destructive: if the branch already exists it is a no-op; it
 * only ever runs `git branch <name> HEAD` (a CREATE — allowed by the SEC-6
 * `git-guard`, which only forbids deletes/force ops). NEVER throws — every outcome
 * is reported via the returned status so it can't break run finalization. A "HEAD"
 * / empty / unsafe (`-`-leading) name is skipped (handled by the existing ref
 * resolution / fails honestly downstream).
 */
export async function ensureBaseBranch(input: {
  rootRepoPath: string;
  baseBranch: string;
}): Promise<EnsureBaseBranchResult> {
  const branch = input.baseBranch?.trim() ?? "";

  // "HEAD"/empty always resolve as refs; a leading "-" could be read as an option.
  if (!branch || branch === "HEAD") {
    return { status: "skipped", branch, reason: "no concrete branch name to create" };
  }
  if (branch.startsWith("-")) {
    return { status: "skipped", branch, reason: "unsafe branch name" };
  }

  // Already a local branch? No-op (idempotent).
  if (await branchExists(input.rootRepoPath, branch)) {
    return { status: "existed", branch };
  }

  // Create it from the current HEAD. `git branch <name> HEAD` is a non-destructive
  // create; assert it past the destructive-git guard as a defense-in-depth check.
  const args = ["branch", branch, "HEAD"];
  try {
    assertSafeGitArgs(args);
    await runGit(input.rootRepoPath, args);
    return { status: "created", branch };
  } catch (error) {
    return {
      status: "error",
      branch,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** True when `refs/heads/<branch>` resolves. Never throws (missing ⇒ false). */
async function branchExists(rootRepoPath: string, branch: string): Promise<boolean> {
  try {
    await execFileAsync(
      "git",
      ["-C", rootRepoPath, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      { encoding: "utf8", timeout: GIT_TIMEOUT_MS },
    );
    return true;
  } catch {
    // exit 1 (absent) — or any git error — both mean "treat as not present"; the
    // subsequent create will surface a real failure via its own try/catch.
    return false;
  }
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  assertSafeGitArgs(args); // SEC-6: never let the orchestrator's plumbing run destructive git.
  await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
}
