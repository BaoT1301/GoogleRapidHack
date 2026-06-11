import { EDGE_META } from "@/lib/graph-constants";
import { wouldCreateCycle } from "@/lib/graph-validation";
import type { AppEdge, AppNode, FlowEdgeData } from "@/components/canvas/serialize";
import type { EdgeKind, NodeKind, NodeStatus } from "@/db/models/graph.model";

export interface CanvasNodeSpec {
  id: string;
  kind: NodeKind;
  label: string;
  position?: { x: number; y: number };
  status?: NodeStatus;
  notes?: string;
  data?: Record<string, unknown>;
}

export interface CanvasEdgeSpec {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  outputKey?: string;
  inputKey?: string;
  fanInMode?: "all-of" | "any-of";
}

export interface CanvasNodePatch {
  label?: string;
  position?: Partial<{ x: number; y: number }>;
  status?: NodeStatus;
  notes?: string;
  data?: Record<string, unknown>;
}

export type CanvasSubgraphPatchOperation =
  | {
      type: "updateNode";
      nodeId: string;
      patch: CanvasNodePatch;
    }
  | { type: "addNode"; node: CanvasNodeSpec }
  | { type: "deleteNode"; nodeId: string; reason?: string }
  | { type: "updateEdge"; edgeId: string; patch: Partial<Omit<CanvasEdgeSpec, "id">> }
  | { type: "addEdge"; edge: CanvasEdgeSpec }
  | { type: "deleteEdge"; edgeId: string; reason?: string };

export interface CanvasSubgraphPatch {
  graphId: string;
  selectedNodeIds: string[];
  summary: string;
  rationale?: string;
  operations: CanvasSubgraphPatchOperation[];
  warnings: string[];
  requiresConfirmation?: boolean;
}

export interface CanvasPatchAnimationMeta {
  changedNodeIds: string[];
  addedNodeIds: string[];
  removedNodeIds: string[];
  changedEdgeIds: string[];
  addedEdgeIds: string[];
  removedEdgeIds: string[];
}

export interface ApplyCanvasSubgraphPatchResult extends CanvasPatchAnimationMeta {
  nodes: AppNode[];
  edges: AppEdge[];
  warnings: string[];
}

function edgeStyle(kind: EdgeKind): React.CSSProperties {
  return {
    stroke: EDGE_META[kind]?.color ?? EDGE_META.flow.color,
    strokeWidth: 1.5,
  };
}

function asFlowNode(node: CanvasNodeSpec): AppNode {
  return {
    id: node.id,
    type: "graphNode",
    position: node.position ?? { x: 0, y: 0 },
    data: {
      kind: node.kind,
      label: node.label,
      status: node.status ?? "pending",
      notes: node.notes,
      data: node.data ?? {},
    },
  };
}

function asFlowEdge(edge: CanvasEdgeSpec): AppEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: {
      kind: edge.kind,
      outputKey: edge.outputKey,
      inputKey: edge.inputKey,
      fanInMode: edge.fanInMode,
    },
    style: edgeStyle(edge.kind),
    animated: edge.kind === "flow",
  };
}

