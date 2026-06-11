import { TRPCError } from "@trpc/server";
import path from "node:path";
import { z } from "zod";
import { GraphModel, type IEdgeSpec, type INodeSpec } from "@/db/models/graph.model";
import { EdgeSpecZ, NodeSpecZ } from "@/db/models/graph-spec.zod";
import { authedProcedure, createTRPCRouter, dbProcedure } from "../init";
import {
  AI_PATCH_PROVIDERS,
  getModelCatalog,
  isMockPatchProviderEnabled,
  type AiPatchProvider,
} from "../ai/model-catalog";
import { generateCodexSubgraphPatch } from "../ai/codex-subgraph-patch";
import { routeModel } from "../ai/model-router";
import { getSubgraphProposal, saveSubgraphProposal } from "../ai/proposal-store";
import {
  applySubgraphPatch,
  createMockSubgraphPatch,
  PatchModeZ,
  SubgraphPatchZ,
} from "../ai/subgraph-patch";

const ProposeSubgraphPatchInputZ = z.object({
  graphId: z.string().min(1),
  selectedNodeIds: z.array(z.string().min(1)).min(1),
  prompt: z.string().trim().min(1).max(8000),
  provider: z.enum([...AI_PATCH_PROVIDERS, "auto"]),
  model: z.string().min(1),
  mode: PatchModeZ,
});

const ApplySubgraphPatchInputZ = z.object({
  graphId: z.string().min(1),
  proposalId: z.string().min(1),
  confirm: z.literal(true),
});

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function assertSelectedNodesExist(graphNodes: INodeSpec[], selectedNodeIds: string[]): string[] {
  const normalized = unique(selectedNodeIds);
  const nodeIds = new Set(graphNodes.map((node) => node.id));
  const missing = normalized.filter((nodeId) => !nodeIds.has(nodeId));
  if (missing.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `selected node not found: ${missing.join(", ")}`,
    });
  }
  return normalized;
}

function unsupportedPatchProvider(provider: AiPatchProvider): never {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `${provider} graph-patch proposals are not implemented. Use Codex CLI / GPT with local Codex auth.`,
  });
}

export const aiRouter = createTRPCRouter({
  modelCatalog: authedProcedure.query(() => getModelCatalog()),

  proposeSubgraphPatch: dbProcedure
    .input(ProposeSubgraphPatchInputZ)
    .mutation(async ({ ctx, input }) => {
      const graph = await GraphModel.findOne({ _id: input.graphId, ownerId: ctx.userId }).lean();
      if (!graph) throw new TRPCError({ code: "NOT_FOUND" });

      const selectedNodeIds = assertSelectedNodesExist(graph.nodes as INodeSpec[], input.selectedNodeIds);
      const modelSelection = routeModel({
        taskType: "graph_patch",
        provider: input.provider,
        model: input.model,
      });
      if (!AI_PATCH_PROVIDERS.includes(modelSelection.provider as AiPatchProvider)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `auto model router selected unsupported graph patch provider: ${modelSelection.provider}`,
        });
      }
      const provider = modelSelection.provider as AiPatchProvider;
      const codexCwd =
        typeof graph.rootRepoPath === "string" && path.isAbsolute(graph.rootRepoPath)
          ? graph.rootRepoPath
          : process.cwd();

      const patch = SubgraphPatchZ.parse(
        isMockPatchProviderEnabled()
          ? createMockSubgraphPatch({
              graphId: input.graphId,
              selectedNodeIds,
              prompt: input.prompt,
              mode: input.mode,
            })
          : provider === "codex"
            ? await generateCodexSubgraphPatch({
                graphId: input.graphId,
                selectedNodeIds,
                prompt: input.prompt,
                mode: input.mode,
                model: modelSelection.model,
                cwd: codexCwd,
                nodes: z.array(NodeSpecZ).parse(graph.nodes) as INodeSpec[],
                edges: z.array(EdgeSpecZ).parse(graph.edges) as IEdgeSpec[],
              })
            : unsupportedPatchProvider(provider),
      );

      const proposal = saveSubgraphProposal({
        ownerId: ctx.userId,
        graphId: input.graphId,
        provider,
        model: modelSelection.model,
        patch,
      });

      return {
        proposalId: proposal.proposalId,
        graphId: input.graphId,
        provider,
        model: modelSelection.model,
        modelSelection,
        patch,
      };
    }),

  applySubgraphPatch: dbProcedure
    .input(ApplySubgraphPatchInputZ)
    .mutation(async ({ ctx, input }) => {
      const graph = await GraphModel.findOne({ _id: input.graphId, ownerId: ctx.userId });
      if (!graph) throw new TRPCError({ code: "NOT_FOUND" });

      const proposal = getSubgraphProposal({
        ownerId: ctx.userId,
        graphId: input.graphId,
        proposalId: input.proposalId,
      });
      if (!proposal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found for graph" });
      }

      try {
        const currentNodes = z.array(NodeSpecZ).parse(graph.nodes) as INodeSpec[];
        const currentEdges = z.array(EdgeSpecZ).parse(graph.edges) as IEdgeSpec[];
        const next = applySubgraphPatch({
          graphId: input.graphId,
          nodes: currentNodes,
          edges: currentEdges,
          patch: proposal.patch,
        });
        graph.nodes = next.nodes;
        graph.edges = next.edges;
        await graph.save();
        return graph.toObject();
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "invalid subgraph patch",
        });
      }
    }),
});
