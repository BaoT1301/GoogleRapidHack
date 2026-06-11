import { gitOut } from "./git-read";

export interface RepoBranches {
  /** True when `path` is inside a git work tree. */
  isGitRepo: boolean;
  /** Checked-out branch (omitted in detached HEAD / non-repo). */
  currentBranch?: string;
  /** Local branch short-names, sorted, current branch first. */
  branches: string[];
}

/**
 * READ-ONLY list of a repo's LOCAL branches for the base-branch combobox. Uses
 * `git for-each-ref refs/heads` (clean short-names) plus `rev-parse --abbrev-ref
 * HEAD` for the current branch. Degrades to `{ isGitRepo:false, branches:[] }`
 * for a missing/non-git path and NEVER throws (see `git-read.ts`).
 *
 * Local-only by design: the picker offers existing local branches to fork from
 * or lets the user type a NEW name (created at run start by `ensureBaseBranch`).
 */
export async function listBranches(input: { path?: string }): Promise<RepoBranches> {
  const repoPath = input.path?.trim();
  if (!repoPath) {
    return { isGitRepo: false, branches: [] };
  }

  const insideWorkTree = await gitOut(repoPath, ["rev-parse", "--is-inside-work-tree"]);
  if (insideWorkTree !== "true") {
    return { isGitRepo: false, branches: [] };
  }

  const currentBranch = await gitOut(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const raw = await gitOut(repoPath, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  ]);

  const branches = (raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Current branch first, then case-insensitive name order.
  branches.sort((a, b) => {
    if (a === currentBranch) return -1;
    if (b === currentBranch) return 1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });

  return {
    isGitRepo: true,
    branches,
    // `--abbrev-ref HEAD` returns "HEAD" in detached state — treat as no current.
    ...(currentBranch && currentBranch !== "HEAD" ? { currentBranch } : {}),
  };
}
