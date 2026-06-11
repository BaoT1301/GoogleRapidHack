import { execFile } from "node:child_process";
import { lstat, readdir, realpath, rm, statfs } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { sanitizeWorktreeSegment } from "./worktree-manager";

const execFileAsync = promisify(execFile);
const GIB = 1024 * 1024 * 1024;

export type StorageWarningLevel = "ok" | "low" | "critical";

export interface RuntimeStorageDisk {
  freeBytes: number;
  totalBytes: number;
  warningLevel: StorageWarningLevel;
}

export interface RuntimeStorageMergeWorktree {
  worktreePath: string;
  bytes: number;
  branchName?: string;
}

export interface RuntimeStorageNode {
  nodeId: string;
  agentWorktreePath: string;
  agentWorktreeBytes: number;
  agentBranchName?: string;
  dirtyAgentWorktree: boolean;
  mergeWorktreeBytes: number;
  mergeWorktrees: RuntimeStorageMergeWorktree[];
  mergeBranches: string[];
  hasIsolatedMergeResults: boolean;
}

export interface RuntimeStorageRun {
  runId: string;
  bytes: number;
  agentWorktreeCount: number;
  agentWorktreeBytes: number;
  mergeWorktreeCount: number;
  mergeWorktreeBytes: number;
  tempBytes: number;
  nodeIds: string[];
  dirtyAgentWorktrees: boolean;
  hasIsolatedMergeResults: boolean;
  nodes: RuntimeStorageNode[];
}

export interface RuntimeStorageSummary {
  rootRepoPath: string;
  orchestratorRoot: string;
  disk: RuntimeStorageDisk;
  totals: {
    runtimeBytes: number;
    agentWorktreeBytes: number;
    mergeWorktreeBytes: number;
    tempBytes: number;
    agentWorktreeCount: number;
    mergeWorktreeCount: number;
  };
  runs: RuntimeStorageRun[];
}

export interface RuntimeCleanupRequest {
  rootRepoPath: string;
  scope: "node" | "run";
  runId: string;
  nodeId?: string;
  confirm: true;
  discardAgentChanges?: boolean;
  discardMergeResults?: boolean;
}

export interface RuntimeCleanupResponse {
  status: "cleaned";
  runId: string;
  nodeId?: string;
  removedWorktrees: string[];
  deletedBranches: string[];
  reclaimedBytes: number;
  warnings: string[];
  storage: RuntimeStorageSummary;
}

export interface RuntimeMergedCleanupCheck {
  name: string;
  passed: boolean;
  message?: string;
}

export interface RuntimeMergedCleanupMergeMetadata {
  status?: string;
  targetBranch?: string;
  sourceBranch?: string;
  strategy?: "no-ff" | "squash" | string;
  appliedAt?: string;
  mergeCommit?: string;
  conflictFiles?: string[];
}

export interface RuntimeMergedCleanupPreviewRequest {
  ownerId: string;
  rootRepoPath: string;
  runId: string;
  nodeId: string;
  targetBranch: string;
  sourceBranch?: string;
  worktreePath?: string;
  nodeStatus?: string;
  merge?: RuntimeMergedCleanupMergeMetadata;
  discardMergeResults?: boolean;
  forceBranchDelete?: boolean;
}

export interface RuntimeMergedCleanupPreviewResponse {
  status: "preview_ready" | "refused" | "failed";
  checks: RuntimeMergedCleanupCheck[];
  runId: string;
  nodeId: string;
  targetBranch: string;
  sourceBranch?: string;
  worktreePath?: string;
  wouldRemoveWorktree: boolean;
  wouldDeleteBranch: boolean;
  wouldRemoveMergeWorktrees: boolean;
  warnings: string[];
  message: string;
}

export interface RuntimeMergedCleanupApplyRequest extends RuntimeMergedCleanupPreviewRequest {
  confirm: true;
}

export interface RuntimeMergedCleanupApplyResponse {
  status: "cleaned" | "refused" | "failed";
  checks: RuntimeMergedCleanupCheck[];
  runId: string;
  nodeId: string;
  targetBranch: string;
  sourceBranch?: string;
  worktreePath?: string;
  removedWorktree: boolean;
  deletedBranch: boolean;
  removedMergeWorktrees: string[];
  deletedMergeBranches: string[];
  warnings: string[];
  message: string;
}

interface ProcessStateReader {
  getProcessState(runId: string, nodeId: string): "not_found" | "running";
}

interface RegisteredWorktree {
  worktreePath: string;
  branchName?: string;
}

