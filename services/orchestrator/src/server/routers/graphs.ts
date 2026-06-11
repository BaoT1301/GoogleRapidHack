import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, createTRPCRouter } from "../init";
import { getGraphGateway } from "../data/graph-gateway";
import { getRunGateway } from "../data/run-gateway";
import {
  GRAPH_STATUSES,
  SUPPORTED_CLIS,
  type IEdgeSpec,
  type INodeSpec,
} from "../../db/models/graph.model";
import { NodeSpecZ, EdgeSpecZ } from "../../db/models/graph-spec.zod";
import { validateConnection, type MinEdge } from "../../lib/graph-validation";
import { createChildGraph } from "../graphs/spawn-child";
import { createPlanGraphs } from "../graphs/create-plan-graphs";
import { buildNodePromptPreview } from "../graphs/preview-node-prompt";
import { buildSprintProgress } from "../graphs/plan-progress";
import { probeRepoInfo } from "../graphs/repo-info";
import { mongoRunRepository } from "../runtime/mongo-run-repository";
import { sseEventHub } from "../runtime/sse-event-hub";
import { resolveAllowedTools } from "../settings/allowed-tools";
import { toTrustToolsArg } from "../runtime/kiro-tools";
import { startRunForGraph } from "../runs/start-run";
import type { RuntimeEvent } from "../runtime/types";

const PlanGraphProposalZ = z.object({
  featureName: z.string().optional(),
  sprintNumber: z.number().optional(),
  missingContext: z.array(z.string()).optional(),
  proposedNodes: z.array(NodeSpecZ),
  proposedEdges: z.array(EdgeSpecZ),
  rawGraphSpecPreview: z.unknown().optional(),
});

const ApplyPlanNodeProposalInputZ = z.object({
  graphId: z.string().min(1),
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  confirm: z.literal(true),
  mode: z.enum(["append", "patch"]).optional(),
});

type NodeRunsRecord = Record<string, { outputs?: Record<string, unknown>; status?: string }>;

function readNodeRun(nodeRuns: unknown, nodeId: string): { outputs?: Record<string, unknown>; status?: string } | undefined {
  if (nodeRuns instanceof Map) return nodeRuns.get(nodeId) as { outputs?: Record<string, unknown>; status?: string } | undefined;
  if (nodeRuns && typeof nodeRuns === "object") return (nodeRuns as NodeRunsRecord)[nodeId];
  return undefined;
}

function readPlanOutput(nodeRun: { outputs?: Record<string, unknown> } | undefined): Record<string, unknown> | undefined {
  const planOutput = nodeRun?.outputs?.plan;
  return planOutput && typeof planOutput === "object" ? planOutput as Record<string, unknown> : undefined;
}

function assertAppendablePlanProposal(input: {
  currentNodes: INodeSpec[];
  currentEdges: IEdgeSpec[];
  proposedNodes: INodeSpec[];
  proposedEdges: IEdgeSpec[];
}): { nodes: INodeSpec[]; edges: IEdgeSpec[] } {
  const nodeIds = new Set(input.currentNodes.map((node) => node.id));
  for (const node of input.proposedNodes) {
    if (nodeIds.has(node.id)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `proposal node id already exists: ${node.id}` });
    }
    nodeIds.add(node.id);
  }

  const edgeIds = new Set(input.currentEdges.map((edge) => edge.id));
  const nextEdges: IEdgeSpec[] = [...input.currentEdges];
  for (const edge of input.proposedEdges) {
    if (edgeIds.has(edge.id)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `proposal edge id already exists: ${edge.id}` });
    }
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `proposal edge references missing node: ${edge.id}`,
      });
    }

    const validation = validateConnection(
      { source: edge.source, target: edge.target, kind: edge.kind },
      nextEdges.map(toMinEdge),
    );
    if (!validation.ok) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `invalid proposal edge ${edge.id}: ${validation.reason ?? "connection rejected"}`,
      });
    }

    edgeIds.add(edge.id);
    nextEdges.push(edge);
  }

  return { nodes: [...input.currentNodes, ...input.proposedNodes], edges: nextEdges };
}

function toMinEdge(edge: IEdgeSpec): MinEdge {
  return { source: edge.source, target: edge.target, kind: edge.kind };
}

