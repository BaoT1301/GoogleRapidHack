import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeRepoInfo, redactRemoteUrl } from "./repo-info";

const ex = promisify(execFile);

describe("redactRemoteUrl (VIS-2 secret safety)", () => {
  it("strips embedded credentials from an https remote", () => {
    expect(redactRemoteUrl("https://user:ghp_secret@github.com/acme/repo.git")).toBe(
      "https://github.com/acme/repo.git",
    );
    expect(redactRemoteUrl("https://token@gitlab.com/x/y.git")).toBe(
      "https://gitlab.com/x/y.git",
    );
  });

  it("leaves credential-free URLs (incl. SSH) untouched", () => {
    expect(redactRemoteUrl("https://github.com/acme/repo.git")).toBe(
      "https://github.com/acme/repo.git",
    );
    expect(redactRemoteUrl("git@github.com:acme/repo.git")).toBe(
      "git@github.com:acme/repo.git",
    );
  });
});

describe("probeRepoInfo (VIS-2 git probe)", () => {
  let repoPath = "";

  beforeAll(async () => {
    repoPath = await mkdtemp(path.join(os.tmpdir(), "repoinfo-"));
    await ex("git", ["init"], { cwd: repoPath });
    await ex("git", ["config", "user.email", "t@t.co"], { cwd: repoPath });
    await ex("git", ["config", "user.name", "t"], { cwd: repoPath });
    await ex("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repoPath });
    await ex("git", ["branch", "-M", "trunk"], { cwd: repoPath });
    await ex(
      "git",
      ["remote", "add", "origin", "https://user:secret@example.com/acme/repo.git"],
      { cwd: repoPath },
    );
  });

  afterAll(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  it("detects branch + redacted remote for a real git repo", async () => {
    const info = await probeRepoInfo({ rootRepoPath: repoPath, baseBranch: "main" });
    expect(info.isGitRepo).toBe(true);
    expect(info.currentBranch).toBe("trunk");
    expect(info.remoteUrl).toBe("https://example.com/acme/repo.git");
    expect(info.remoteUrl).not.toContain("secret");
    expect(info.baseBranch).toBe("main"); // always from the graph
  });

  it("degrades to isGitRepo:false for a non-git path (never throws)", async () => {
    const nonGit = await mkdtemp(path.join(os.tmpdir(), "notgit-"));
    try {
      const info = await probeRepoInfo({ rootRepoPath: nonGit });
      expect(info.isGitRepo).toBe(false);
      expect(info.currentBranch).toBeUndefined();
      expect(info.remoteUrl).toBeUndefined();
      expect(info.baseBranch).toBe("main");
    } finally {
      await rm(nonGit, { recursive: true, force: true });
    }
  });

  it("degrades when rootRepoPath is unset", async () => {
    const info = await probeRepoInfo({});
    expect(info).toEqual({ rootRepoPath: undefined, baseBranch: "main", isGitRepo: false });
  });
});