export class RuntimeCleanupConflictError extends Error {}

export function classifyStorageWarning(freeBytes: number): StorageWarningLevel {
  if (freeBytes < 2 * GIB) {
    return "critical";
  }

  if (freeBytes < 5 * GIB) {
    return "low";
  }

  return "ok";
}

export class RuntimeStorageManager {
  constructor(private readonly processManager: ProcessStateReader) {}

  async inspect(rootRepoPath: string): Promise<RuntimeStorageSummary> {
    const normalizedRoot = await this.normalizeRootRepo(rootRepoPath);
    return this.inspectNormalized(normalizedRoot);
  }

  async previewMergedCleanup(
    input: RuntimeMergedCleanupPreviewRequest
  ): Promise<RuntimeMergedCleanupPreviewResponse> {
    const checks: RuntimeMergedCleanupCheck[] = [];
    const warnings: string[] = [];

    try {
      if (!input.ownerId) {
        addCheck(checks, "owner scoped request", false, "ownerId is required for internal cleanup preview.");
      } else {
        addCheck(checks, "owner scoped request", true);
      }

      const runId = safeIdForPreview(input.runId, "runId", checks);
      const nodeId = safeIdForPreview(input.nodeId, "nodeId", checks);
      const rootRepoPath = await this.normalizeRootRepo(input.rootRepoPath);
      addCheck(checks, "root repository", true, "rootRepoPath is absolute and points to a Git repository.");

      const targetBranch = input.targetBranch.trim();
      const sourceBranch = input.sourceBranch?.trim() || `agent/${runId}/${nodeId}`;
      const worktreePath = path.resolve(
        input.worktreePath || path.join(rootRepoPath, ".orchestrator", "worktrees", runId, nodeId)
      );
      const expectedWorktreePath = path.join(rootRepoPath, ".orchestrator", "worktrees", runId, nodeId);
      const expectedSourceBranch = `agent/${runId}/${nodeId}`;

      const terminal = isTerminalNodeStatus(input.nodeStatus);
      addCheck(
        checks,
        "node terminal",
        terminal,
        terminal
          ? `node status is terminal: ${input.nodeStatus ?? "unknown"}`
          : `node status must be terminal before cleanup; received ${input.nodeStatus ?? "unknown"}.`
      );

      const processIdle = this.processManager.getProcessState(runId, nodeId) !== "running";
      addCheck(
        checks,
        "node subprocess idle",
        processIdle,
        processIdle ? "no active subprocess is registered." : "node subprocess is still running."
      );

      const underExpectedWorktree = isPathInside(worktreePath, expectedWorktreePath);
      addCheck(
        checks,
        "agent worktree path",
        underExpectedWorktree,
        underExpectedWorktree
          ? "worktreePath is under the expected runtime worktree path."
          : `worktreePath must be under ${expectedWorktreePath}.`
      );

      const sourceStartsAgent = sourceBranch.startsWith("agent/");
      addCheck(
        checks,
        "source branch namespace",
        sourceStartsAgent,
        sourceStartsAgent ? "source branch is in the agent namespace." : "source branch must start with agent/."
      );

      const sourceMatchesExpected = sourceBranch === expectedSourceBranch;
      addCheck(
        checks,
        "source branch identity",
        sourceMatchesExpected,
        sourceMatchesExpected
          ? "source branch matches the selected run/node."
          : `source branch must be ${expectedSourceBranch}.`
      );

      const sourceExists = await branchExists(rootRepoPath, sourceBranch);
      addCheck(
        checks,
        "source branch exists",
        sourceExists,
        sourceExists ? "source branch exists locally." : `source branch was not found locally: ${sourceBranch}.`
      );

      const targetExists = await branchExists(rootRepoPath, targetBranch);
      addCheck(
        checks,
        "target branch exists",
        targetExists,
        targetExists ? "target branch exists locally." : `target branch was not found locally: ${targetBranch}.`
      );

      const dirtyWorktree = await isDirtyWorktree(worktreePath);
      addCheck(
        checks,
        "agent worktree clean",
        !dirtyWorktree,
        dirtyWorktree
          ? "dirty agent worktrees are refused for merged cleanup."
          : "agent worktree has no uncommitted edits."
      );

      if (input.merge?.status === "conflicted" || (input.merge?.conflictFiles?.length ?? 0) > 0) {
        addCheck(
          checks,
          "no preserved merge conflict",
          false,
          "conflicted merge results are preserved and cannot be removed by merged cleanup preview."
        );
      } else {
        addCheck(checks, "no preserved merge conflict", true);
      }

      const proof = await proveMergedBranch({
        rootRepoPath,
        sourceBranch,
        targetBranch,
        merge: input.merge,
      });
      addCheck(checks, "merge proof", proof.passed, proof.message);
      warnings.push(...proof.warnings);

      const mergeResults = await inspectMergeWorktrees(
        path.join(rootRepoPath, ".orchestrator", "merge-worktrees", runId, nodeId),
        await listRegisteredWorktrees(rootRepoPath)
      );
      const mergeBranches = (await listRuntimeBranches(rootRepoPath))
        .filter((branch) => branch.startsWith(`merge/${runId}/${nodeId}/`));
      const hasMergeResults = mergeResults.length > 0 || mergeBranches.length > 0;
      const wouldRemoveMergeWorktrees =
        Boolean(input.discardMergeResults) &&
        hasMergeResults &&
        input.merge?.status !== "conflicted";

      if (hasMergeResults && !input.discardMergeResults) {
        warnings.push("Isolated merge results exist and would be preserved unless discardMergeResults is requested.");
      }

      if (input.forceBranchDelete) {
        warnings.push("forceBranchDelete was requested, but preview still requires merge proof before branch deletion.");
      }

      const refused = checks.some((check) => !check.passed);
      const status: RuntimeMergedCleanupPreviewResponse["status"] = refused ? "refused" : "preview_ready";

      return {
        status,
        checks,
        runId,
        nodeId,
        targetBranch,
        sourceBranch,
        worktreePath,
        wouldRemoveWorktree: !refused,
        wouldDeleteBranch: !refused,
        wouldRemoveMergeWorktrees,
        warnings,
        message: refused
          ? "Merged cleanup preview refused. No Git state was modified."
          : "Merged cleanup preview is ready. No Git state was modified."
      };
    } catch (error) {
      return {
        status: "failed",
        checks,
        runId: input.runId,
        nodeId: input.nodeId,
        targetBranch: input.targetBranch,
        sourceBranch: input.sourceBranch,
        worktreePath: input.worktreePath,
        wouldRemoveWorktree: false,
        wouldDeleteBranch: false,
        wouldRemoveMergeWorktrees: false,
        warnings,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async applyMergedCleanup(
    input: RuntimeMergedCleanupApplyRequest
  ): Promise<RuntimeMergedCleanupApplyResponse> {
    if (input.confirm !== true) {
      return {
        status: "refused",
        checks: [{ name: "explicit confirmation", passed: false, message: "Merged cleanup apply requires confirm: true." }],
        runId: input.runId,
        nodeId: input.nodeId,
        targetBranch: input.targetBranch,
        sourceBranch: input.sourceBranch,
        worktreePath: input.worktreePath,
        removedWorktree: false,
        deletedBranch: false,
        removedMergeWorktrees: [],
        deletedMergeBranches: [],
        warnings: [],
        message: "Merged cleanup apply refused. No Git state was modified."
      };
    }

    const preview = await this.previewMergedCleanup(input);
    const checks = [...preview.checks];
    const warnings = [...preview.warnings];

    if (preview.status !== "preview_ready") {
      return {
        status: preview.status === "failed" ? "failed" : "refused",
        checks,
        runId: input.runId,
        nodeId: input.nodeId,
        targetBranch: input.targetBranch,
        sourceBranch: preview.sourceBranch,
        worktreePath: preview.worktreePath,
        removedWorktree: false,
        deletedBranch: false,
        removedMergeWorktrees: [],
        deletedMergeBranches: [],
        warnings,
        message: "Merged cleanup apply refused because preview safety checks did not pass."
      };
    }

    const rootRepoPath = await this.normalizeRootRepo(input.rootRepoPath);
    const runId = assertSafeId(input.runId, "runId");
    const nodeId = assertSafeId(input.nodeId, "nodeId");
    const sourceBranch = preview.sourceBranch ?? `agent/${runId}/${nodeId}`;
    const worktreePath = preview.worktreePath ?? path.join(rootRepoPath, ".orchestrator", "worktrees", runId, nodeId);
    const targetBranch = preview.targetBranch;
    const sourceIsAncestor = await branchIsAncestor(rootRepoPath, sourceBranch, targetBranch);
    const canForceDelete = Boolean(input.forceBranchDelete) && mergeMetadataProvesMerged(input.merge, sourceBranch, targetBranch);
    const canDeleteBranch = sourceIsAncestor || canForceDelete;
    addCheck(
      checks,
      "branch deletion mode",
      canDeleteBranch,
      sourceIsAncestor
        ? "source branch can be deleted with git branch -d."
        : canForceDelete
          ? "source branch requires explicit force deletion and merge metadata proves it was merged."
          : "source branch is not an ancestor of target; pass forceBranchDelete with proven merge metadata to delete it."
    );

    if (!canDeleteBranch) {
      return {
        status: "refused",
        checks,
        runId,
        nodeId,
        targetBranch,
        sourceBranch,
        worktreePath,
        removedWorktree: false,
        deletedBranch: false,
        removedMergeWorktrees: [],
        deletedMergeBranches: [],
        warnings,
        message: "Merged cleanup apply refused before mutation. No Git state was modified."
      };
    }

    const removedMergeWorktrees: string[] = [];
    const deletedMergeBranches: string[] = [];
    let removedWorktree = false;
    let deletedBranch = false;

    try {
      await runGit(rootRepoPath, ["worktree", "prune"]);

      assertDerivedAgentWorktreePath(rootRepoPath, runId, nodeId, worktreePath);
      if (await pathExists(worktreePath)) {
        await runGit(rootRepoPath, ["worktree", "remove", worktreePath]);
        removedWorktree = true;
      }

      if (await branchExists(rootRepoPath, sourceBranch)) {
        const deleteFlag = canForceDelete && !sourceIsAncestor ? "-D" : "-d";
        await runGit(rootRepoPath, ["branch", deleteFlag, sourceBranch]);
        deletedBranch = true;
      }

      if (input.discardMergeResults === true) {
        if (input.merge?.status === "conflicted" || (input.merge?.conflictFiles?.length ?? 0) > 0) {
          warnings.push("Conflicted merge results were preserved.");
        } else {
          const registered = await listRegisteredWorktrees(rootRepoPath);
          const mergeRoot = path.join(rootRepoPath, ".orchestrator", "merge-worktrees", runId, nodeId);
          const mergeWorktrees = await inspectMergeWorktrees(mergeRoot, registered);

          for (const mergeWorktree of mergeWorktrees) {
            assertDerivedMergeWorktreePath(rootRepoPath, runId, nodeId, mergeWorktree.worktreePath);
            if (await pathExists(mergeWorktree.worktreePath)) {
              if (registered.has(await canonicalPath(mergeWorktree.worktreePath))) {
                await runGit(rootRepoPath, ["worktree", "remove", mergeWorktree.worktreePath]);
              }
              await removeDerivedOrchestratorPath(rootRepoPath, mergeWorktree.worktreePath, {
                recursive: true,
                force: true
              });
              removedMergeWorktrees.push(mergeWorktree.worktreePath);
            }
          }

          const mergeBranches = (await listRuntimeBranches(rootRepoPath))
            .filter((branch) => branch.startsWith(`merge/${runId}/${nodeId}/`));
          for (const branch of mergeBranches) {
            if (!isExpectedRuntimeBranch(branch, runId, nodeId)) {
              throw new Error(`Refusing to delete unexpected merge branch ${branch}.`);
            }
            await runGit(rootRepoPath, ["branch", "-d", branch]);
            deletedMergeBranches.push(branch);
          }
        }
      }

      await runGit(rootRepoPath, ["worktree", "prune"]);

      return {
        status: "cleaned",
        checks,
        runId,
        nodeId,
        targetBranch,
        sourceBranch,
        worktreePath,
        removedWorktree,
        deletedBranch,
        removedMergeWorktrees,
        deletedMergeBranches,
        warnings,
        message: "Merged runtime artifacts were cleaned. The main checkout was not modified."
      };
    } catch (error) {
      return {
        status: "failed",
        checks,
        runId,
        nodeId,
        targetBranch,
        sourceBranch,
        worktreePath,
        removedWorktree,
        deletedBranch,
        removedMergeWorktrees,
        deletedMergeBranches,
        warnings,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async cleanup(input: RuntimeCleanupRequest): Promise<RuntimeCleanupResponse> {
    if (input.confirm !== true) {
      throw new Error("Runtime cleanup requires confirm: true.");
    }

    const rootRepoPath = await this.normalizeRootRepo(input.rootRepoPath);
    const runId = assertSafeId(input.runId, "runId");
    const nodeId = input.scope === "node"
      ? assertSafeId(input.nodeId ?? "", "nodeId")
      : undefined;
    const before = await this.inspectNormalized(rootRepoPath);
    const run = before.runs.find((candidate) => candidate.runId === runId);

    if (!run) {
      throw new Error(`Runtime artifacts were not found for run ${runId}.`);
    }

    const nodes = nodeId
      ? run.nodes.filter((candidate) => candidate.nodeId === nodeId)
      : run.nodes;

    if (nodes.length === 0) {
      throw new Error(`Runtime artifacts were not found for node ${nodeId}.`);
    }

    for (const node of nodes) {
      if (this.processManager.getProcessState(runId, node.nodeId) === "running") {
        throw new RuntimeCleanupConflictError(
          `Cannot clean ${runId}/${node.nodeId} while its subprocess is still running. Cancel it first.`
        );
      }
    }

    const dirtyNodes = nodes.filter((node) => node.dirtyAgentWorktree);
    if (dirtyNodes.length > 0 && input.discardAgentChanges !== true) {
      throw new RuntimeCleanupConflictError(
        `Cleanup would discard uncommitted agent edits for: ${dirtyNodes.map((node) => node.nodeId).join(", ")}. Retry with discardAgentChanges: true.`
      );
    }

    const mergeNodes = nodes.filter((node) => node.hasIsolatedMergeResults);
    if (mergeNodes.length > 0 && input.discardMergeResults !== true) {
      throw new RuntimeCleanupConflictError(
        `Cleanup would discard isolated merge results for: ${mergeNodes.map((node) => node.nodeId).join(", ")}. Retry with discardMergeResults: true.`
      );
    }

    const orchestratorRoot = path.join(rootRepoPath, ".orchestrator");
    const registered = await listRegisteredWorktrees(rootRepoPath);
    const removedWorktrees: string[] = [];
    const deletedBranches: string[] = [];

    for (const node of nodes) {
      await removeRuntimeWorktree(rootRepoPath, node.agentWorktreePath, registered, removedWorktrees);

      for (const mergeWorktree of node.mergeWorktrees) {
        await removeRuntimeWorktree(rootRepoPath, mergeWorktree.worktreePath, registered, removedWorktrees);
      }

      await removeDerivedOrchestratorPath(rootRepoPath, path.join(orchestratorRoot, "merge-worktrees", runId, node.nodeId), {
        recursive: true,
        force: true
      });
      await removeDerivedOrchestratorPath(rootRepoPath, path.join(orchestratorRoot, "tmp", runId, node.nodeId), {
        recursive: true,
        force: true
      });

      const branches = new Set([
        node.agentBranchName,
        ...node.mergeBranches,
        ...node.mergeWorktrees.map((worktree) => worktree.branchName)
      ].filter((branch): branch is string => Boolean(branch)));

      for (const branch of branches) {
        if (!isExpectedRuntimeBranch(branch, runId, node.nodeId)) {
          throw new Error(`Refusing to delete unexpected branch ${branch}.`);
        }

        if (await branchExists(rootRepoPath, branch)) {
          await runGit(rootRepoPath, ["branch", "-D", branch]);
          deletedBranches.push(branch);
        }
      }
    }

    await runGit(rootRepoPath, ["worktree", "prune"]);

    if (input.scope === "run") {
      await removeDerivedOrchestratorPath(rootRepoPath, path.join(orchestratorRoot, "worktrees", runId), { recursive: true, force: true });
      await removeDerivedOrchestratorPath(rootRepoPath, path.join(orchestratorRoot, "merge-worktrees", runId), { recursive: true, force: true });
      await removeDerivedOrchestratorPath(rootRepoPath, path.join(orchestratorRoot, "tmp", runId), { recursive: true, force: true });
    }

    const storage = await this.inspectNormalized(rootRepoPath);
    const warnings: string[] = [];
    if (dirtyNodes.length > 0) {
      warnings.push("Discarded uncommitted agent worktree edits after explicit confirmation.");
    }
    if (mergeNodes.length > 0) {
      warnings.push("Discarded isolated merge results after explicit confirmation.");
    }

    return {
      status: "cleaned",
      runId,
      nodeId,
      removedWorktrees,
      deletedBranches,
      reclaimedBytes: Math.max(0, before.totals.runtimeBytes - storage.totals.runtimeBytes),
      warnings,
      storage
    };
  }

  private async normalizeRootRepo(rootRepoPath: string): Promise<string> {
    if (!path.isAbsolute(rootRepoPath)) {
      throw new Error("rootRepoPath must be an absolute path.");
    }

    const normalized = path.resolve(rootRepoPath);
    const result = await runGit(normalized, ["rev-parse", "--is-inside-work-tree"]);
    if (result.stdout.trim() !== "true") {
      throw new Error(`rootRepoPath is not a Git repository: ${normalized}`);
    }

    return normalized;
  }

  private async inspectNormalized(rootRepoPath: string): Promise<RuntimeStorageSummary> {
    const orchestratorRoot = path.join(rootRepoPath, ".orchestrator");
    const worktreesRoot = path.join(orchestratorRoot, "worktrees");
    const mergeWorktreesRoot = path.join(orchestratorRoot, "merge-worktrees");
    const tempRoot = path.join(orchestratorRoot, "tmp");
    const registered = await listRegisteredWorktrees(rootRepoPath);
    const branches = await listRuntimeBranches(rootRepoPath);
    const runIds = new Set([
      ...await listChildDirectories(worktreesRoot),
      ...await listChildDirectories(mergeWorktreesRoot),
      ...await listChildDirectories(tempRoot),
      ...branches.map((branch) => branch.split("/")[1]).filter(Boolean)
    ]);
    const runs: RuntimeStorageRun[] = [];

    for (const runId of [...runIds].sort()) {
      const nodeIds = new Set([
        ...await listChildDirectories(path.join(worktreesRoot, runId)),
        ...await listChildDirectories(path.join(mergeWorktreesRoot, runId)),
        ...await listChildDirectories(path.join(tempRoot, runId)),
        ...branches
          .filter((branch) => branch.startsWith(`agent/${runId}/`) || branch.startsWith(`merge/${runId}/`))
          .map((branch) => branch.split("/")[2])
          .filter(Boolean)
      ]);
      const nodes: RuntimeStorageNode[] = [];

      for (const nodeId of [...nodeIds].sort()) {
        const agentWorktreePath = path.join(worktreesRoot, runId, nodeId);
        const agentWorktreeBytes = await directorySize(agentWorktreePath);
        const agentBranchName = registered.get(await canonicalPath(agentWorktreePath))?.branchName
          ?? branches.find((branch) => branch === `agent/${runId}/${nodeId}`);
        const mergeWorktrees = await inspectMergeWorktrees(
          path.join(mergeWorktreesRoot, runId, nodeId),
          registered
        );
        const mergeBranches = branches.filter((branch) => branch.startsWith(`merge/${runId}/${nodeId}/`));

        nodes.push({
          nodeId,
          agentWorktreePath,
          agentWorktreeBytes,
          agentBranchName,
          dirtyAgentWorktree: await isDirtyWorktree(agentWorktreePath),
          mergeWorktreeBytes: mergeWorktrees.reduce((total, worktree) => total + worktree.bytes, 0),
          mergeWorktrees,
          mergeBranches,
          hasIsolatedMergeResults: mergeWorktrees.length > 0 || mergeBranches.length > 0
        });
      }

      const tempBytes = await directorySize(path.join(tempRoot, runId));
      const agentWorktreeBytes = nodes.reduce((total, node) => total + node.agentWorktreeBytes, 0);
      const mergeWorktreeBytes = nodes.reduce((total, node) => total + node.mergeWorktreeBytes, 0);

      runs.push({
        runId,
        bytes: agentWorktreeBytes + mergeWorktreeBytes + tempBytes,
        agentWorktreeCount: nodes.filter((node) => node.agentWorktreeBytes > 0).length,
        agentWorktreeBytes,
        mergeWorktreeCount: nodes.reduce((total, node) => total + node.mergeWorktrees.length, 0),
        mergeWorktreeBytes,
        tempBytes,
        nodeIds: nodes.map((node) => node.nodeId),
        dirtyAgentWorktrees: nodes.some((node) => node.dirtyAgentWorktree),
        hasIsolatedMergeResults: nodes.some((node) => node.hasIsolatedMergeResults),
        nodes
      });
    }

    const fileSystem = await statfs(rootRepoPath);
    const freeBytes = fileSystem.bavail * fileSystem.bsize;
    const totalBytes = fileSystem.blocks * fileSystem.bsize;

    return {
      rootRepoPath,
      orchestratorRoot,
      disk: {
        freeBytes,
        totalBytes,
        warningLevel: classifyStorageWarning(freeBytes)
      },
      totals: {
        runtimeBytes: runs.reduce((total, run) => total + run.bytes, 0),
        agentWorktreeBytes: runs.reduce((total, run) => total + run.agentWorktreeBytes, 0),
        mergeWorktreeBytes: runs.reduce((total, run) => total + run.mergeWorktreeBytes, 0),
        tempBytes: runs.reduce((total, run) => total + run.tempBytes, 0),
        agentWorktreeCount: runs.reduce((total, run) => total + run.agentWorktreeCount, 0),
        mergeWorktreeCount: runs.reduce((total, run) => total + run.mergeWorktreeCount, 0)
      },
      runs
    };
  }
}

function assertSafeId(value: string, field: string): string {
  try {
    if (!value || sanitizeWorktreeSegment(value) !== value) {
      throw new Error("unsafe");
    }
  } catch {
    throw new Error(`${field} must already be a safe runtime identifier.`);
  }

  return value;
}

function safeIdForPreview(
  value: string,
  field: string,
  checks: RuntimeMergedCleanupCheck[]
): string {
  try {
    const safe = assertSafeId(value, field);
    addCheck(checks, `${field} safety`, true);
    return safe;
  } catch (error) {
    addCheck(checks, `${field} safety`, false, error instanceof Error ? error.message : String(error));
    return sanitizeWorktreeSegment(value || field);
  }
}

function addCheck(
  checks: RuntimeMergedCleanupCheck[],
  name: string,
  passed: boolean,
  message?: string
): void {
  checks.push({ name, passed, message });
}

function isTerminalNodeStatus(status: string | undefined): boolean {
  return new Set(["success", "failed", "cancelled", "skipped", "blocked"]).has(status ?? "");
}

function mergeMetadataProvesMerged(
  merge: RuntimeMergedCleanupMergeMetadata | undefined,
  sourceBranch: string,
  targetBranch: string
): boolean {
  return (
    merge?.status === "merged" &&
    merge.targetBranch === targetBranch &&
    merge.sourceBranch === sourceBranch &&
    Boolean(merge.appliedAt) &&
    Boolean(merge.mergeCommit)
  );
}

async function proveMergedBranch(input: {
  rootRepoPath: string;
  sourceBranch: string;
  targetBranch: string;
  merge?: RuntimeMergedCleanupMergeMetadata;
}): Promise<{ passed: boolean; message: string; warnings: string[] }> {
  const warnings: string[] = [];
  const strategy = input.merge?.strategy;

  if (strategy === "no-ff") {
    const ancestor = await branchIsAncestor(input.rootRepoPath, input.sourceBranch, input.targetBranch);
    return {
      passed: ancestor,
      message: ancestor
        ? "no-ff merge proof passed: source branch is an ancestor of target branch."
        : "no-ff merge proof failed: source branch is not an ancestor of target branch.",
      warnings
    };
  }

  if (strategy === "squash") {
    const metadataMatches =
      input.merge?.status === "merged" &&
      input.merge.targetBranch === input.targetBranch &&
      input.merge.sourceBranch === input.sourceBranch &&
      input.merge.strategy === "squash" &&
      Boolean(input.merge.appliedAt) &&
      Boolean(input.merge.mergeCommit);

    return {
      passed: metadataMatches,
      message: metadataMatches
        ? "squash merge proof passed using recorded successful merge metadata."
        : "squash cleanup requires successful merge metadata for the same source and target branch.",
      warnings
    };
  }

  const ancestor = await branchIsAncestor(input.rootRepoPath, input.sourceBranch, input.targetBranch);
  if (!ancestor) {
    warnings.push("Merge strategy was missing or unknown, so cleanup was refused unless Git ancestry could prove the source was merged.");
  }

  return {
    passed: ancestor,
    message: ancestor
      ? "merge proof passed via Git ancestry."
      : "merge proof failed: missing/unknown merge strategy and source branch is not an ancestor of target branch.",
    warnings
  };
}

async function branchIsAncestor(
  rootRepoPath: string,
  sourceBranch: string,
  targetBranch: string
): Promise<boolean> {
  try {
    await runGit(rootRepoPath, ["merge-base", "--is-ancestor", sourceBranch, targetBranch]);
    return true;
  } catch {
    return false;
  }
}

async function inspectMergeWorktrees(
  nodeRoot: string,
  registered: Map<string, RegisteredWorktree>
): Promise<RuntimeStorageMergeWorktree[]> {
  const worktrees: RuntimeStorageMergeWorktree[] = [];
  for (const directory of await listChildDirectories(nodeRoot)) {
    const worktreePath = path.join(nodeRoot, directory);
    worktrees.push({
      worktreePath,
      bytes: await directorySize(worktreePath),
      branchName: registered.get(await canonicalPath(worktreePath))?.branchName
    });
  }
  return worktrees;
}

async function removeRuntimeWorktree(
  rootRepoPath: string,
  worktreePath: string,
  registered: Map<string, RegisteredWorktree>,
  removedWorktrees: string[]
): Promise<void> {
  assertDerivedOrchestratorPath(rootRepoPath, worktreePath);

  if (registered.has(await canonicalPath(worktreePath))) {
    await runGit(rootRepoPath, ["worktree", "remove", "--force", worktreePath]);
    removedWorktrees.push(worktreePath);
  }

  await removeDerivedOrchestratorPath(rootRepoPath, worktreePath, { recursive: true, force: true });
}

async function removeDerivedOrchestratorPath(
  rootRepoPath: string,
  targetPath: string,
  options: { recursive: true; force: true }
): Promise<void> {
  assertDerivedOrchestratorPath(rootRepoPath, targetPath);
  await rm(targetPath, options);
}

function assertDerivedOrchestratorPath(rootRepoPath: string, targetPath: string): void {
  const resolved = path.resolve(targetPath);
  const allowedRoots = [
    path.join(rootRepoPath, ".orchestrator", "worktrees"),
    path.join(rootRepoPath, ".orchestrator", "merge-worktrees"),
    path.join(rootRepoPath, ".orchestrator", "tmp")
  ];

  if (!allowedRoots.some((root) => isPathInside(resolved, root))) {
    throw new Error(`Refusing to delete path outside runtime .orchestrator artifacts: ${resolved}`);
  }
}

function assertDerivedAgentWorktreePath(
  rootRepoPath: string,
  runId: string,
  nodeId: string,
  targetPath: string
): void {
  const resolved = path.resolve(targetPath);
  const expectedRoot = path.join(rootRepoPath, ".orchestrator", "worktrees", runId, nodeId);
  if (!isPathInside(resolved, expectedRoot)) {
    throw new Error(`Refusing to clean agent worktree outside ${expectedRoot}: ${resolved}`);
  }
}

function assertDerivedMergeWorktreePath(
  rootRepoPath: string,
  runId: string,
  nodeId: string,
  targetPath: string
): void {
  const resolved = path.resolve(targetPath);
  const expectedRoot = path.join(rootRepoPath, ".orchestrator", "merge-worktrees", runId, nodeId);
  if (!isPathInside(resolved, expectedRoot)) {
    throw new Error(`Refusing to clean merge worktree outside ${expectedRoot}: ${resolved}`);
  }
}

function isExpectedRuntimeBranch(branch: string, runId: string, nodeId: string): boolean {
  return branch === `agent/${runId}/${nodeId}` || branch.startsWith(`merge/${runId}/${nodeId}/`);
}

function isPathInside(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function listRegisteredWorktrees(rootRepoPath: string): Promise<Map<string, RegisteredWorktree>> {
  const result = await runGit(rootRepoPath, ["worktree", "list", "--porcelain"]);
  const registered = new Map<string, RegisteredWorktree>();
  let current: RegisteredWorktree | undefined;

  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { worktreePath: await canonicalPath(line.slice("worktree ".length)) };
      registered.set(current.worktreePath, current);
    } else if (line.startsWith("branch refs/heads/") && current) {
      current.branchName = line.slice("branch refs/heads/".length);
    }
  }

  return registered;
}

async function canonicalPath(targetPath: string): Promise<string> {
  try {
    return await realpath(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

async function listRuntimeBranches(rootRepoPath: string): Promise<string[]> {
  const result = await runGit(rootRepoPath, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads/agent",
    "refs/heads/merge"
  ]);
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function branchExists(rootRepoPath: string, branch: string): Promise<boolean> {
  try {
    await runGit(rootRepoPath, ["rev-parse", "--verify", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function isDirtyWorktree(worktreePath: string): Promise<boolean> {
  if (!await pathExists(worktreePath)) {
    return false;
  }

  try {
    const result = await runGit(worktreePath, ["status", "--porcelain", "--untracked-files=all"]);
    return result.stdout.trim().length > 0;
  } catch {
    return true;
  }
}

async function listChildDirectories(directoryPath: string): Promise<string[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }
    throw error;
  }
}

async function directorySize(directoryPath: string): Promise<number> {
  try {
    const entry = await lstat(directoryPath);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      return entry.size;
    }

    const children = await readdir(directoryPath);
    const sizes = await Promise.all(children.map((child) => directorySize(path.join(directoryPath, child))));
    return sizes.reduce((total, size) => total + size, 0);
  } catch (error) {
    if (isMissingPathError(error)) {
      return 0;
    }
    throw error;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${detail}`);
  }
}
