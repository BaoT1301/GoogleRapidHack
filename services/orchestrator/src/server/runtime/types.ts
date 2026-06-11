export const RUNTIME_EVENT_TYPES = [
  "run.started",
  "run.completed",
  "run.failed",
  "node.queued",
  "node.starting",
  "node.worktree.created",
  "node.mcp_config.created",
  "node.running",
  "node.stdout",
  "node.stderr",
  "node.timeout",
  "node.patch",
  "node.output",
  "node.output_parse_failed",
  "node.rule.warning",
  "node.completed",
  "node.failed",
  "node.cancelled",
  "node.skipped",
  "node.plan.started",
  "node.plan.context_required",
  "node.plan.proposal_ready",
  "node.plan.failed",
  "node.plan.apply.started",
  "node.plan.applied",
  "node.plan.apply.failed",
  "node.gate.evaluating",
  "node.gate.passed",
  "node.gate.blocked",
  "node.child_run.started",
  "node.loop.started",
  "node.loop.iteration.started",
  "node.loop.iteration.completed",
  "node.loop.iteration",
  "node.loop.break",
  "node.loop.exhausted",
  "node.loop.failed",
  "merge.preview.started",
  "merge.preview.ready",
  "merge.started",
  "merge.checks.started",
  "merge.checks.completed",
  "merge.checks.failed",
  "merge.conflicted",
  "merge.completed",
  "merge.failed",
  "merge.promoted_to_parent",
  "merge.aborted",
  "cleanup.preview.started",
  "cleanup.preview.ready",
  "cleanup.started",
  "cleanup.completed",
  "cleanup.refused",
  "cleanup.failed"
] as const;

export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

export interface RuntimeEvent {
  type: RuntimeEventType;
  runId: string;
  nodeId?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

/**
 * Canonical per-node run status vocabulary (single source of truth).
 * Consumed by the runtime (`run-repository`, `execute-runner`, `run-executor`),
 * the `nodeRuns` persistence, and the frontend (RUN-8) via the SSE contract.
 * Superset of the graph-model `NodeStatus` runtime states:
 *   pending | running | success | failed | skipped | blocked   (canonical)
 *   + starting | queued | cancelled                            (live runtime detail)
 */
export const NODE_RUN_STATUSES = [
  "pending",
  "queued",
  "starting",
  "running",
  "success",
  "failed",
  "cancelled",
  "skipped",
  "blocked"
] as const;

export type RuntimeStatus = (typeof NODE_RUN_STATUSES)[number];

/**
 * Canonical runtime CLI value list. `SupportedCli` is derived from it so the set
 * is available at runtime (CLI-2 graph-model sync test pins the DB model's local
 * `SUPPORTED_CLIS` copy against this).
 */
export const SUPPORTED_CLIS = ["fake", "codex", "kiro", "gemini", "claude"] as const;
export type SupportedCli = (typeof SUPPORTED_CLIS)[number];

export interface ExecuteNodeRequest {
  nodeId: string;
  prompt: string;
  cli: SupportedCli;
}