async function publishPlanApplyEvent(input: {
  ownerId: string;
  runId: string;
  nodeId: string;
  type: RuntimeEvent["type"];
  payload: Record<string, unknown>;
}): Promise<void> {
  const event: RuntimeEvent = {
    type: input.type,
    runId: input.runId,
    nodeId: input.nodeId,
    timestamp: new Date().toISOString(),
    payload: input.payload,
  };
  sseEventHub.publish(input.runId, event);
  await mongoRunRepository.appendNodeEvent(event, input.ownerId);
}

// Every query/mutation is scoped by `{ ownerId: ctx.userId }` — manual tenant
// isolation (no Postgres RLS here; ADR AD-3).
export const graphsRouter = createTRPCRouter({
  // List the signed-in user's graphs, most-recently-updated first.
  // P0-full: CRUD routes through the graph gateway (Mongo by default; the cloud BFF
  // when BFF_URL is set). These use `authedProcedure` not `dbProcedure` because the
  // Mongo gateway self-connects per call and the BFF gateway needs no local DB.
  list: authedProcedure.query(async ({ ctx }) => {
    return getGraphGateway(ctx).list(ctx.userId);
  }),

  // Single graph by id (scoped).
  getById: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const graph = await getGraphGateway(ctx).getById(ctx.userId, input.id);
      if (!graph) throw new TRPCError({ code: "NOT_FOUND" });
      return graph;
    }),

  // Create an empty graph.
  create: authedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        rootRepoPath: z.string().optional(),
        baseBranch: z.string().optional(),
        cli: z.enum(SUPPORTED_CLIS).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return getGraphGateway(ctx).create(ctx.userId, input);
    }),

  // Update — LA calls this on (debounced) canvas saves.
  update: authedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        rootRepoPath: z.string().optional(),
        cli: z.enum(SUPPORTED_CLIS).optional(),
        // MODEL-1: typed node/edge validation on save. Mirrors the Mongoose model
        // enums exactly (single source of truth) so malformed graphs are rejected
        // at the API boundary with the offending field named, while valid
        // canvas-serialized graphs still pass. Kept `.optional()` exactly as before.
        nodes: z.array(NodeSpecZ).optional(),
        edges: z.array(EdgeSpecZ).optional(),
        status: z.enum(GRAPH_STATUSES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      const graph = await getGraphGateway(ctx).update(ctx.userId, id, {
        ...updates,
        nodes: updates.nodes as INodeSpec[] | undefined,
        edges: updates.edges as IEdgeSpec[] | undefined,
      });
      if (!graph) throw new TRPCError({ code: "NOT_FOUND" });
      return graph;
    }),

  // Archive (read-only snapshot).
  archive: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const graph = await getGraphGateway(ctx).update(ctx.userId, input.id, {
        status: "archived",
      });
      if (!graph) throw new TRPCError({ code: "NOT_FOUND" });
      return graph;
    }),

  // Spawn a child sub-graph linked to a parent node (additive). With
  // `autoStart: true` (WOW-1) the child is also executed immediately via the
  // shared spawn-and-run seam and the new run's id is returned as `childRunId`.
  // The parent graph must be owned by the caller; the parent is NEVER mutated.
  spawnChild: authedProcedure
    .input(
      z.object({
        parentGraphId: z.string(),
        parentNodeId: z.string(),
        name: z.string().min(1).max(200),
        nodes: z.array(z.any()).optional(),
        edges: z.array(z.any()).optional(),
        autoStart: z.boolean().optional(),
        context: z
          .object({
            fromNodes: z.array(z.string()),
            diffPreview: z.string().optional(),
            lastError: z.string().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Delegate to the shared child-graph creator (also used by the runtime's
      // auto-spawned conflict reviewer — GIT-3). `null` ⇒ parent not owned ⇒ 404.
      const child = await createChildGraph({
        ownerId: ctx.userId,
        parentGraphId: input.parentGraphId,
        parentNodeId: input.parentNodeId,
        name: input.name,
        nodes: input.nodes as INodeSpec[] | undefined,
        edges: input.edges as IEdgeSpec[] | undefined,
        context: input.context,
        ctx,
      });
      if (!child) throw new TRPCError({ code: "NOT_FOUND" });

      // WOW-1: optionally start the child run right away (spawn-and-run). The
      // child shares the parent's rootRepoPath/baseBranch, so it flows through
      // the normal executeRun path. `childRunId` is added additively — callers
      // that don't pass `autoStart` get the unchanged child object.
      if (input.autoStart) {
        const childRunId = await startRunForGraph({
          graphId: String((child as { _id: unknown })._id),
          ownerId: ctx.userId,
        });
        return childRunId ? { ...child, childRunId } : child;
      }
      return child;
    }),

  // PLAN-4: expand a multi-sprint Architect backlog into ONE linked graph per
  // sprint (current sprint = the mapped track topology; later sprints seeded
  // from their task lists), all sharing a generated `planId` + their ordered
  // `sprintNumber`. Owner-scoped + zod-validated; delegates to the shared
  // `createPlanGraphs` seam (Do-Not-Invent). The Architect response contract is
  // unchanged — the orchestrator owns the expansion.
  createPlanGraphs: authedProcedure
    .input(
      z.object({
        featureName: z.string().min(1).max(200),
        currentSprint: z.number().int(),
        currentSpec: z.object({
          nodes: z.array(NodeSpecZ),
          edges: z.array(EdgeSpecZ),
        }),
        sprints: z
          .array(
            z.object({
              number: z.number().int(),
              name: z.string(),
              tasks: z.array(z.string()).optional(),
            }),
          )
          .min(1),
        rootRepoPath: z.string().optional(),
        baseBranch: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return createPlanGraphs({
        ownerId: ctx.userId,
        featureName: input.featureName,
        currentSprint: input.currentSprint,
        currentSpec: {
          nodes: input.currentSpec.nodes as INodeSpec[],
          edges: input.currentSpec.edges as IEdgeSpec[],
        },
        sprints: input.sprints,
        rootRepoPath: input.rootRepoPath,
        baseBranch: input.baseBranch,
      });
    }),

  // PLAN-7: read-only, owner-scoped dry-run preview of a node's FULLY-ASSEMBLED
  // prompt (base + data bindings + attached context) plus its resolved
  // CLI/agent/trust-tools. NEVER spawns, writes, or creates a worktree — it loads
  // the owned graph and reuses the MODEL-2 `assembleNodePrompt` seam with empty
  // upstream outputs (noting unresolved `{{upstream…}}` bindings).
  previewNodePrompt: authedProcedure
    .input(z.object({ graphId: z.string(), nodeId: z.string() }))
    .query(async ({ ctx, input }) => {
      const graph = await getGraphGateway(ctx).getById(ctx.userId, input.graphId);
      if (!graph) throw new TRPCError({ code: "NOT_FOUND" });

      const executeTrustTools = toTrustToolsArg(
        await resolveAllowedTools(ctx.userId, { token: ctx.token }),
      );
      const preview = buildNodePromptPreview({
        graph: {
          nodes: graph.nodes as { id: string }[],
          edges: graph.edges as { source: string; target: string }[],
          cli: graph.cli,
        },
        nodeId: input.nodeId,
        executeTrustTools,
      });
      if (!preview) {
        throw new TRPCError({ code: "NOT_FOUND", message: "node not found in graph" });
      }
      return preview;
    }),

  // PLAN-5: read-only, owner-scoped live progress across a plan's linked sprint
  // graphs (PLAN-4). For each graph (ordered by sprintNumber) it reads the LATEST
  // run's per-node statuses + a rolled-up sprint status. Read-only aggregation —
  // no new SSE event types; the UI polls this query for live refresh.
  planProgress: authedProcedure
    .input(z.object({ planId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Graphs via the graph gateway (BFF in BFF mode), filtered to this plan and
      // ordered by sprint; the latest run per graph via the run gateway's
      // service-token listForGraph. Both work without a local Mongo.
      const all = await getGraphGateway(ctx).list(ctx.userId);
      const graphs = all
        .filter((g) => g.planId === input.planId)
        .sort((a, b) => (a.sprintNumber ?? 0) - (b.sprintNumber ?? 0));

      const runGateway = getRunGateway();
      const sprints = await Promise.all(
        graphs.map(async (g) => {
          const [latest] = await runGateway.listForGraph(ctx.userId, String(g._id), 1);
          const nodeRuns = latest?.nodeRuns as
            | Record<string, { status?: string }>
            | undefined;
          return buildSprintProgress({
            graphId: String(g._id),
            name: g.name,
            sprintNumber: g.sprintNumber,
            sprintName: g.sprintName,
            nodes: (g.nodes ?? []).map((n) => ({ id: n.id, label: n.label })),
            nodeRuns,
          });
        }),
      );

      return { planId: input.planId, sprints };
    }),

  // PLAN-RUNTIME: explicitly apply a proposal generated by a Plan node during a
  // run. Runtime generation is preview-only; this procedure updates the current
  // graph draft for the NEXT run and records apply metadata on the run output.
  applyPlanNodeProposal: authedProcedure
    .input(ApplyPlanNodeProposalInputZ)
    .mutation(async ({ ctx, input }) => {
      const mode = input.mode ?? "append";
      if (mode !== "append") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Plan node proposal patch mode is not implemented; use append mode.",
        });
      }

      const graph = await getGraphGateway(ctx).getById(ctx.userId, input.graphId);
      if (!graph) throw new TRPCError({ code: "NOT_FOUND", message: "graph not found" });

      const run = await getRunGateway().getById(ctx.userId, input.runId);
      if (!run || run.graphId !== input.graphId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "run not found" });
      }

      const nodeRun = readNodeRun(run.nodeRuns, input.nodeId);
      if (!nodeRun) throw new TRPCError({ code: "NOT_FOUND", message: "node run not found" });

      const planOutput = readPlanOutput(nodeRun);
      if (!planOutput || planOutput.kind !== "plan") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "node does not contain Plan output" });
      }
      if (planOutput.status !== "proposal_ready") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Plan output is not proposal_ready",
        });
      }
      if (!planOutput.graphProposal) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Plan output has no graph proposal" });
      }

      await publishPlanApplyEvent({
        ownerId: ctx.userId,
        runId: input.runId,
        nodeId: input.nodeId,
        type: "node.plan.apply.started",
        payload: { graphId: input.graphId, mode },
      });

      try {
        const proposal = PlanGraphProposalZ.parse(planOutput.graphProposal);
        const currentNodes = z.array(NodeSpecZ).parse(graph.nodes) as INodeSpec[];
        const currentEdges = z.array(EdgeSpecZ).parse(graph.edges) as IEdgeSpec[];
        const next = assertAppendablePlanProposal({
          currentNodes,
          currentEdges,
          proposedNodes: proposal.proposedNodes as INodeSpec[],
          proposedEdges: proposal.proposedEdges as IEdgeSpec[],
        });

        const updated = await getGraphGateway(ctx).update(ctx.userId, input.graphId, {
          nodes: next.nodes,
          edges: next.edges,
        });
        if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "graph not found" });

        const appliedAt = new Date().toISOString();
        await getRunGateway().patchNodeRun(ctx.userId, input.runId, input.nodeId, {
          "outputs.plan.applied": true,
          "outputs.plan.appliedAt": appliedAt,
          "outputs.plan.appliedGraphId": input.graphId,
        });

        await publishPlanApplyEvent({
          ownerId: ctx.userId,
          runId: input.runId,
          nodeId: input.nodeId,
          type: "node.plan.applied",
          payload: {
            graphId: input.graphId,
            mode,
            proposedNodeCount: proposal.proposedNodes.length,
            proposedEdgeCount: proposal.proposedEdges.length,
            appliedAt,
            appliesToNextRun: true,
          },
        });

        return updated;
      } catch (error) {
        await publishPlanApplyEvent({
          ownerId: ctx.userId,
          runId: input.runId,
          nodeId: input.nodeId,
          type: "node.plan.apply.failed",
          payload: {
            graphId: input.graphId,
            mode,
            reason: error instanceof Error ? error.message : "invalid Plan proposal",
          },
        });
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "invalid Plan proposal",
        });
      }
    }),

  // VIS-2: read-only, owner-scoped watched-repo info for the workspace header
  // badge. A timeout-bounded, never-throwing git probe (`git rev-parse` +
  // `remote get-url` + `--abbrev-ref HEAD`) of the owned graph's `rootRepoPath`.
  // Degrades to `isGitRepo:false` for a missing/non-git path; redacts any
  // credentials embedded in the remote URL (Zero-Secret Leakage).
  repoInfo: authedProcedure
    .input(z.object({ graphId: z.string() }))
    .query(async ({ ctx, input }) => {
      const graph = await getGraphGateway(ctx).getById(ctx.userId, input.graphId);
      if (!graph) throw new TRPCError({ code: "NOT_FOUND" });
      return probeRepoInfo({
        rootRepoPath: graph.rootRepoPath,
        baseBranch: graph.baseBranch,
      });
    }),

  // Delete.
  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const success = await getGraphGateway(ctx).delete(ctx.userId, input.id);
      return { success };
    }),
});
