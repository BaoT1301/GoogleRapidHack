import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { syncMainCheckout } from "./sync-main-checkout";

const ex = promisify(execFile);

// WOW-2 (GIT-1 follow-up): the non-destructive fast-forward-only sync of the
// main working tree after a base-ref promotion.
describe("syncMainCheckout (WOW-2)", () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
  });

  async function repo(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "syncmain-"));
    roots.push(root);
    await ex("git", ["init", "-b", "main"], { cwd: root });
    await ex("git", ["config", "user.email", "t@t.co"], { cwd: root });
    await ex("git", ["config", "user.name", "t"], { cwd: root });
    await writeFile(path.join(root, "f.txt"), "base\n", "utf8");
    await ex("git", ["add", "."], { cwd: root });
    await ex("git", ["commit", "-m", "c0"], { cwd: root });
    return root;
  }

  async function commitOnNewBranch(root: string, branch: string, content: string): Promise<string> {
    await ex("git", ["checkout", "-b", branch], { cwd: root });
    await writeFile(path.join(root, "f.txt"), content, "utf8");
    await ex("git", ["commit", "-am", `c-${branch}`], { cwd: root });
    const { stdout } = await ex("git", ["rev-parse", branch], { cwd: root });
    return stdout.trim();
  }

  it("fast-forwards a clean main checkout that is behind the target (advances ref + worktree)", async () => {
    const root = await repo();
    const target = await commitOnNewBranch(root, "feat", "base\nmore\n");
    await ex("git", ["checkout", "main"], { cwd: root });

    const res = await syncMainCheckout({ rootRepoPath: root, baseBranch: "main", targetCommit: target });
    expect(res.synced).toBe(true);
    expect(res.reason).toBe("synced");

    // main now points at target AND the working tree was updated.
    const { stdout: tip } = await ex("git", ["rev-parse", "main"], { cwd: root });
    expect(tip.trim()).toBe(target);
    const { stdout: file } = await ex("git", ["show", "main:f.txt"], { cwd: root });
    expect(file).toContain("more");
  });

  it("safely skips (no data loss) when fast-forward is impossible (divergence)", async () => {
    const root = await repo();
    const target = await commitOnNewBranch(root, "feat", "base\nfeatside\n");
    await ex("git", ["checkout", "main"], { cwd: root });
    // Diverge main so target is no longer a descendant.
    await writeFile(path.join(root, "f.txt"), "base\nmainside\n", "utf8");
    await ex("git", ["commit", "-am", "c-main"], { cwd: root });
    const { stdout: before } = await ex("git", ["rev-parse", "main"], { cwd: root });

    const res = await syncMainCheckout({ rootRepoPath: root, baseBranch: "main", targetCommit: target });
    expect(res.synced).toBe(false);
    expect(res.reason).toBe("non-fast-forward");

    // Base unchanged + no merge/conflict state left behind.
    const { stdout: after } = await ex("git", ["rev-parse", "main"], { cwd: root });
    expect(after.trim()).toBe(before.trim());
    const { stdout: porcelain } = await ex("git", ["status", "--porcelain"], { cwd: root });
    expect(porcelain.trim()).toBe("");
  });

  it("skips when the base branch is not the checked-out branch", async () => {
    const root = await repo();
    const target = await commitOnNewBranch(root, "feat", "base\nx\n");
    // Stay on `feat` (base `main` is NOT checked out).
    const res = await syncMainCheckout({ rootRepoPath: root, baseBranch: "main", targetCommit: target });
    expect(res.synced).toBe(false);
    expect(res.reason).toBe("base-branch-not-checked-out");
  });

  it("skips (no clobber) when the working tree is dirty", async () => {
    const root = await repo();
    const target = await commitOnNewBranch(root, "feat", "base\ny\n");
    await ex("git", ["checkout", "main"], { cwd: root });
    await writeFile(path.join(root, "f.txt"), "local uncommitted edit\n", "utf8");

    const res = await syncMainCheckout({ rootRepoPath: root, baseBranch: "main", targetCommit: target });
    expect(res.synced).toBe(false);
    expect(res.reason).toBe("working-tree-dirty");
    // The local edit is preserved.
    const { stdout: porcelain } = await ex("git", ["status", "--porcelain"], { cwd: root });
    expect(porcelain).toContain("f.txt");
  });

  it("no-ops with no target commit", async () => {
    const root = await repo();
    const res = await syncMainCheckout({ rootRepoPath: root, baseBranch: "main" });
    expect(res).toEqual({ synced: false, reason: "no-target" });
  });
});
