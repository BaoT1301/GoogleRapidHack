import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  createIntegrationBranch,
  flowParents,
  resolveExecuteAncestors,
  terminalExecuteNodes,
} from "./lineage-coordinator";

const ex = promisify(execFile);

// The owner's example DAG: a→b, a→d, b→c, c→e, d→e, e→f, f→g (all execute).
const NODES = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ id, kind: "execute" }));
const EDGES = [
  { source: "a", target: "b", kind: "flow" },
  { source: "a", target: "d", kind: "flow" },
  { source: "b", target: "c", kind: "flow" },
  { source: "c", target: "e", kind: "flow" },
  { source: "d", target: "e", kind: "flow" },
  { source: "e", target: "f", kind: "flow" },
  { source: "f", target: "g", kind: "flow" },
];

describe("lineage-coordinator — pure helpers", () => {
  it("resolves direct flow-parents", () => {
    expect(flowParents("e", EDGES).sort()).toEqual(["c", "d"]);
    expect(flowParents("a", EDGES)).toEqual([]);
  });

  it("resolves the execute ancestors a node's worktree is seeded from", () => {
    expect(resolveExecuteAncestors("a", NODES, EDGES)).toEqual([]); // root → from base
    expect(resolveExecuteAncestors("b", NODES, EDGES)).toEqual(["a"]); // single parent
    expect(resolveExecuteAncestors("e", NODES, EDGES).sort()).toEqual(["c", "d"]); // convergence
  });

  it("walks UP through a non-execute (gate) parent to the execute ancestors", () => {
    const nodes = [
      { id: "a", kind: "execute" },
      { id: "G", kind: "gate" },
      { id: "b", kind: "execute" },
    ];
    const edges = [
      { source: "a", target: "G", kind: "flow" },
      { source: "G", target: "b", kind: "flow" },
    ];
    expect(resolveExecuteAncestors("b", nodes, edges)).toEqual(["a"]);
    expect(terminalExecuteNodes(nodes, edges)).toEqual(["b"]);
  });

  it("identifies terminal execute nodes (leaves that merge to base)", () => {
    expect(terminalExecuteNodes(NODES, EDGES)).toEqual(["g"]);
  });
});

describe("lineage-coordinator — createIntegrationBranch", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    for (const root of tempRoots.splice(0)) {
      await removeRuntimeWorktrees(root);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("merges parents touching different files into a ready integration branch", async () => {
    const root = await createTempGitRepo();
    tempRoots.push(root);
    await makeBranch(root, "agent/run1/c", { "c.txt": "from c\n" });
    await makeBranch(root, "agent/run1/d", { "d.txt": "from d\n" });

    const res = await createIntegrationBranch({
      rootRepoPath: root,
      runId: "run1",
      nodeId: "e",
      parentBranches: ["agent/run1/c", "agent/run1/d"],
    });

    expect(res.status).toBe("ready");
    expect(res.branch).toBe("integration/run1/e");
    // The integration branch contains BOTH parents' work.
    await expect(showFile(root, res.branch, "c.txt")).resolves.toContain("from c");
    await expect(showFile(root, res.branch, "d.txt")).resolves.toContain("from d");
  });

  it("returns conflicted (worktree preserved) when parents edit the same line", async () => {
    const root = await createTempGitRepo({ "shared.txt": "base\n" });
    tempRoots.push(root);
    await makeBranch(root, "agent/run2/c", { "shared.txt": "c version\n" });
    await makeBranch(root, "agent/run2/d", { "shared.txt": "d version\n" });

    const res = await createIntegrationBranch({
      rootRepoPath: root,
      runId: "run2",
      nodeId: "e",
      parentBranches: ["agent/run2/c", "agent/run2/d"],
    });

    expect(res.status).toBe("conflicted");
    expect(res.conflictFiles).toContain("shared.txt");
    await expect(pathExists(res.worktreePath)).resolves.toBe(true); // preserved for the reviewer
  });
});

async function createTempGitRepo(
  files: Record<string, string> = { "README.md": "# Temp\n" },
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "orch-lineage-"));
  await ex("git", ["init", "-b", "main"], { cwd: root });
  await ex("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await ex("git", ["config", "user.name", "Test"], { cwd: root });
  for (const [rel, content] of Object.entries(files)) {
    await writeFile(path.join(root, rel), content, "utf8");
  }
  await ex("git", ["add", "."], { cwd: root });
  await ex("git", ["commit", "-m", "init"], { cwd: root });
  return root;
}

async function makeBranch(
  root: string,
  branch: string,
  files: Record<string, string>,
): Promise<void> {
  const wt = path.join(root, ".orchestrator", "worktrees", branch.replace(/\//g, "-"));
  await ex("git", ["worktree", "add", "-b", branch, wt, "main"], { cwd: root });
  await ex("git", ["config", "user.email", "test@example.com"], { cwd: wt });
  await ex("git", ["config", "user.name", "Test"], { cwd: wt });
  for (const [rel, content] of Object.entries(files)) {
    await writeFile(path.join(wt, rel), content, "utf8");
  }
  await ex("git", ["add", "."], { cwd: wt });
  await ex("git", ["commit", "-m", `change ${branch}`], { cwd: wt });
}

async function showFile(root: string, ref: string, file: string): Promise<string> {
  const { stdout } = await ex("git", ["show", `${ref}:${file}`], { cwd: root });
  return stdout;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function removeRuntimeWorktrees(root: string): Promise<void> {
  try {
    const { stdout } = await ex("git", ["worktree", "list", "--porcelain"], { cwd: root });
    const worktrees = stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .filter((wt) => wt.includes(`${path.sep}.orchestrator${path.sep}`));
    for (const wt of worktrees) {
      await ex("git", ["worktree", "remove", "--force", wt], { cwd: root });
    }
    await ex("git", ["worktree", "prune"], { cwd: root });
  } catch {
    // best-effort
  }
}
