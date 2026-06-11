import { execFile } from "node:child_process";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listBranches } from "./list-branches";

const ex = promisify(execFile);

describe("listBranches (base-branch picker source)", () => {
  let repoPath = "";
  let nonGit = "";

  beforeAll(async () => {
    repoPath = await realpath(await mkdtemp(path.join(os.tmpdir(), "branches-")));
    await ex("git", ["init"], { cwd: repoPath });
    await ex("git", ["config", "user.email", "t@t.co"], { cwd: repoPath });
    await ex("git", ["config", "user.name", "t"], { cwd: repoPath });
    await ex("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repoPath });
    await ex("git", ["branch", "-M", "main"], { cwd: repoPath });
    await ex("git", ["branch", "feature/a"], { cwd: repoPath });
    await ex("git", ["branch", "release"], { cwd: repoPath });

    nonGit = await realpath(await mkdtemp(path.join(os.tmpdir(), "branches-nongit-")));
  });

  afterAll(async () => {
    await rm(repoPath, { recursive: true, force: true });
    await rm(nonGit, { recursive: true, force: true });
  });

  it("lists local branches with the current branch first", async () => {
    const res = await listBranches({ path: repoPath });
    expect(res.isGitRepo).toBe(true);
    expect(res.currentBranch).toBe("main");
    expect(res.branches[0]).toBe("main"); // current first
    expect(res.branches).toEqual(expect.arrayContaining(["main", "feature/a", "release"]));
    expect(res.branches).toHaveLength(3);
  });

  it("degrades to empty for a non-git path (never throws)", async () => {
    const res = await listBranches({ path: nonGit });
    expect(res).toEqual({ isGitRepo: false, branches: [] });
  });

  it("degrades when path is unset", async () => {
    const res = await listBranches({});
    expect(res).toEqual({ isGitRepo: false, branches: [] });
  });
});
