import { execFile } from "node:child_process";
import { promisify } from "node:util";

const ex = promisify(execFile);

/** Git probe timeout — a hung/huge repo must never block the query. */
const GIT_TIMEOUT_MS = 3000;
const MAX_OUTPUT = 1024 * 1024; // 1 MB — git metadata is tiny; cap defensively.

export interface RepoInfo {
  rootRepoPath?: string;
  baseBranch: string;
  remoteUrl?: string;
  currentBranch?: string;
  isGitRepo: boolean;
}

/**
 * VIS-2 — strip embedded credentials from a remote URL so the badge never leaks
 * a token/password (Zero-Secret Leakage). `https://user:pass@host/repo.git` →
 * `https://host/repo.git`. Leaves credential-free URLs (incl. `git@host:…` SSH)
 * untouched.
 */
export function redactRemoteUrl(url: string): string {
  const trimmed = url.trim();
  // scheme://[user[:pass]@]host/...  → drop the userinfo before '@'.
  return trimmed.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^@/]+@/, "$1");
}

/** Run a git command in `cwd`; return trimmed stdout or `undefined` on any error. */
async function gitOut(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await ex("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT,
      windowsHide: true,
    });
    const value = stdout.toString().trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * VIS-2 — probe a repo's git metadata for the workspace header badge. READ-ONLY,
 * timeout-bounded, and NEVER throws (a missing path / non-git dir / git error all
 * degrade to `isGitRepo: false` with fields omitted). Credentials in the remote
 * URL are redacted. `baseBranch` always comes from the graph (defaults `main`).
 */
export async function probeRepoInfo(input: {
  rootRepoPath?: string;
  baseBranch?: string;
}): Promise<RepoInfo> {
  const rootRepoPath = input.rootRepoPath?.trim() || undefined;
  const baseBranch = input.baseBranch?.trim() || "main";

  if (!rootRepoPath) {
    return { rootRepoPath: undefined, baseBranch, isGitRepo: false };
  }

  const insideWorkTree = await gitOut(rootRepoPath, ["rev-parse", "--is-inside-work-tree"]);
  if (insideWorkTree !== "true") {
    return { rootRepoPath, baseBranch, isGitRepo: false };
  }

  const currentBranch = await gitOut(rootRepoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const rawRemote = await gitOut(rootRepoPath, ["remote", "get-url", "origin"]);
  const remoteUrl = rawRemote ? redactRemoteUrl(rawRemote) : undefined;

  return {
    rootRepoPath,
    baseBranch,
    isGitRepo: true,
    ...(currentBranch ? { currentBranch } : {}),
    ...(remoteUrl ? { remoteUrl } : {}),
  };
}
