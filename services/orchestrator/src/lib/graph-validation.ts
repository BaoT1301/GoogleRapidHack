// Pure, framework-free connection validation for the canvas. Cycle detection is
// scoped to `flow` edges only (data / attaches-to edges may legitimately form
// loops). Unit-tested in graph-validation.test.ts.

export interface MinEdge {
  source: string;
  target: string;
  kind: string;
}

export interface ConnectionInput {
  source: string;
  target: string;
  kind?: string;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Would adding `source → target` (a flow edge) create a cycle? True if `target`
 * can already reach `source` by following existing flow edges (DFS).
 */
export function wouldCreateCycle(
  edges: MinEdge[],
  source: string,
  target: string,
): boolean {
  if (source === target) return true;

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== "flow") continue;
    const list = adj.get(e.source);
    if (list) list.push(e.target);
    else adj.set(e.source, [e.target]);
  }

  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const node = stack.pop() as string;
    if (node === source) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of adj.get(node) ?? []) stack.push(next);
  }
  return false;
}

/** Validate a proposed connection. Rejects self-loops, duplicates, and cycles. */
export function validateConnection(
  conn: ConnectionInput,
  edges: MinEdge[],
): ValidationResult {
  const kind = conn.kind ?? "flow";

  if (conn.source === conn.target) {
    return { ok: false, reason: "A node can't connect to itself." };
  }
  if (
    edges.some(
      (e) =>
        e.source === conn.source &&
        e.target === conn.target &&
        e.kind === kind,
    )
  ) {
    return { ok: false, reason: "That connection already exists." };
  }
  if (kind === "flow" && wouldCreateCycle(edges, conn.source, conn.target)) {
    return { ok: false, reason: "That would create a cycle." };
  }
  return { ok: true };
}
