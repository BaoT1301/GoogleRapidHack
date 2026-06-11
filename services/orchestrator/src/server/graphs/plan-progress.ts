/**
 * PLAN-5 — pure plan-progress rollup helpers (the "second brain" ledger).
 *
 * Aggregates per-node run statuses (from a graph's latest run `nodeRuns`) into a
 * per-sprint rolled-up status. Pure + framework-free + DB-free so it is
 * unit-tested in isolation; the `graphs.planProgress` query does the owner-scoped
 * fetching and feeds these helpers.
 *
 * Statuses are the canonical `NODE_RUN_STATUSES` (`runtime/types.ts`) — RUN-8
 * single source of truth; this module does NOT redefine them.
 */

/** Sprint-level rollup vocabulary (a subset of the node statuses + "cancelled"). */
export type SprintRollupStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "blocked"
  | "skipped";

export interface ProgressNode {
  nodeId: string;
  label: string;
  status: string;
}

export interface SprintProgress {
  graphId: string;
  name: string;
  sprintNumber?: number;
  sprintName?: string;
  status: SprintRollupStatus;
  /** True once this sprint's graph has at least one run with node state. */
  hasRun: boolean;
  nodes: ProgressNode[];
}

const ACTIVE = new Set(["running", "starting", "queued"]);

/**
 * Roll a sprint's per-node statuses into one status. Precedence (most → least
 * urgent for a live ledger):
 *   1. any node actively running/starting/queued → `running`
 *   2. any `failed`    → `failed`
 *   3. any `cancelled` → `cancelled`
 *   4. any `blocked`   → `blocked`
 *   5. all terminal-good (`success`/`skipped`) with ≥1 `success` → `success`
 *   6. all `skipped`   → `skipped`
 *   7. otherwise (no run yet / mixed pending) → `pending`
 *
 * Empty / no-run sprints degrade gracefully to `pending`.
 */
export function rollupSprintStatus(statuses: string[]): SprintRollupStatus {
  if (!statuses || statuses.length === 0) return "pending";
  const set = new Set(statuses);
  if (statuses.some((s) => ACTIVE.has(s))) return "running";
  if (set.has("failed")) return "failed";
  if (set.has("cancelled")) return "cancelled";
  if (set.has("blocked")) return "blocked";
  const allTerminalGood = statuses.every((s) => s === "success" || s === "skipped");
  if (allTerminalGood && set.has("success")) return "success";
  if (statuses.every((s) => s === "skipped")) return "skipped";
  return "pending";
}

/**
 * Build one sprint's progress from its graph nodes + the latest run's node-run
 * map (keyed by nodeId). A node with no run entry is `pending`. `hasRun` reflects
 * whether the latest run carried any node state at all.
 */
export function buildSprintProgress(input: {
  graphId: string;
  name: string;
  sprintNumber?: number;
  sprintName?: string;
  nodes: { id: string; label?: string }[];
  nodeRuns?: Record<string, { status?: string } | undefined> | null;
}): SprintProgress {
  const runs = input.nodeRuns ?? undefined;
  const hasRun = Boolean(runs && Object.keys(runs).length > 0);

  const nodes: ProgressNode[] = (input.nodes ?? []).map((n) => ({
    nodeId: n.id,
    label: n.label ?? n.id,
    status: (runs?.[n.id]?.status ?? "pending").toString(),
  }));

  return {
    graphId: input.graphId,
    name: input.name,
    sprintNumber: input.sprintNumber,
    sprintName: input.sprintName,
    status: rollupSprintStatus(nodes.map((n) => n.status)),
    hasRun,
    nodes,
  };
}

/**
 * The "current" sprint for highlighting: the first sprint that is not yet
 * terminal-good (`success`/`skipped`) — i.e. the active front of the roadmap.
 * Returns `undefined` when every sprint is done (nothing to highlight).
 */
export function currentSprintNumber(sprints: SprintProgress[]): number | undefined {
  const active = sprints.find((s) => s.status !== "success" && s.status !== "skipped");
  return active?.sprintNumber;
}
