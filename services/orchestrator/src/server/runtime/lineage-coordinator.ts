// lineage-coordinator — the "stacked branches" merge model (owner's #2 request).
//
// In lineage mode each node's worktree forks from its PARENT branch(es) instead
// of from base, so a node builds on its ancestors' work. A convergence node
// (≥2 execute ancestors) is seeded from an INTEGRATION BRANCH that merges its
// parents. Only terminal/leaf execute nodes are merged into the graph's base
// branch at the end; intermediate branches are pruned. This module owns the pure
// graph helpers + the integration-branch pre-merge; run-executor orchestrates.
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { sanitizeId } from "./git-merge-coordinator";
import { assertSafeGitArgs } from "./git-guard";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;
const GIT_MAX_BUFFER = 20 * 1024 * 1024;

export interface LineageNode {
  id: string;
  kind?: string;
}

export interface LineageEdge {
  source: string;
  target: string;
  kind?: string;
}

const isFlow = (edge: LineageEdge): boolean =>
  edge.kind === undefined || edge.kind === "flow";

/** Direct flow-parents (sources of flow edges targeting `nodeId`). */
export function flowParents(nodeId: string, edges: LineageEdge[]): string[] {
  return edges.filter((e) => isFlow(e) && e.target === nodeId).map((e) => e.source);
}

/** Direct flow-children (targets of flow edges from `nodeId`). */
export function flowChildren(nodeId: string, edges: LineageEdge[]): string[] {
  return edges.filter((e) => isFlow(e) && e.source === nodeId).map((e) => e.target);
}

/**
 * The nearest EXECUTE ancestors feeding `nodeId` — the branches a node's worktree
 * is seeded from. Walks up through non-execute parents (e.g. a `gate`) to the
 * execute nodes that actually carry branches. De-duped, source-order preserved.
 */
export function resolveExecuteAncestors(
  nodeId: string,
  nodes: LineageNode[],
  edges: LineageEdge[],
): string[] {
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const out: string[] = [];
  const seen = new Set<string>();

  const visit = (id: string, guard: Set<string>) => {
    for (const parent of flowParents(id, edges)) {
      if (guard.has(parent)) continue; // cycle guard (flow is acyclic, but be safe)
      guard.add(parent);
      if (kindOf.get(parent) === "execute") {
        if (!seen.has(parent)) {
          seen.add(parent);
          out.push(parent);
        }
      } else {
        visit(parent, guard); // resolve through a non-execute parent
      }
    }
  };

  visit(nodeId, new Set([nodeId]));
  return out;
}

/**
 * Terminal EXECUTE nodes — execute nodes with NO execute node reachable
 * downstream via flow edges. These are the leaves that merge into base; usually
 * a single final node.
 */
export function terminalExecuteNodes(
  nodes: LineageNode[],
  edges: LineageEdge[],
): string[] {
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const executeIds = nodes.filter((n) => n.kind === "execute").map((n) => n.id);

  const hasExecuteDescendant = (id: string): boolean => {
    const stack = [...flowChildren(id, edges)];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      if (kindOf.get(next) === "execute") return true;
      stack.push(...flowChildren(next, edges));
    }
    return false;
  };

  return executeIds.filter((id) => !hasExecuteDescendant(id));
}

export interface IntegrationResult {
  branch: string;
  worktreePath: string;
  status: "ready" | "conflicted" | "failed";
  conflictFiles?: string[];
  message?: string;
}

// Serialize integration-branch creation so concurrent `git worktree add`s in the
// same repo never race on the index lock.
let integrationQueue: Promise<unknown> = Promise.resolve();

/**
 * Create an integration branch `integration/<runId>/<nodeId>` = merge of all
 * `parentBranches`, in a worktree under `.orchestrator/integration-worktrees/`.
 * Returns `ready` (branch points at the clean merge), `conflicted` (worktree
 * preserved with conflict markers for the reviewer), or `failed`. Best-effort —
 * never throws.
 */
export async function createIntegrationBranch(input: {
  rootRepoPath: string;
  runId: string;
  nodeId: string;
  parentBranches: string[];
}): Promise<IntegrationResult> {
  const run = integrationQueue.then(() => createIntegrationBranchUnsafe(input));
  integrationQueue = run.catch(() => undefined);
  return run;
}

async function createIntegrationBranchUnsafe(input: {
  rootRepoPath: string;
  runId: string;
  nodeId: string;
  parentBranches: string[];
}): Promise<IntegrationResult> {
  const rootRepoPath = path.resolve(input.rootRepoPath);
  const runId = sanitizeId(input.runId, "runId");
  const nodeId = sanitizeId(input.nodeId, "nodeId");
  const branch = `integration/${runId}/${nodeId}`;
  const worktreePath = path.join(
    rootRepoPath,
    ".orchestrator",
    "integration-worktrees",
    runId,
    nodeId,
  );
  const [first, ...rest] = input.parentBranches;

  if (!first) {
    return { branch, worktreePath, status: "failed", message: "no parent branches to integrate" };
  }

  try {
    await mkdir(path.dirname(worktreePath), { recursive: true });
    await git(rootRepoPath, ["worktree", "add", "-b", branch, worktreePath, first]);
    await git(worktreePath, ["config", "user.email", "orchestrator@local"]);
    await git(worktreePath, ["config", "user.name", "Orchestrator"]);

    for (const parent of rest) {
      const merge = await gitAllowFail(worktreePath, [
        "merge",
        "--no-edit",
        "--no-ff",
        parent,
      ]);
      if (merge.code !== 0) {
        const conflictFiles = await listConflictFiles(worktreePath);
        if (conflictFiles.length > 0) {
          return {
            branch,
            worktreePath,
            status: "conflicted",
            conflictFiles,
            message: `Integration conflict merging ${parent} (worktree preserved: ${worktreePath})`,
          };
        }
        return {
          branch,
          worktreePath,
          status: "failed",
          message: merge.stderr || `git merge ${parent} failed`,
        };
      }
    }

    return { branch, worktreePath, status: "ready" };
  } catch (error) {
    return {
      branch,
      worktreePath,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function listConflictFiles(worktreePath: string): Promise<string[]> {
  const { stdout } = await git(worktreePath, ["diff", "--name-only", "--diff-filter=U"]);
  return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/**
 * Commit a node's agent edits to its branch so downstream lineage nodes that fork
 * from this branch actually inherit the work (agent changes are otherwise left
 * uncommitted in the worktree). Best-effort; tolerates "nothing to commit".
 */
export async function checkpointWorktree(
  worktreePath: string,
  message: string,
): Promise<void> {
  try {
    await git(worktreePath, ["add", "-A"]);
    await gitAllowFail(worktreePath, ["commit", "-m", message]);
  } catch {
    // best-effort — a checkpoint failure must not break the run.
  }
}

async function git(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  assertSafeGitArgs(args); // SEC-6: lineage integration must never use a destructive op
  const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
    timeout: GIT_TIMEOUT_MS,
  });
  return { stdout, stderr };
}

async function gitAllowFail(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await git(cwd, args);
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.code ?? 1 };
  }
}
