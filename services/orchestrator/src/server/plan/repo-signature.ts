/**
 * Cheap repo "signature" for KB staleness detection (auto-sync).
 *
 * For a git repo: HEAD sha + a hash of `git status --porcelain` — near-instant and
 * captures both commits and uncommitted changes (so after an agent run merges, the
 * signature changes → the next plan auto-resyncs). For a non-git path it returns ""
 * ("unknown") so callers don't thrash; those rely on manual sync.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const ex = promisify(execFile);

export async function computeRepoSignature(repoPath: string): Promise<string> {
  try {
    const { stdout: head } = await ex("git", ["-C", repoPath, "rev-parse", "HEAD"], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const { stdout: status } = await ex("git", ["-C", repoPath, "status", "--porcelain"], {
      timeout: 5000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const dirty = createHash("sha1").update(status).digest("hex").slice(0, 16);
    return `git:${head.trim()}:${dirty}`;
  } catch {
    return ""; // not a git repo / git unavailable → unknown
  }
}
