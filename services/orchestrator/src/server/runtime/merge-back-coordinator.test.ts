import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runMergeBack } from "./merge-back-coordinator";

const execFileAsync = promisify(execFile);

// GIT-1: topological auto-merge of agent branches into base + base promotion.
// Uses a real temp git repo and the real GitMergeCoordinator (Do-Not-Invent),
// orchestrated by runMergeBack.
describe("runMergeBack (GIT-1)", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    for (const tempRoot of tempRoots.splice(0)) {
      await removeRuntimeWorktrees(tempRoot);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("merges in topological order and advances base to include each node's changes", async () => {
    const root = await createTempGitRepo();
    tempRoots.push(root);
    await createAgentBranch(root, "run_topo", "A", { "a.txt": "from A\n" });
    await createAgentBranch(root, "run_topo", "B", { "b.txt": "from B\n" });

    const result = await runMergeBack({
      rootRepoPath: root,
      runId: "run_topo",
      baseBranch: "main",
      nodes: [
        { nodeId: "B", branchName: "agent/run_topo/B" },
        { nodeId: "A", branchName: "agent/run_topo/A" },
      ],
      edges: [{ source: "A", target: "B", kind: "flow" }],
    });

    // Topological order: A merged before B (despite the input order).
    expect(result.results.map((r) => r.nodeId)).toEqual(["A", "B"]);
    expect(result.results.every((r) => r.status === "merged" && r.promoted)).toBe(true);

    // Base now contains BOTH nodes' files.
    await expect(showFile(root, "main", "a.txt")).resolves.toContain("from A");
    await expect(showFile(root, "main", "b.txt")).resolves.toContain("from B");
  });

  it("brings the main repo's WORKING TREE forward when base is checked out (not just the ref)", async () => {
    // Regression: promotion used to move only the base ref via update-ref while `main`
    // was checked out, leaving the merged files absent from disk and the tree showing a
    // phantom dirty diff. Promotion is now a ff-only merge in the main repo, so the ref
    // AND the working tree advance together.
    const root = await createTempGitRepo();
    tempRoots.push(root);
    await createAgentBranch(root, "run_wt", "A", { "a.txt": "from A\n" });

    const result = await runMergeBack({
      rootRepoPath: root,
      runId: "run_wt",
      baseBranch: "main",
      nodes: [{ nodeId: "A", branchName: "agent/run_wt/A" }],
      edges: [],
    });
    expect(result.results[0]?.promoted).toBe(true);

    // The merged file is actually ON DISK in the main checkout...
    await expect(readFile(path.join(root, "a.txt"), "utf8")).resolves.toContain("from A");
    // ...and there is no phantom "dirty" desync: no TRACKED-file changes (the old bug
    // left the inverse-of-the-merge as pending changes). Untracked entries like the
    // .orchestrator worktree dir are expected and ignored.
    const trackedChanges = (await runGit(root, ["status", "--porcelain"])).stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0 && !line.startsWith("??"));
    expect(trackedChanges).toEqual([]);
    // HEAD (main) is at the promoted merge commit.
    const head = (await runGit(root, ["rev-parse", "HEAD"])).stdout.trim();
    expect(head).toBe(result.baseTip);
  });

  it("stops a conflicted ancestor's descendants and does NOT advance base past it", async () => {
    const root = await createTempGitRepo({ "shared.txt": "base\n" });
    tempRoots.push(root);
    // A edits shared.txt; B is a descendant of A.
    await createAgentBranch(root, "run_conf", "A", { "shared.txt": "A version\n" });
    await createAgentBranch(root, "run_conf", "B", { "b.txt": "from B\n" });
    // Base also edits shared.txt → A will conflict.
    await runGit(root, ["checkout", "main"]);
    await writeFile(path.join(root, "shared.txt"), "main version\n", "utf8");
    await runGit(root, ["add", "shared.txt"]);
    await runGit(root, ["commit", "-m", "Diverge base on shared.txt"]);
    const baseTipBefore = (await runGit(root, ["rev-parse", "main"])).stdout.trim();

    const result = await runMergeBack({
      rootRepoPath: root,
      runId: "run_conf",
      baseBranch: "main",
      nodes: [
        { nodeId: "A", branchName: "agent/run_conf/A" },
        { nodeId: "B", branchName: "agent/run_conf/B" },
      ],
      edges: [{ source: "A", target: "B", kind: "flow" }],
    });

    const a = result.results.find((r) => r.nodeId === "A");
    const b = result.results.find((r) => r.nodeId === "B");
    expect(a?.status).toBe("conflicted");
    expect(a?.promoted).toBe(false);
    expect(a?.conflictFiles).toContain("shared.txt");
    expect(a?.mergeWorktreePath).toBeTruthy(); // preserved for GIT-3 / reviewer
    // B is a flow-descendant of A → short-circuited, not merged.
    expect(b?.status).toBe("skipped");
    expect(b?.promoted).toBe(false);

    // Base was NOT advanced.
    const baseTipAfter = (await runGit(root, ["rev-parse", "main"])).stdout.trim();
    expect(baseTipAfter).toBe(baseTipBefore);
  });

  it("lands two independent branches and records a pre-merge backup ref of base", async () => {
    const root = await createTempGitRepo();
    tempRoots.push(root);
    await createAgentBranch(root, "run_indep", "X", { "x.txt": "from X\n" });
    await createAgentBranch(root, "run_indep", "Y", { "y.txt": "from Y\n" });
    const originalBaseTip = (await runGit(root, ["rev-parse", "main"])).stdout.trim();

    const result = await runMergeBack({
      rootRepoPath: root,
      runId: "run_indep",
      baseBranch: "main",
      nodes: [
        { nodeId: "X", branchName: "agent/run_indep/X" },
        { nodeId: "Y", branchName: "agent/run_indep/Y" },
      ],
      edges: [],
    });

    expect(result.results.every((r) => r.status === "merged" && r.promoted)).toBe(true);
    await expect(showFile(root, "main", "x.txt")).resolves.toContain("from X");
    await expect(showFile(root, "main", "y.txt")).resolves.toContain("from Y");

    // Backup ref points at the ORIGINAL base tip (restore point).
    expect(result.backupRef).toBe("refs/orch-backup/main/run_indep");
    const backupTip = (await runGit(root, ["rev-parse", result.backupRef as string])).stdout.trim();
    expect(backupTip).toBe(originalBaseTip);
  });

  it("is a no-op for an empty run (no nodes, no backup ref)", async () => {
    const root = await createTempGitRepo();
    tempRoots.push(root);

    const result = await runMergeBack({
      rootRepoPath: root,
      runId: "run_empty",
      baseBranch: "main",
      nodes: [],
      edges: [],
    });

    expect(result.results).toEqual([]);
    expect(result.backupRef).toBeUndefined();
    // No backup ref namespace was created.
    await expect(
      runGit(root, ["rev-parse", "--verify", "refs/orch-backup/main/run_empty"]),
    ).rejects.toThrow();
  });
});

