import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { GraphModel } from "@/db/models/graph.model";
import { RunModel } from "@/db/models/run.model";
import { authedProcedure, createTRPCRouter, dbProcedure } from "../init";
import { getAllCliCapabilities } from "../runtime/cli-capabilities";
import { runCodexProbe } from "../runtime/codex-probe";
import { getLoopChildFakeDemoGraph, getRuntimeDemoGraph, RUNTIME_DEMO_GRAPHS } from "../runtime/demo-graphs";
import { GitMergeCoordinator } from "../runtime/git-merge-coordinator";
import type { MergeApplyResponse, MergePreviewResponse } from "../runtime/merge-types";
import {
  RuntimeCleanupConflictError,
  RuntimeStorageManager,
  type RuntimeMergedCleanupApplyResponse,
  type RuntimeMergedCleanupMergeMetadata,
  type RuntimeMergedCleanupPreviewResponse,
} from "../runtime/runtime-storage-manager";
import { sseHub } from "../sse/hub";

const mergeCoordinator = new GitMergeCoordinator();

const mergePreviewInput = z.object({
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  targetBranch: z.string().min(1),
  sourceBranch: z.string().min(1).optional(),
  worktreePath: z.string().min(1).optional(),
});

const mergeApplyInput = mergePreviewInput.extend({
  strategy: z.enum(["no-ff", "squash"]).default("squash"),
  commitMessage: z.string().min(1).optional(),
  runChecks: z.boolean().optional(),
});

const promoteNodeWorktreeInput = mergePreviewInput.extend({
  strategy: z.enum(["no-ff", "squash"]),
  confirm: z.literal(true),
  commitMessage: z.string().min(1).optional(),
  runChecks: z.boolean().optional(),
});

const mergeAbortInput = z.object({
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  targetBranch: z.string().min(1),
  mergeWorktreePath: z.string().min(1).optional(),
});

const storageInspectInput = z.object({
  runId: z.string().min(1),
});

const cleanupInput = z.object({
  scope: z.enum(["node", "run"]),
  runId: z.string().min(1),
  nodeId: z.string().min(1).optional(),
  confirm: z.literal(true),
  discardAgentChanges: z.boolean().optional(),
  discardMergeResults: z.boolean().optional(),
});

const cleanupMergedPreviewInput = z.object({
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  targetBranch: z.string().min(1),
  discardMergeResults: z.boolean().optional(),
  forceBranchDelete: z.boolean().optional(),
});

const cleanupMergedApplyInput = cleanupMergedPreviewInput.extend({
  confirm: z.literal(true),
});

const demoGraphIdInput = z.enum([
  "four_fake_parallel",
  "fake_dependency_chain",
  "one_codex_smoke",
  "multi_cli_codex_gemini",
  "plan_proposal_demo",
  "gate_fan_in_demo",
  "loop_child_graph_demo",
  "mixed_plan_gate_loop_demo",
]);

