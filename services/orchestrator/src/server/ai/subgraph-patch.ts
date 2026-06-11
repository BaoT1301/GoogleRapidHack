import { z } from "zod";
import { NODE_STATUSES, type IEdgeSpec, type INodeSpec } from "@/db/models/graph.model";
import { EdgeSpecZ, NodeSpecZ } from "@/db/models/graph-spec.zod";
import { wouldCreateCycle } from "@/lib/graph-validation";

export const PatchModeZ = z.enum(["fix", "improve", "expand", "refactor"]);

const PositionPatchZ = z.object({ x: z.number().optional(), y: z.number().optional() });

const NodePatchZ = z
  .object({
    label: z.string().optional(),
    position: PositionPatchZ.optional(),
    status: z.enum(NODE_STATUSES).optional(),
    notes: z.string().optional(),
    data: z.record(z.unknown()).optional(),
  })
  .strict();

const EdgePatchZ = z
  .object({
    source: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
    kind: EdgeSpecZ.shape.kind.optional(),
    outputKey: z.string().optional(),
    inputKey: z.string().optional(),
    fanInMode: z.enum(["all-of", "any-of"]).optional(),
  })
  .strict();

export const SubgraphPatchOperationZ = z.discriminatedUnion("type", [
  z.object({ type: z.literal("updateNode"), nodeId: z.string().min(1), patch: NodePatchZ }),
  z.object({ type: z.literal("addNode"), node: NodeSpecZ }),
  z.object({ type: z.literal("deleteNode"), nodeId: z.string().min(1), reason: z.string().optional() }),
  z.object({ type: z.literal("addEdge"), edge: EdgeSpecZ }),
  z.object({ type: z.literal("deleteEdge"), edgeId: z.string().min(1), reason: z.string().optional() }),
  z.object({ type: z.literal("updateEdge"), edgeId: z.string().min(1), patch: EdgePatchZ }),
]);

export const SubgraphPatchZ = z.object({
  graphId: z.string().min(1),
  selectedNodeIds: z.array(z.string().min(1)).min(1),
  summary: z.string().min(1),
  rationale: z.string().optional(),
  operations: z.array(SubgraphPatchOperationZ),
  warnings: z.array(z.string()).default([]),
  requiresConfirmation: z.boolean().optional(),
});

export type SubgraphPatch = z.infer<typeof SubgraphPatchZ>;

export interface ApplySubgraphPatchInput {
  graphId: string;
  nodes: INodeSpec[];
  edges: IEdgeSpec[];
  patch: SubgraphPatch;
}

export interface ApplySubgraphPatchResult {
  nodes: INodeSpec[];
  edges: IEdgeSpec[];
}

function assertGraphConsistency(nodes: INodeSpec[], edges: IEdgeSpec[]): void {
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) throw new Error("duplicate node id in patch result");

  const edgeIds = new Set<string>();
  const flowEdges: Array<{ source: string; target: string; kind: string }> = [];
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) throw new Error(`duplicate edge id: ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error(`edge ${edge.id} references a missing node`);
    }
    if (edge.kind === "flow") {
      if (wouldCreateCycle(flowEdges, edge.source, edge.target)) {
        throw new Error(`flow edge ${edge.id} would create a cycle`);
      }
      flowEdges.push(edge);
    }
  }
}

export function applySubgraphPatch(input: ApplySubgraphPatchInput): ApplySubgraphPatchResult {
  const patch = SubgraphPatchZ.parse(input.patch);
  if (patch.graphId !== input.graphId) throw new Error("proposal does not belong to this graph");

  let nodes = input.nodes.map((node) => ({ ...node, data: { ...(node.data ?? {}) } }));
  let edges = input.edges.map((edge) => ({ ...edge }));

  for (const op of patch.operations) {
    if (op.type === "updateNode") {
      const index = nodes.findIndex((node) => node.id === op.nodeId);
      if (index === -1) throw new Error(`node not found: ${op.nodeId}`);
      const current = nodes[index];
      nodes[index] = {
        ...current,
        ...op.patch,
        id: current.id,
        kind: current.kind,
        position: { ...current.position, ...(op.patch.position ?? {}) },
        data: op.patch.data ? { ...current.data, ...op.patch.data } : current.data,
      };
      continue;
    }

    if (op.type === "addNode") {
      if (nodes.some((node) => node.id === op.node.id)) {
        throw new Error(`node already exists: ${op.node.id}`);
      }
      nodes.push(op.node as INodeSpec);
      continue;
    }

    if (op.type === "deleteNode") {
      if (!nodes.some((node) => node.id === op.nodeId)) {
        throw new Error(`node not found: ${op.nodeId}`);
      }
      nodes = nodes.filter((node) => node.id !== op.nodeId);
      edges = edges.filter((edge) => edge.source !== op.nodeId && edge.target !== op.nodeId);
      continue;
    }

    if (op.type === "addEdge") {
      if (edges.some((edge) => edge.id === op.edge.id)) {
        throw new Error(`edge already exists: ${op.edge.id}`);
      }
      edges.push(op.edge as IEdgeSpec);
      continue;
    }

    if (op.type === "deleteEdge") {
      if (!edges.some((edge) => edge.id === op.edgeId)) {
        throw new Error(`edge not found: ${op.edgeId}`);
      }
      edges = edges.filter((edge) => edge.id !== op.edgeId);
      continue;
    }

    const index = edges.findIndex((edge) => edge.id === op.edgeId);
    if (index === -1) throw new Error(`edge not found: ${op.edgeId}`);
    edges[index] = { ...edges[index], ...op.patch };
  }

  const parsedNodes = z.array(NodeSpecZ).parse(nodes) as INodeSpec[];
  const parsedEdges = z.array(EdgeSpecZ).parse(edges) as IEdgeSpec[];
  assertGraphConsistency(parsedNodes, parsedEdges);
  return { nodes: parsedNodes, edges: parsedEdges };
}

export function createMockSubgraphPatch(input: {
  graphId: string;
  selectedNodeIds: string[];
  prompt: string;
  mode: z.infer<typeof PatchModeZ>;
}): SubgraphPatch {
  const firstNodeId = input.selectedNodeIds[0];
  return {
    graphId: input.graphId,
    selectedNodeIds: input.selectedNodeIds,
    summary: `Mock ${input.mode} proposal for ${input.selectedNodeIds.length} selected node(s).`,
    rationale: "Dev/test-only proposal path. No real AI provider was called.",
    operations: [
      {
        type: "updateNode",
        nodeId: firstNodeId,
        patch: {
          notes: `AI improvement proposal (${input.mode}): ${input.prompt}`,
          data: {
            aiImprovementMode: input.mode,
            aiImprovementPrompt: input.prompt,
          },
        },
      },
    ],
    warnings: ["Mock proposal only. Review before applying."],
    requiresConfirmation: false,
  };
}
