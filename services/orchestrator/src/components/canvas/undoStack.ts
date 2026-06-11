import type { AppEdge, AppNode } from "@/components/canvas/serialize";
import type { CanvasPatchAnimationMeta } from "./graphPatch";

export interface CanvasUndoSnapshot {
  nodes: AppNode[];
  edges: AppEdge[];
  timestamp: string;
  reason: "ai_subgraph_patch";
  proposalId: string;
}

export interface CanvasUndoResult extends CanvasPatchAnimationMeta {
  nodes: AppNode[];
  edges: AppEdge[];
  snapshot: CanvasUndoSnapshot;
}

export function createUndoSnapshot(input: {
  nodes: AppNode[];
  edges: AppEdge[];
  proposalId: string;
  now?: Date;
}): CanvasUndoSnapshot {
  return {
    nodes: structuredClone(input.nodes),
    edges: structuredClone(input.edges),
    timestamp: (input.now ?? new Date()).toISOString(),
    reason: "ai_subgraph_patch",
    proposalId: input.proposalId,
  };
}

export function pushUndoSnapshot(
  stack: CanvasUndoSnapshot[],
  snapshot: CanvasUndoSnapshot,
  maxDepth = 10,
): CanvasUndoSnapshot[] {
  return [...stack, snapshot].slice(-maxDepth);
}

function diffIds(before: string[], after: string[]) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((id) => !beforeSet.has(id)).sort(),
    removed: before.filter((id) => !afterSet.has(id)).sort(),
    shared: after.filter((id) => beforeSet.has(id)).sort(),
  };
}

function changedSharedNodes(current: AppNode[], restored: AppNode[]): string[] {
  const restoredById = new Map(restored.map((node) => [node.id, node]));
  return current
    .filter((node) => {
      const next = restoredById.get(node.id);
      return next ? JSON.stringify(node) !== JSON.stringify(next) : false;
    })
    .map((node) => node.id)
    .sort();
}

function changedSharedEdges(current: AppEdge[], restored: AppEdge[]): string[] {
  const restoredById = new Map(restored.map((edge) => [edge.id, edge]));
  return current
    .filter((edge) => {
      const next = restoredById.get(edge.id);
      return next ? JSON.stringify(edge) !== JSON.stringify(next) : false;
    })
    .map((edge) => edge.id)
    .sort();
}

export function popUndoSnapshot(input: {
  stack: CanvasUndoSnapshot[];
  currentNodes: AppNode[];
  currentEdges: AppEdge[];
}): { stack: CanvasUndoSnapshot[]; undo: CanvasUndoResult | null } {
  const snapshot = input.stack.at(-1);
  if (!snapshot) return { stack: input.stack, undo: null };

  const currentNodeIds = input.currentNodes.map((node) => node.id);
  const restoredNodeIds = snapshot.nodes.map((node) => node.id);
  const currentEdgeIds = input.currentEdges.map((edge) => edge.id);
  const restoredEdgeIds = snapshot.edges.map((edge) => edge.id);
  const nodeDiff = diffIds(currentNodeIds, restoredNodeIds);
  const edgeDiff = diffIds(currentEdgeIds, restoredEdgeIds);

  return {
    stack: input.stack.slice(0, -1),
    undo: {
      nodes: structuredClone(snapshot.nodes),
      edges: structuredClone(snapshot.edges),
      snapshot,
      changedNodeIds: changedSharedNodes(input.currentNodes, snapshot.nodes),
      addedNodeIds: nodeDiff.added,
      removedNodeIds: nodeDiff.removed,
      changedEdgeIds: changedSharedEdges(input.currentEdges, snapshot.edges),
      addedEdgeIds: edgeDiff.added,
      removedEdgeIds: edgeDiff.removed,
    },
  };
}
