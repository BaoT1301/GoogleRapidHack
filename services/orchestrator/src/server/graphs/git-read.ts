import { execFile } from "node:child_process";
import { promisify } from "node:util";

const ex = promisify(execFile);

/** Git probe timeout — a hung/huge repo must never block the query. */
export const GIT_READ_TIMEOUT_MS = 3000;
/** git metadata is tiny; cap defensively. */
export const GIT_READ_MAX_OUTPUT = 1024 * 1024; // 1 MB

/**
 * Run a READ-ONLY git command in `cwd`; return trimmed stdout or `undefined` on
 * any error. NEVER throws — a missing path / non-git dir / git error all degrade
 * to `undefined`. Shared by the repo-picker queries (default root, branches) so
 * they stay timeout-bounded and fail-soft, mirroring `repo-info.ts`'s probe.
 */
export async function gitOut(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await ex("git", args, {
      cwd,
      timeout: GIT_READ_TIMEOUT_MS,
      maxBuffer: GIT_READ_MAX_OUTPUT,
      windowsHide: true,
    });
    const value = stdout.toString().trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}