export const runtimeRouter = createTRPCRouter({
  // Passive local CLI diagnostics only. This must stay cheap: no AI calls,
  // no auth-token reads, and no command execution beyond version checks.
  cliCapabilities: authedProcedure.query(async () => {
    return getAllCliCapabilities();
  }),

  // Explicit opt-in Codex probe. This may consume Codex/LLM quota, so callers
  // should only invoke it after a user action.
  probeCodex: authedProcedure
    .input(z.object({ cwd: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return runCodexProbe(input.cwd);
    }),

  listDemoGraphs: authedProcedure.query(() => {
    assertDemoSeedingAllowed();
    return RUNTIME_DEMO_GRAPHS.map((graph) => ({
      id: graph.id,
      name: graph.name,
      description: graph.description,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      includesCodex: graph.nodes.some((node) => node.data.cli === "codex"),
      includesGemini: graph.nodes.some((node) => node.data.cli === "gemini"),
    }));
  }),

  seedDemoGraph: dbProcedure
    .input(z.object({
      demoGraphId: demoGraphIdInput,
      rootRepoPath: z.string().min(1),
      baseBranch: z.string().min(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertDemoSeedingAllowed();
      const demo = getRuntimeDemoGraph(input.demoGraphId);
      if (!demo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Demo graph not found" });
      }

      let nodes = structuredClone(demo.nodes);
      const edges = structuredClone(demo.edges);

      if (input.demoGraphId === "loop_child_graph_demo" || input.demoGraphId === "mixed_plan_gate_loop_demo") {
        const childDemo = getLoopChildFakeDemoGraph();
        const childGraph = await GraphModel.create({
          graphSpecVersion: "1.0",
          ownerId: ctx.userId,
          name: childDemo.name,
          description: childDemo.description,
          rootRepoPath: input.rootRepoPath,
          baseBranch: input.baseBranch ?? childDemo.baseBranch,
          status: "draft",
          nodes: structuredClone(childDemo.nodes),
          edges: structuredClone(childDemo.edges),
        });
        const childGraphId = childGraph._id.toString();
        nodes = nodes.map((node) =>
          node.kind === "loop"
            ? { ...node, data: { ...node.data, childGraphId } }
            : node,
        );
      }

      const graph = await GraphModel.create({
        graphSpecVersion: "1.0",
        ownerId: ctx.userId,
        name: demo.name,
        description: demo.description,
        rootRepoPath: input.rootRepoPath,
        baseBranch: input.baseBranch ?? demo.baseBranch,
        status: "draft",
        nodes,
        edges,
      });

      return graph.toObject();
    }),

  mergePreview: dbProcedure
    .input(mergePreviewInput)
    .mutation(async ({ ctx, input }) => {
      const owned = await loadOwnedRunNode(input.runId, input.nodeId, ctx.userId);
      const mergeInput = resolveMergeInput(owned, input);

      await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "merge.preview.started", {
        targetBranch: mergeInput.targetBranch,
        sourceBranch: mergeInput.sourceBranch,
      });

      try {
        const result = await mergeCoordinator.previewMerge(mergeInput);
        await persistMergeResult(input.runId, input.nodeId, ctx.userId, "preview", result);
        await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "merge.preview.ready", {
          status: result.status,
          targetBranch: result.targetBranch,
          sourceBranch: result.sourceBranch,
          filesChanged: result.filesChanged,
          patchLength: result.patchLength,
          warnings: result.warnings,
        });
        return result;
      } catch (error) {
        await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "merge.failed", {
          stage: "preview",
          error: errorMessage(error),
        });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: errorMessage(error),
        });
      }
    }),

  mergeApply: dbProcedure
    .input(mergeApplyInput)
    .mutation(async ({ ctx, input }) => {
      const owned = await loadOwnedRunNode(input.runId, input.nodeId, ctx.userId);
      const mergeInput = resolveMergeInput(owned, input);

      await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "merge.started", {
        targetBranch: mergeInput.targetBranch,
        sourceBranch: mergeInput.sourceBranch,
        strategy: input.strategy,
      });

      try {
        const result = await mergeCoordinator.applyMerge({
          ...mergeInput,
          strategy: input.strategy,
          commitMessage: input.commitMessage,
          runChecks: input.runChecks,
        });
        await persistMergeResult(input.runId, input.nodeId, ctx.userId, "apply", result, {
          strategy: input.strategy,
        });

        if (result.status === "conflicted") {
          await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "merge.conflicted", {
            status: result.status,
            targetBranch: result.targetBranch,
            sourceBranch: result.sourceBranch,
            conflictFiles: result.conflictFiles ?? [],
            message: result.message,
          });
          return result;
        }

        if (result.status === "merged") {
          await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "merge.completed", {
            status: result.status,
            targetBranch: result.targetBranch,
            sourceBranch: result.sourceBranch,
            mergeCommit: result.mergeCommit,
            message: result.message,
          });
          return result;
        }

        await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "merge.failed", {
          status: result.status,
          targetBranch: result.targetBranch,
          sourceBranch: result.sourceBranch,
          message: result.message,
        });
        return result;
      } catch (error) {
        await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "merge.failed", {
          stage: "apply",
          error: errorMessage(error),
        });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: errorMessage(error),
        });
      }
    }),

  // Phase 7.2 MVP promotion: explicitly promote one completed node worktree by
  // reusing the Merge Coordinator. This is intentionally one-node only: no
  // batch merge, no conflict resolution, and no remote push.
  promoteNodeWorktree: dbProcedure
    .input(promoteNodeWorktreeInput)
    .mutation(async ({ ctx, input }) => {
      const owned = await loadOwnedRunNode(input.runId, input.nodeId, ctx.userId);
      const mergeInput = resolveMergeInput(owned, input);

      await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "merge.started", {
        targetBranch: mergeInput.targetBranch,
        sourceBranch: mergeInput.sourceBranch,
        strategy: input.strategy,
        promotion: true,
      });

      try {
        const result = await mergeCoordinator.applyMerge({
          ...mergeInput,
          strategy: input.strategy,
          commitMessage: input.commitMessage,
          runChecks: input.runChecks,
        });
        await persistMergeResult(input.runId, input.nodeId, ctx.userId, "apply", result, {
          strategy: input.strategy,
        });
        await persistPromotionResult(input.runId, input.nodeId, ctx.userId, result);

        if (result.status === "conflicted") {
          await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "merge.conflicted", {
            status: result.status,
            targetBranch: result.targetBranch,
            sourceBranch: result.sourceBranch,
            conflictFiles: result.conflictFiles ?? [],
            message: result.message,
            promotion: true,
          });
          return result;
        }

        if (result.status === "merged") {
          await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "merge.completed", {
            status: result.status,
            targetBranch: result.targetBranch,
            sourceBranch: result.sourceBranch,
            mergeCommit: result.mergeCommit,
            message: result.message,
            promotion: true,
          });
          return result;
        }

        await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "merge.failed", {
          status: result.status,
          targetBranch: result.targetBranch,
          sourceBranch: result.sourceBranch,
          message: result.message,
          promotion: true,
        });
        return result;
      } catch (error) {
        await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "merge.failed", {
          stage: "promote",
          error: errorMessage(error),
          promotion: true,
        });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: errorMessage(error),
        });
      }
    }),

  mergeAbort: dbProcedure
    .input(mergeAbortInput)
    .mutation(async ({ ctx, input }) => {
      const owned = await loadOwnedRunNode(input.runId, input.nodeId, ctx.userId);
      const rootRepoPath = rootRepoPathFromRun(owned.run);

      try {
        const result = await mergeCoordinator.abortMerge({
          rootRepoPath,
          targetBranch: input.targetBranch,
          mergeWorktreePath: input.mergeWorktreePath,
        });
        await persistMergeResult(input.runId, input.nodeId, ctx.userId, "abort", result);
        await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "merge.aborted", {
          status: result.status,
          targetBranch: result.targetBranch,
          message: result.message,
        });
        return result;
      } catch (error) {
        await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "merge.failed", {
          stage: "abort",
          error: errorMessage(error),
        });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: errorMessage(error),
        });
      }
    }),

  storageInspect: dbProcedure
    .input(storageInspectInput)
    .query(async ({ ctx, input }) => {
      const run = await loadOwnedRun(input.runId, ctx.userId);
      const manager = await createRuntimeStorageManager();
      return manager.inspect(rootRepoPathFromRun(run));
    }),

  cleanupMergedPreview: dbProcedure
    .input(cleanupMergedPreviewInput)
    .mutation(async ({ ctx, input }) => {
      const owned = await loadOwnedRunNode(input.runId, input.nodeId, ctx.userId);
      const rootRepoPath = rootRepoPathFromRun(owned.run);
      const sourceBranch = stringField(owned.nodeRun.branchName, "branchName");
      const worktreePath = stringField(owned.nodeRun.worktreePath, "worktreePath");
      const nodeStatus = typeof owned.nodeRun.status === "string"
        ? owned.nodeRun.status
        : undefined;
      const merge = mergeMetadataFromNodeRun(owned.nodeRun);

      await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "cleanup.preview.started", {
        targetBranch: input.targetBranch,
        sourceBranch,
      });

      const manager = await createRuntimeStorageManager();
      const result = await manager.previewMergedCleanup({
        ownerId: ctx.userId,
        rootRepoPath,
        runId: input.runId,
        nodeId: input.nodeId,
        targetBranch: input.targetBranch,
        sourceBranch,
        worktreePath,
        nodeStatus,
        merge,
        discardMergeResults: input.discardMergeResults,
        forceBranchDelete: input.forceBranchDelete,
      });

      await persistCleanupPreview(input.runId, input.nodeId, ctx.userId, result);

      if (result.status === "preview_ready") {
        await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "cleanup.preview.ready", {
          status: result.status,
          targetBranch: result.targetBranch,
          sourceBranch: result.sourceBranch,
          wouldRemoveWorktree: result.wouldRemoveWorktree,
          wouldDeleteBranch: result.wouldDeleteBranch,
          wouldRemoveMergeWorktrees: result.wouldRemoveMergeWorktrees,
          warnings: result.warnings,
        });
      } else if (result.status === "refused") {
        await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "cleanup.refused", {
          status: result.status,
          targetBranch: result.targetBranch,
          sourceBranch: result.sourceBranch,
          checks: result.checks,
          warnings: result.warnings,
          message: result.message,
        });
      } else {
        await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "cleanup.failed", {
          status: result.status,
          targetBranch: result.targetBranch,
          sourceBranch: result.sourceBranch,
          message: result.message,
        });
      }

      return result;
    }),

  cleanupMergedApply: dbProcedure
    .input(cleanupMergedApplyInput)
    .mutation(async ({ ctx, input }) => {
      const owned = await loadOwnedRunNode(input.runId, input.nodeId, ctx.userId);
      const rootRepoPath = rootRepoPathFromRun(owned.run);
      const sourceBranch = stringField(owned.nodeRun.branchName, "branchName");
      const worktreePath = stringField(owned.nodeRun.worktreePath, "worktreePath");
      const nodeStatus = typeof owned.nodeRun.status === "string"
        ? owned.nodeRun.status
        : undefined;
      const merge = mergeMetadataFromNodeRun(owned.nodeRun);

      await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "cleanup.started", {
        targetBranch: input.targetBranch,
        sourceBranch,
        discardMergeResults: input.discardMergeResults,
        forceBranchDelete: input.forceBranchDelete,
      });

      const manager = await createRuntimeStorageManager();
      const result = await manager.applyMergedCleanup({
        ownerId: ctx.userId,
        rootRepoPath,
        runId: input.runId,
        nodeId: input.nodeId,
        targetBranch: input.targetBranch,
        sourceBranch,
        worktreePath,
        nodeStatus,
        merge,
        discardMergeResults: input.discardMergeResults,
        forceBranchDelete: input.forceBranchDelete,
        confirm: input.confirm,
      });

      await persistCleanupApply(input.runId, input.nodeId, ctx.userId, result);

      if (result.status === "cleaned") {
        await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "cleanup.completed", {
          status: result.status,
          targetBranch: result.targetBranch,
          sourceBranch: result.sourceBranch,
          removedWorktree: result.removedWorktree,
          deletedBranch: result.deletedBranch,
          removedMergeWorktrees: result.removedMergeWorktrees,
          deletedMergeBranches: result.deletedMergeBranches,
          warnings: result.warnings,
        });
      } else if (result.status === "refused") {
        await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "cleanup.refused", {
          status: result.status,
          targetBranch: result.targetBranch,
          sourceBranch: result.sourceBranch,
          checks: result.checks,
          warnings: result.warnings,
          message: result.message,
        });
      } else {
        await publishAndPersistMergeEvent(input.runId, input.nodeId, ctx.userId, "cleanup.failed", {
          status: result.status,
          targetBranch: result.targetBranch,
          sourceBranch: result.sourceBranch,
          message: result.message,
          warnings: result.warnings,
        });
      }

      return result;
    }),

  cleanup: dbProcedure
    .input(cleanupInput)
    .mutation(async ({ ctx, input }) => {
      const run = await loadOwnedRun(input.runId, ctx.userId);
      if (input.scope === "node" && !input.nodeId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "nodeId is required for node cleanup",
        });
      }

      const manager = await createRuntimeStorageManager();
      try {
        return await manager.cleanup({
          rootRepoPath: rootRepoPathFromRun(run),
          scope: input.scope,
          runId: input.runId,
          nodeId: input.nodeId,
          confirm: input.confirm,
          discardAgentChanges: input.discardAgentChanges,
          discardMergeResults: input.discardMergeResults,
        });
      } catch (error) {
        if (error instanceof RuntimeCleanupConflictError) {
          throw new TRPCError({
            code: "CONFLICT",
            message: error.message,
          });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: errorMessage(error),
        });
      }
    }),
});

