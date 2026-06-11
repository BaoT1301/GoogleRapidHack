import type { Node, Edge } from "@xyflow/react";
import type {
  INodeSpec,
  IEdgeSpec,
  NodeKind,
  NodeStatus,
  EdgeKind,
} from "@/db/models/graph.model";
import type { VisualStatus } from "@/lib/canvas-theme/schema";

export interface FlowNodeData extends Record<string, unknown> {
  kind: NodeKind;
  label: string;
  status: NodeStatus;
  notes?: string;
  data: Record<string, unknown>;
  /**
   * UI-DERIVED visual status (e.g. "stale"). Computed in the editor and read by
   * GraphNode for styling ONLY. Never persisted (flowToSpec ignores it) and
   * never on the SSE stream — it must not alter the authored graph or save state.
   */
  visualStatus?: VisualStatus;
  /**
   * UI-only elapsed runtime label derived from live/historical run events.
   * Never persisted; `flowToSpec` intentionally ignores it.
   */
  runtimeLabel?: string;
}

export interface FlowEdgeData extends Record<string, unknown> {
  kind: EdgeKind;
  outputKey?: string;
  inputKey?: string;
  fanInMode?: "all-of" | "any-of";
  aiPatchState?: "changed" | "added" | "removed";
}

export type AppNode = Node<FlowNodeData, "graphNode">;
export type AppEdge = Edge<FlowEdgeData>;

/**
 * GraphSpec (Mongo) → React Flow nodes/edges.
 *
 * Edge stroke/animation are intentionally NOT set here anymore — they are
 * applied from the active Theme Pack in the Canvas layer (see
 * `canvas-theme/apply.ts` `edgeRenderProps`), so edge appearance re-skins with
 * the pack instead of being baked into persisted state.
 */
export function specToFlow(
  nodes: INodeSpec[],
  edges: IEdgeSpec[],
): { nodes: AppNode[]; edges: AppEdge[] } {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: "graphNode",
      position: n.position ?? { x: 0, y: 0 },
      data: {
        kind: n.kind,
        label: n.label,
        status: n.status,
        notes: n.notes,
        data: n.data ?? {},
      },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      data: {
        kind: e.kind,
        outputKey: e.outputKey,
        inputKey: e.inputKey,
        fanInMode: e.fanInMode,
      },
    })),
  };
}

/** React Flow nodes/edges → GraphSpec (INodeSpec/IEdgeSpec) for persistence. */
export function flowToSpec(
  nodes: AppNode[],
  edges: AppEdge[],
): { nodes: INodeSpec[]; edges: IEdgeSpec[] } {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      label: n.data.label,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      status: n.data.status,
      notes: n.data.notes,
      data: n.data.data ?? {},
    })),
    edges: edges.map((e) => {
      const d = e.data ?? ({ kind: "flow" } as FlowEdgeData);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        kind: d.kind ?? "flow",
        outputKey: d.outputKey,
        inputKey: d.inputKey,
        fanInMode: d.fanInMode,
      };
    }),
  };
}

/** Edges reduced to the {source,target,kind} shape used by graph-validation. */
export function toMinEdges(edges: AppEdge[]) {
  return edges.map((e) => ({
    source: e.source,
    target: e.target,
    kind: e.data?.kind ?? "flow",
  }));
}
