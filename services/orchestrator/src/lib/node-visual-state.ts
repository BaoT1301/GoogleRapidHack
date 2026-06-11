/**
 * UI-derived node visual state — computes "derivative" statuses (currently
 * `stale`) that the backend graph model and SSE stream deliberately do NOT know
 * about. This keeps the persisted model + runtime contract simple while letting
 * the canvas surface richer conditions.
 *
 * `stale` = a node that finished successfully but whose INPUTS changed since the
 * last run (its own authored config or any upstream/ancestor node's config). The
 * editor captures a per-node input-hash BASELINE when a run launches; afterwards
 * any authoring edit that changes a node's input hash marks the prior success
 * stale — a visual-only signal, never persisted and never flips the save badge.
 *
 * Framework-free + pure (structurally typed on the canvas node/edge shapes) so
 * it's fully unit-testable and reusable.
 */
import type { VisualStatus } from "@/lib/canvas-theme/schema";

/** Minimal node shape this module needs (AppNode satisfies it structurally). */
export interface VisNode {
  id: string;
  data: {
    kind: string;
    label: string;
    status: string;
    notes?: string;
    data?: Record<string, unknown>;
  };
}

/** Minimal edge shape (AppEdge satisfies it structurally). */
export interface VisEdge {
  source: string;
  target: string;
}

/** Statuses considered a "successful finish" — only these can become stale. */
export const SUCCESS_STATUSES: ReadonlySet<string> = new Set([
  "success",
  "completed",
]);

/** Deterministic JSON: object keys sorted recursively so hashes are stable. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/**
 * A node's OWN content that matters for staleness: authored config only. Excludes
 * runtime `status`, canvas `position`, selection, and `visualStatus` (none of
 * which invalidate a completed run).
 */
function ownContent(node: VisNode): string {
  return stableStringify({
    kind: node.data.kind,
    label: node.data.label,
    notes: node.data.notes ?? null,
    data: node.data.data ?? {},
  });
}

/** Build target → direct predecessors (sources) adjacency from edges. */
function buildPredecessors(edges: VisEdge[]): Map<string, string[]> {
  const preds = new Map<string, string[]>();
  for (const e of edges) {
    const list = preds.get(e.target);
    if (list) list.push(e.source);
    else preds.set(e.target, [e.source]);
  }
  return preds;
}

/** All transitive ancestors of `nodeId` (cycle-safe). */
function ancestorsOf(
  nodeId: string,
  preds: Map<string, string[]>,
): string[] {
  const seen = new Set<string>();
  const stack = [...(preds.get(nodeId) ?? [])];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const p of preds.get(cur) ?? []) {
      if (!seen.has(p)) stack.push(p);
    }
  }
  return [...seen];
}

/**
 * Per-node INPUT hash = the node's own content + the (sorted) own-content of all
 * its transitive ancestors. Two graphs with identical authored inputs for a node
 * produce identical hashes regardless of node ordering.
 */
export function computeInputHashes(
  nodes: VisNode[],
  edges: VisEdge[],
): Record<string, string> {
  const preds = buildPredecessors(edges);
  const own = new Map<string, string>();
  for (const n of nodes) own.set(n.id, ownContent(n));

  const out: Record<string, string> = {};
  for (const n of nodes) {
    const ancestorContents = ancestorsOf(n.id, preds)
      .map((id) => own.get(id) ?? "")
      .sort();
    out[n.id] = stableStringify({
      self: own.get(n.id),
      inputs: ancestorContents,
    });
  }
  return out;
}

/**
 * Derive visual statuses for the current graph against a run `baseline`
 * (`nodeId → input hash` captured at last run). A node is `stale` when it has a
 * baseline, its current status is success-like, and its current input hash
 * differs from the baseline. Returns ONLY nodes with a derived status.
 */
export function deriveVisualStates(
  nodes: VisNode[],
  edges: VisEdge[],
  baseline: Record<string, string> | null | undefined,
): Record<string, VisualStatus> {
  const result: Record<string, VisualStatus> = {};
  if (!baseline) return result;

  const current = computeInputHashes(nodes, edges);
  for (const n of nodes) {
    if (!SUCCESS_STATUSES.has(n.data.status)) continue;
    const base = baseline[n.id];
    if (base === undefined) continue; // node didn't exist / wasn't run
    if (current[n.id] !== base) result[n.id] = "stale";
  }
  return result;
}