type OwnedRunNode = {
  run: { _id: unknown; graphSnapshot: Record<string, unknown>; nodeRuns: unknown };
  nodeRun: Record<string, unknown>;
};

async function loadOwnedRunNode(
  runId: string,
  nodeId: string,
  ownerId: string
): Promise<OwnedRunNode> {
  const run = await RunModel.findOne({ _id: runId, ownerId }).lean();
  if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });

  const nodeRun = getNodeRun(run.nodeRuns, nodeId);
  if (!nodeRun) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Node run not found for ${nodeId}`,
    });
  }

  return { run, nodeRun };
}

async function loadOwnedRun(
  runId: string,
  ownerId: string
): Promise<{ _id: unknown; graphSnapshot: Record<string, unknown> }> {
  const run = await RunModel.findOne({ _id: runId, ownerId }).lean();
  if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
  return { _id: run._id, graphSnapshot: run.graphSnapshot };
}

function resolveMergeInput(
  owned: OwnedRunNode,
  input: z.infer<typeof mergePreviewInput>
) {
  const rootRepoPath = rootRepoPathFromRun(owned.run);
  const worktreePath =
    input.worktreePath ?? stringField(owned.nodeRun.worktreePath, "worktreePath");
  const sourceBranch =
    input.sourceBranch ?? stringField(owned.nodeRun.branchName, "branchName");

  return {
    rootRepoPath,
    runId: input.runId,
    nodeId: input.nodeId,
    targetBranch: input.targetBranch,
    sourceBranch,
    worktreePath,
  };
}

function rootRepoPathFromRun(run: Pick<OwnedRunNode["run"], "graphSnapshot">): string {
  const snapshot = run.graphSnapshot as { rootRepoPath?: unknown };
  return stringField(snapshot.rootRepoPath, "graphSnapshot.rootRepoPath");
}

function getNodeRun(
  nodeRuns: unknown,
  nodeId: string
): Record<string, unknown> | undefined {
  if (nodeRuns instanceof Map) {
    return nodeRuns.get(nodeId) as Record<string, unknown> | undefined;
  }
  if (nodeRuns && typeof nodeRuns === "object") {
    const value = (nodeRuns as Record<string, unknown>)[nodeId];
    return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  }
  return undefined;
}

function stringField(value: unknown, fieldName: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `${fieldName} is missing from the owned run snapshot`,
  });
}

async function publishAndPersistMergeEvent(
  runId: string,
  nodeId: string,
  ownerId: string,
  type:
    | "merge.preview.started"
    | "merge.preview.ready"
    | "merge.started"
    | "merge.conflicted"
    | "merge.completed"
    | "merge.failed"
    | "merge.aborted"
    | "cleanup.preview.started"
    | "cleanup.preview.ready"
    | "cleanup.started"
    | "cleanup.completed"
    | "cleanup.refused"
    | "cleanup.failed",
  payload: Record<string, unknown>
): Promise<void> {
  const event = {
    ts: new Date().toISOString(),
    level: type.includes("failed") || type.includes("conflicted") || type.includes("refused")
      ? "error" as const
      : "tool" as const,
    payload: { type, ...payload },
  };

  sseHub.emitToNode(runId, nodeId, event);
  await RunModel.updateOne(
    { _id: runId, ownerId },
    { $push: { [`nodeRuns.${nodeId}.events`]: event } },
  );
}

function mergeMetadataFromNodeRun(
  nodeRun: Record<string, unknown>
): RuntimeMergedCleanupMergeMetadata | undefined {
  const outputs = objectField(nodeRun.outputs);
  const merge = objectField(outputs?.merge);
  const apply = objectField(merge?.apply);

  if (!merge && !apply) {
    return undefined;
  }

  return {
    status: stringValue(apply?.status) ?? stringValue(merge?.status),
    targetBranch: stringValue(apply?.targetBranch) ?? stringValue(merge?.targetBranch),
    sourceBranch: stringValue(apply?.sourceBranch) ?? stringValue(merge?.sourceBranch),
    strategy: stringValue(apply?.strategy) ?? stringValue(merge?.strategy),
    appliedAt: stringValue(apply?.appliedAt) ?? stringValue(merge?.appliedAt),
    mergeCommit: stringValue(apply?.mergeCommit) ?? stringValue(merge?.mergeCommit),
    conflictFiles: stringArray(apply?.conflictFiles) ?? stringArray(merge?.conflictFiles),
  };
}

async function persistCleanupPreview(
  runId: string,
  nodeId: string,
  ownerId: string,
  result: RuntimeMergedCleanupPreviewResponse
): Promise<void> {
  await RunModel.updateOne(
    { _id: runId, ownerId },
    {
      $set: {
        [`nodeRuns.${nodeId}.outputs.cleanup.preview`]: {
          status: result.status,
          targetBranch: result.targetBranch,
          sourceBranch: result.sourceBranch,
          worktreePath: result.worktreePath,
          wouldRemoveWorktree: result.wouldRemoveWorktree,
          wouldDeleteBranch: result.wouldDeleteBranch,
          wouldRemoveMergeWorktrees: result.wouldRemoveMergeWorktrees,
          warnings: result.warnings,
          message: result.message,
          checkedAt: new Date().toISOString(),
        },
        [`nodeRuns.${nodeId}.outputs.cleanup.status`]:
          result.status === "preview_ready" ? "preview_ready" : "blocked",
        [`nodeRuns.${nodeId}.outputs.cleanup.cleanupWarnings`]: result.warnings,
      },
    },
  );
}

async function persistCleanupApply(
  runId: string,
  nodeId: string,
  ownerId: string,
  result: RuntimeMergedCleanupApplyResponse
): Promise<void> {
  const cleanedAt = result.status === "cleaned" ? new Date().toISOString() : undefined;

  await RunModel.updateOne(
    { _id: runId, ownerId },
    {
      $set: {
        [`nodeRuns.${nodeId}.outputs.cleanup.apply`]: {
          status: result.status,
          targetBranch: result.targetBranch,
          sourceBranch: result.sourceBranch,
          worktreePath: result.worktreePath,
          removedWorktree: result.removedWorktree,
          deletedBranch: result.deletedBranch,
          removedWorktrees: [
            ...(result.removedWorktree && result.worktreePath ? [result.worktreePath] : []),
            ...result.removedMergeWorktrees,
          ],
          deletedBranches: [
            ...(result.deletedBranch && result.sourceBranch ? [result.sourceBranch] : []),
            ...result.deletedMergeBranches,
          ],
          warnings: result.warnings,
          message: result.message,
          cleanedAt,
        },
        [`nodeRuns.${nodeId}.outputs.cleanup.status`]:
          result.status === "cleaned"
            ? "cleaned"
            : result.status === "failed"
              ? "failed"
              : "blocked",
        [`nodeRuns.${nodeId}.outputs.cleanup.cleanedAt`]: cleanedAt,
        [`nodeRuns.${nodeId}.outputs.cleanup.cleanupWarnings`]: result.warnings,
        [`nodeRuns.${nodeId}.outputs.cleanup.removedWorktree`]: result.removedWorktree,
        [`nodeRuns.${nodeId}.outputs.cleanup.deletedBranch`]: result.deletedBranch,
        [`nodeRuns.${nodeId}.outputs.cleanup.removedWorktrees`]: result.removedWorktree && result.worktreePath
          ? [result.worktreePath, ...result.removedMergeWorktrees]
          : result.removedMergeWorktrees,
        [`nodeRuns.${nodeId}.outputs.cleanup.deletedBranches`]: result.deletedBranch && result.sourceBranch
          ? [result.sourceBranch, ...result.deletedMergeBranches]
          : result.deletedMergeBranches,
      },
    },
  );
}

async function persistMergeResult(
  runId: string,
  nodeId: string,
  ownerId: string,
  phase: "preview" | "apply" | "abort",
  result: MergePreviewResponse | MergeApplyResponse,
  metadata: { strategy?: "no-ff" | "squash" } = {}
): Promise<void> {
  const persistedResult =
    phase === "apply"
      ? {
          ...result,
          strategy: metadata.strategy,
          appliedAt: result.status === "merged" ? new Date().toISOString() : undefined,
        }
      : result;

  await RunModel.updateOne(
    { _id: runId, ownerId },
    {
      $set: {
        [`nodeRuns.${nodeId}.outputs.merge.${phase}`]: persistedResult,
        [`nodeRuns.${nodeId}.outputs.merge.status`]: result.status,
        ...(phase === "apply" ? {
          [`nodeRuns.${nodeId}.outputs.merge.strategy`]: metadata.strategy,
          [`nodeRuns.${nodeId}.outputs.merge.targetBranch`]: result.targetBranch,
          [`nodeRuns.${nodeId}.outputs.merge.sourceBranch`]: result.sourceBranch,
          [`nodeRuns.${nodeId}.outputs.merge.mergeCommit`]: "mergeCommit" in result ? result.mergeCommit : undefined,
          [`nodeRuns.${nodeId}.outputs.merge.appliedAt`]:
            result.status === "merged" ? (persistedResult as { appliedAt?: string }).appliedAt : undefined,
        } : {}),
      },
    },
  );
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

async function persistPromotionResult(
  runId: string,
  nodeId: string,
  ownerId: string,
  result: MergeApplyResponse
): Promise<void> {
  await RunModel.updateOne(
    { _id: runId, ownerId },
    {
      $set: {
        [`nodeRuns.${nodeId}.outputs.promotion`]: {
          status: result.status,
          targetBranch: result.targetBranch,
          sourceBranch: result.sourceBranch,
          mergeCommit: result.mergeCommit,
          conflictFiles: result.conflictFiles,
          message: result.message,
        },
      },
    },
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function createRuntimeStorageManager(): Promise<RuntimeStorageManager> {
  const { sharedProcessManager } = await import("../runtime/run-executor");
  return new RuntimeStorageManager(sharedProcessManager);
}

function assertDemoSeedingAllowed(): void {
  if (process.env.NODE_ENV === "production") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Runtime demo graph seeding is disabled in production",
    });
  }
}
