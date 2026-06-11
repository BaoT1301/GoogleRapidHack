import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveDefaultRepoRoot } from "./default-repo-root";

const ex = promisify(execFile);

describe("resolveDefaultRepoRoot (smart default repo path)", () => {
  let repoPath = "";
  let nested = "";
  let nonGit = "";

  beforeAll(async () => {
    // macOS /tmp is a symlink to /private/tmp; realpath so `--show-toplevel`
    // (which returns the canonical path) matches our expectations.
    repoPath = await realpath(await mkdtemp(path.join(os.tmpdir(), "defroot-")));
    await ex("git", ["init"], { cwd: repoPath });
    await ex("git", ["config", "user.email", "t@t.co"], { cwd: repoPath });
    await ex("git", ["config", "user.name", "t"], { cwd: repoPath });
    await ex("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repoPath });

    nested = path.join(repoPath, "packages", "app");
    await mkdir(nested, { recursive: true });

    nonGit = await realpath(await mkdtemp(path.join(os.tmpdir(), "defroot-nongit-")));
  });

  afterAll(async () => {
    await rm(repoPath, { recursive: true, force: true });
    await rm(nonGit, { recursive: true, force: true });
  });

  it("returns the git top-level when cwd is the repo root", async () => {
    const res = await resolveDefaultRepoRoot(repoPath);
    expect(res).toEqual({ path: repoPath, isGitRepo: true });
  });

  it("walks up to the git top-level from a nested subdirectory", async () => {
    const res = await resolveDefaultRepoRoot(nested);
    expect(res.path).toBe(repoPath);
    expect(res.isGitRepo).toBe(true);
  });

  it("falls back to cwd (isGitRepo:false) outside any repo", async () => {
    const res = await resolveDefaultRepoRoot(nonGit);
    expect(res).toEqual({ path: nonGit, isGitRepo: false });
  });

  it("never throws on a non-existent cwd", async () => {
    const res = await resolveDefaultRepoRoot(path.join(nonGit, "does-not-exist"));
    expect(res.isGitRepo).toBe(false);
    expect(typeof res.path).toBe("string");
  });
});
