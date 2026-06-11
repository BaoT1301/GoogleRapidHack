import { execFile } from "node:child_process";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureBaseBranch } from "./ensure-base-branch";

const ex = promisify(execFile);

async function branchPresent(repo: string, name: string): Promise<boolean> {
  try {
    await ex("git", ["-C", repo, "show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
    return true;
  } catch {
    return false;
  }
}

describe("ensureBaseBranch (create-at-run-start)", () => {
  let repo = "";

  beforeAll(async () => {
    repo = await realpath(await mkdtemp(path.join(os.tmpdir(), "ensurebranch-")));
    await ex("git", ["init"], { cwd: repo });
    await ex("git", ["config", "user.email", "t@t.co"], { cwd: repo });
    await ex("git", ["config", "user.name", "t"], { cwd: repo });
    await ex("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repo });
    await ex("git", ["branch", "-M", "main"], { cwd: repo });
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("creates a new branch from HEAD when it is absent", async () => {
    const res = await ensureBaseBranch({ rootRepoPath: repo, baseBranch: "feature/new-base" });
    expect(res.status).toBe("created");
    expect(await branchPresent(repo, "feature/new-base")).toBe(true);
  });

  it("is a no-op when the branch already exists", async () => {
    const res = await ensureBaseBranch({ rootRepoPath: repo, baseBranch: "main" });
    expect(res.status).toBe("existed");
  });

  it("is idempotent across repeated calls", async () => {
    const first = await ensureBaseBranch({ rootRepoPath: repo, baseBranch: "repeated" });
    const second = await ensureBaseBranch({ rootRepoPath: repo, baseBranch: "repeated" });
    expect(first.status).toBe("created");
    expect(second.status).toBe("existed");
  });

  it("skips the synthetic 'HEAD' ref (always resolvable, never created)", async () => {
    const res = await ensureBaseBranch({ rootRepoPath: repo, baseBranch: "HEAD" });
    expect(res.status).toBe("skipped");
    expect(await branchPresent(repo, "HEAD")).toBe(false);
  });

  it("skips an unsafe option-like name", async () => {
    const res = await ensureBaseBranch({ rootRepoPath: repo, baseBranch: "--force" });
    expect(res.status).toBe("skipped");
  });

  it("reports an error (does not throw) for a non-git path", async () => {
    const nonGit = await realpath(await mkdtemp(path.join(os.tmpdir(), "ensurebranch-nongit-")));
    try {
      const res = await ensureBaseBranch({ rootRepoPath: nonGit, baseBranch: "x" });
      expect(res.status).toBe("error");
    } finally {
      await rm(nonGit, { recursive: true, force: true });
    }
  });
});
