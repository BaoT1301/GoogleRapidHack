/**
 * RUN-6 — Loop runner helpers (pure).
 *
 * A `loop` node re-runs an attached child sub-graph until it succeeds or a
 * per-loop `maxIterations` cap is hit. These pure helpers resolve WHICH child
 * graph to run and bound the iteration count; the actual re-run orchestration
 * (reusing `startRunForGraph` + awaiting each child run) lives in `run-executor`.
 *
 * The global circuit breaker (halt-after-N-identical-errors, per-node timeout)
 * is SEC-4 (Sprint 8) — RUN-6 implements ONLY the per-loop iteration cap.
 */

/** Default per-loop cap when `data.maxIterations` is absent/invalid. */
export const DEFAULT_MAX_ITERATIONS = 3;
/** Hard ceiling — a loop can NEVER iterate more than this regardless of config. */
export const MAX_ITERATIONS_HARD_CAP = 10;

interface MinNode {
  id: string;
  kind?: string;
  data?: unknown;
}
interface MinEdge {
  source: string;
  target: string;
  kind?: string;
}

/** Clamp a (possibly bogus) `data.maxIterations` into [1, MAX_ITERATIONS_HARD_CAP]. */
export function clampMaxIterations(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_ITERATIONS;
  return Math.min(Math.floor(n), MAX_ITERATIONS_HARD_CAP);
}

/** Read a `childGraphId`/`graphId` string off a node's `data`, if present. */
function childGraphIdFromData(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  const id = d.childGraphId ?? d.graphId;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

/**
 * Resolve the child sub-graph id a `loop` node should re-run:
 *   1. the loop node's own `data.childGraphId` (or `data.graphId`); else
 *   2. a node attached via a `loop` or `attaches-to` edge (either direction)
 *      that carries `data.childGraphId`/`data.graphId`.
 * Returns `undefined` when no child graph can be resolved (the loop fails).
 */
export function resolveLoopChildGraphId(
  loopNode: MinNode,
  nodes: MinNode[],
  edges: MinEdge[],
): string | undefined {
  const own = childGraphIdFromData(loopNode.data);
  if (own) return own;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    if (e.kind !== "loop" && e.kind !== "attaches-to") continue;
    let otherId: string | undefined;
    if (e.source === loopNode.id) otherId = e.target;
    else if (e.target === loopNode.id) otherId = e.source;
    if (!otherId) continue;
    const other = nodeById.get(otherId);
    const id = childGraphIdFromData(other?.data);
    if (id) return id;
  }
  return undefined;
}