async function createTempGitRepo(
  files: Record<string, string> = { "README.md": "# Temp\n" },
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-mergeback-"));
  await runGit(root, ["init", "-b", "main"]);
  await runGit(root, ["config", "user.email", "test@example.com"]);
  await runGit(root, ["config", "user.name", "Orchestrator Test"]);
  for (const [rel, content] of Object.entries(files)) {
    await writeFile(path.join(root, rel), content, "utf8");
  }
  await runGit(root, ["add", "."]);
  await runGit(root, ["commit", "-m", "Initial commit"]);
  return root;
}

async function createAgentBranch(
  root: string,
  runId: string,
  nodeId: string,
  files: Record<string, string>,
): Promise<void> {
  const branchName = `agent/${runId}/${nodeId}`;
  const worktreePath = path.join(root, ".orchestrator", "worktrees", runId, nodeId);
  await runGit(root, ["worktree", "add", "-b", branchName, worktreePath, "main"]);
  await runGit(worktreePath, ["config", "user.email", "test@example.com"]);
  await runGit(worktreePath, ["config", "user.name", "Orchestrator Test"]);
  for (const [rel, content] of Object.entries(files)) {
    await writeFile(path.join(worktreePath, rel), content, "utf8");
  }
  await runGit(worktreePath, ["add", "."]);
  await runGit(worktreePath, ["commit", "-m", `Agent change ${nodeId}`]);
}

async function showFile(root: string, ref: string, file: string): Promise<string> {
  const { stdout } = await runGit(root, ["show", `${ref}:${file}`]);
  return stdout;
}

async function removeRuntimeWorktrees(root: string): Promise<void> {
  try {
    const { stdout } = await runGit(root, ["worktree", "list", "--porcelain"]);
    const worktrees = stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .filter((wt) => wt.includes(`${path.sep}.orchestrator${path.sep}`));
    for (const worktreePath of worktrees) {
      await runGit(root, ["worktree", "remove", "--force", worktreePath]);
    }
    await runGit(root, ["worktree", "prune"]);
  } catch {
    // best-effort
  }
}

async function runGit(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}
