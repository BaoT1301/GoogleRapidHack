// Content-diff gating for the canvas autosave (fixes Saved/Unsaved badge flicker).
//
// React Flow emits `onNodesChange`/`onEdgesChange` for many *non-content* events
// — selection, dimension measurement, drag-position ticks — none of which alter
// the persisted GraphSpec. Saving (and flipping the badge) on every such change
// makes the badge flicker dirty→saving→saved while merely clicking a node.
//
// `specKey` produces a stable string from only the *authored* graph content, so
// callers can skip a save when the key is unchanged. `status` is deliberately
// excluded: it is runtime state (live run colouring mutates `node.data.status`)
// and must never mark the authored graph dirty.
import { flowToSpec, type AppNode, type AppEdge } from "@/components/canvas/serialize";

/**
 * Stable content key for the canvas. Equal keys ⇒ no meaningful change ⇒ no save.
 * Excludes selection, dimensions, and runtime `status`.
 */
export function specKey(nodes: AppNode[], edges: AppEdge[]): string {
  const spec = flowToSpec(nodes, edges);
  return JSON.stringify({
    nodes: spec.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      position: n.position,
      notes: n.notes ?? null,
      data: n.data ?? {},
    })),
    edges: spec.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      kind: e.kind,
      outputKey: e.outputKey ?? null,
      inputKey: e.inputKey ?? null,
      fanInMode: e.fanInMode ?? null,
    })),
  });
}