function validateGraph(nodes: AppNode[], edges: AppEdge[]): void {
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) throw new Error("Duplicate node id in graph patch result.");

  const edgeIds = new Set<string>();
  const flowEdges: Array<{ source: string; target: string; kind: string }> = [];
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) throw new Error(`Duplicate edge id in graph patch result: ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error(`Edge ${edge.id} references a missing endpoint.`);
    }
    const kind = edge.data?.kind ?? "flow";
    if (kind === "flow") {
      if (wouldCreateCycle(flowEdges, edge.source, edge.target)) {
        throw new Error(`Flow edge ${edge.id} would create a cycle.`);
      }
      flowEdges.push({ source: edge.source, target: edge.target, kind });
    }
  }
}

function sorted(values: Set<string>): string[] {
  return Array.from(values).sort();
}

export function applySubgraphPatchToCanvas(input: {
  nodes: AppNode[];
  edges: AppEdge[];
  patch: CanvasSubgraphPatch;
}): ApplyCanvasSubgraphPatchResult {
  let nodes = input.nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    data: { ...node.data, data: { ...(node.data.data ?? {}) } },
  }));
  let edges: AppEdge[] = input.edges.map((edge) => ({
    ...edge,
    data: edge.data ? { ...edge.data } : ({ kind: "flow" } as FlowEdgeData),
  }));

  const changedNodeIds = new Set<string>();
  const addedNodeIds = new Set<string>();
  const removedNodeIds = new Set<string>();
  const changedEdgeIds = new Set<string>();
  const addedEdgeIds = new Set<string>();
  const removedEdgeIds = new Set<string>();
  const warnings = [...(input.patch.warnings ?? [])];

  for (const operation of input.patch.operations) {
    if (operation.type === "updateNode") {
      const index = nodes.findIndex((node) => node.id === operation.nodeId);
      if (index === -1) throw new Error(`Cannot update missing node: ${operation.nodeId}`);
      const current = nodes[index];
      nodes[index] = {
        ...current,
        position: operation.patch.position
          ? { ...current.position, ...operation.patch.position }
          : current.position,
        data: {
          ...current.data,
          ...(operation.patch.label !== undefined ? { label: operation.patch.label } : {}),
          ...(operation.patch.status !== undefined ? { status: operation.patch.status } : {}),
          ...(operation.patch.notes !== undefined ? { notes: operation.patch.notes } : {}),
          ...(operation.patch.data
            ? { data: { ...(current.data.data ?? {}), ...operation.patch.data } }
            : {}),
        },
      };
      changedNodeIds.add(operation.nodeId);
      continue;
    }

    if (operation.type === "addNode") {
      if (nodes.some((node) => node.id === operation.node.id)) {
        throw new Error(`Cannot add duplicate node: ${operation.node.id}`);
      }
      nodes.push(asFlowNode(operation.node));
      addedNodeIds.add(operation.node.id);
      continue;
    }

    if (operation.type === "deleteNode") {
      if (!nodes.some((node) => node.id === operation.nodeId)) {
        throw new Error(`Cannot delete missing node: ${operation.nodeId}`);
      }
      nodes = nodes.filter((node) => node.id !== operation.nodeId);
      const connectedEdges = edges.filter(
        (edge) => edge.source === operation.nodeId || edge.target === operation.nodeId,
      );
      for (const edge of connectedEdges) removedEdgeIds.add(edge.id);
      edges = edges.filter(
        (edge) => edge.source !== operation.nodeId && edge.target !== operation.nodeId,
      );
      removedNodeIds.add(operation.nodeId);
      continue;
    }

    if (operation.type === "updateEdge") {
      const index = edges.findIndex((edge) => edge.id === operation.edgeId);
      if (index === -1) throw new Error(`Cannot update missing edge: ${operation.edgeId}`);
      const current = edges[index];
      const kind = operation.patch.kind ?? current.data?.kind ?? "flow";
      edges[index] = {
        ...current,
        source: operation.patch.source ?? current.source,
        target: operation.patch.target ?? current.target,
        data: {
          ...(current.data ?? { kind: "flow" }),
          ...(operation.patch.kind !== undefined ? { kind } : {}),
          ...(operation.patch.outputKey !== undefined ? { outputKey: operation.patch.outputKey } : {}),
          ...(operation.patch.inputKey !== undefined ? { inputKey: operation.patch.inputKey } : {}),
          ...(operation.patch.fanInMode !== undefined ? { fanInMode: operation.patch.fanInMode } : {}),
        },
        style: edgeStyle(kind),
        animated: kind === "flow",
      };
      changedEdgeIds.add(operation.edgeId);
      continue;
    }

    if (operation.type === "addEdge") {
      if (edges.some((edge) => edge.id === operation.edge.id)) {
        throw new Error(`Cannot add duplicate edge: ${operation.edge.id}`);
      }
      edges.push(asFlowEdge(operation.edge));
      addedEdgeIds.add(operation.edge.id);
      continue;
    }

    if (!edges.some((edge) => edge.id === operation.edgeId)) {
      throw new Error(`Cannot delete missing edge: ${operation.edgeId}`);
    }
    edges = edges.filter((edge) => edge.id !== operation.edgeId);
    removedEdgeIds.add(operation.edgeId);
  }

  validateGraph(nodes, edges);

  return {
    nodes,
    edges,
    changedNodeIds: sorted(changedNodeIds),
    addedNodeIds: sorted(addedNodeIds),
    removedNodeIds: sorted(removedNodeIds),
    changedEdgeIds: sorted(changedEdgeIds),
    addedEdgeIds: sorted(addedEdgeIds),
    removedEdgeIds: sorted(removedEdgeIds),
    warnings,
  };
}
