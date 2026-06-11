import path from "node:path";
import { gitOut } from "./git-read";

export interface DefaultRepoRoot {
  /** Absolute path: the git root of `cwd` when inside a repo, else `cwd` itself. */
  path: string;
  /** True when `path` is the top level of a git work tree (vs a bare cwd fallback). */
  isGitRepo: boolean;
}

/**
 * Resolve the smart default repo path for the create/inspector forms: the git
 * top-level enclosing the server's working directory (`git rev-parse
 * --show-toplevel`), falling back to `cwd` itself when not inside a repo or on
 * any git error. READ-ONLY and never throws (see `git-read.ts`).
 *
 * `cwd` is injectable for testing; defaults to `process.cwd()` (the directory the
 * orchestrator/Electron main was launched from — the user's "current" repo).
 */
export async function resolveDefaultRepoRoot(
  cwd: string = process.cwd(),
): Promise<DefaultRepoRoot> {
  const top = await gitOut(cwd, ["rev-parse", "--show-toplevel"]);
  if (top) {
    // git always reports the top-level with forward slashes; normalize to native
    // separators so the path matches the rest of the app (and realpath) on Windows.
    return { path: path.normalize(top), isGitRepo: true };
  }
  return { path: cwd, isGitRepo: false };
}
