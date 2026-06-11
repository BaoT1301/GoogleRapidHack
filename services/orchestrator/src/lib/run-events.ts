// Pure run-event handling for the run viewer. Built against the runtime SSE
// envelope:
//   { type, runId, nodeId?, timestamp, payload }
// Events from parallel nodes interleave on one stream, so everything is routed
// by `nodeId`. This reducer is framework-free and unit-tested.

export interface RuntimeEvent {
  type: string;
  runId: string;
  nodeId?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

export interface TerminalLine {
  stream: "stdout" | "stderr";
  text: string;
}

export interface NodeTerminal {
  nodeId: string;
  status: string; // UI node state (see NODE_STATE_MAP)
  lines: TerminalLine[];
  /** Count of older lines evicted by the ring buffer (VIS-1 backpressure). */
  droppedLines: number;
  patch?: { length?: number; preview?: string };
  output?: unknown;
  outputParseFailed?: boolean;
  plan?: { status: "planning" | "context_required" | "proposal_ready" | "applied" | "failed"; payload?: Record<string, unknown> };
  gate?: { status: "evaluating" | "passed" | "blocked"; payload?: Record<string, unknown> };
  loop?: { status: "running" | "completed" | "failed" | "exhausted" | "cancelled"; payload?: Record<string, unknown> };
  worktree?: { path?: string; branch?: string };
  startedAt?: string;
  endedAt?: string;
  diagnostic?: {
    type: string;
    tone: "info" | "warning" | "error";
    title: string;
    message: string;
    payload?: Record<string, unknown>;
  };
}

export interface RunActivity {
  id: string;
  type: string;
  tone: "info" | "success" | "warning" | "error";
  message: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

/**
 * VIS-1 backpressure: max stdout/stderr lines retained per node terminal. A
 * chatty CLI emits one SSE event per line and the reducer would otherwise grow
 * `lines` unbounded; we keep the most-recent `MAX_TERMINAL_LINES` and count the
 * rest in `droppedLines` (raw stdout/stderr stays faithful — we only bound how
 * much the UI retains).
 */
export const MAX_TERMINAL_LINES = 500;

export interface RunViewState {
  status: "idle" | "running" | "completed" | "failed";
  nodes: Record<string, NodeTerminal>;
  order: string[]; // nodeIds in first-seen order
  activity: RunActivity[];
  startedAt?: string;
  endedAt?: string;
}

export const initialRunState: RunViewState = {
  status: "idle",
  nodes: {},
  order: [],
  activity: [],
  startedAt: undefined,
  endedAt: undefined,
};

// Runtime event → node UI state (frontend-event-contract "Node State Mapping").
export const NODE_STATE_MAP: Record<string, string> = {
  "node.queued": "pending",
  "node.starting": "starting",
  "node.running": "running",
  "node.completed": "success",
  "node.failed": "failed",
  "node.cancelled": "cancelled",
  "node.skipped": "skipped",
};

function emptyTerminal(nodeId: string): NodeTerminal {
  return { nodeId, status: "pending", lines: [], droppedLines: 0 };
}

/**
 * Append a stdout/stderr line, bounding retention to `MAX_TERMINAL_LINES`. When
 * older lines are evicted, `droppedLines` is incremented so the UI can show a
 * "+N earlier lines dropped" indicator. Pure (returns a new terminal).
 */
function appendLine(current: NodeTerminal, line: TerminalLine): NodeTerminal {
  const lines = [...current.lines, line];
  let droppedLines = current.droppedLines;
  if (lines.length > MAX_TERMINAL_LINES) {
    const overflow = lines.length - MAX_TERMINAL_LINES;
    lines.splice(0, overflow);
    droppedLines += overflow;
  }
  return { ...current, lines, droppedLines };
}

export function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function diagnosticFromNodeEvent(
  event: RuntimeEvent,
  status: string,
  payload: Record<string, unknown>,
): NodeTerminal["diagnostic"] | undefined {
  if (event.type === "node.failed") {
    const reason = str(payload.reason || payload.message || payload.error || payload.stderrPreview);
    const stage = str(payload.stage);
    return {
      type: event.type,
      tone: "error",
      title: stage ? `Node failed during ${stage}` : "Node failed",
      message: reason || "The agent exited unsuccessfully without terminal output.",
      payload,
    };
  }
  if (event.type === "node.skipped") {
    return {
      type: event.type,
      tone: "warning",
      title: "Node skipped",
      message: str(payload.reason) || "A dependency did not complete successfully.",
      payload,
    };
  }
  if (event.type === "node.cancelled") {
    return {
      type: event.type,
      tone: "warning",
      title: "Node cancelled",
      message: str(payload.reason) || "The run was stopped before this node completed.",
      payload,
    };
  }
  if (event.type === "node.timeout") {
    return {
      type: event.type,
      tone: "error",
      title: "Node timed out",
      message: str(payload.reason) || `Exceeded timeout${payload.timeoutMs ? ` of ${payload.timeoutMs}ms` : ""}.`,
      payload,
    };
  }
  if (event.type === "node.rule.warning") {
    return {
      type: event.type,
      tone: "warning",
      title: "Runtime rule warning",
      message: str(payload.rule) || "A runtime rule emitted a warning.",
      payload,
    };
  }
  if (status === "starting" || status === "running") {
    return undefined;
  }
  return undefined;
}

const MAX_RUN_ACTIVITY = 20;

function withActivity(state: RunViewState, event: RuntimeEvent): RunViewState {
  const activity = activityFromEvent(event);
  if (!activity) return state;
  return {
    ...state,
    activity: [...state.activity, activity].slice(-MAX_RUN_ACTIVITY),
  };
}

function activityFromEvent(event: RuntimeEvent): RunActivity | undefined {
  const payload = event.payload ?? {};
  const node = event.nodeId ? ` ${event.nodeId}` : "";
  const id = `${event.timestamp ?? ""}:${event.type}:${event.nodeId ?? ""}:${str(payload.reason ?? payload.message ?? "")}`;

  if (event.type === "merge.started") {
    return {
      id,
      type: event.type,
      tone: "info",
      timestamp: event.timestamp,
      payload,
      message: `Merge-back started for ${str(payload.nodeCount || 0)} branch(es) into ${str(payload.baseBranch || "target")}.`,
    };
  }
  if (event.type === "merge.completed") {
    const cleanup = payload.cleanup && typeof payload.cleanup === "object"
      ? (payload.cleanup as Record<string, unknown>)
      : {};
    const branchDeleted = cleanup.agentBranchDeleted === true;
    return {
      id,
      type: event.type,
      tone: branchDeleted ? "success" : "warning",
      timestamp: event.timestamp,
      payload,
      message: `Merged${node}; agent branch ${branchDeleted ? "deleted" : "still present"}.`,
    };
  }
  if (event.type === "merge.conflicted") {
    return {
      id,
      type: event.type,
      tone: "warning",
      timestamp: event.timestamp,
      payload,
      message: `Merge conflict${node}; worktree preserved for review.`,
    };
  }
  if (event.type === "merge.failed") {
    return {
      id,
      type: event.type,
      tone: "error",
      timestamp: event.timestamp,
      payload,
      message: `Merge failed${node}: ${str(payload.reason || "unknown error")}.`,
    };
  }
  if (event.type === "cleanup.completed") {
    const remaining = Array.isArray(payload.remainingBranches) ? payload.remainingBranches.length : 0;
    const complete = payload.branchCleanupComplete === true;
    return {
      id,
      type: event.type,
      tone: complete ? "success" : "warning",
      timestamp: event.timestamp,
      payload,
      message: complete
        ? "Branch cleanup checked with git branch: no runtime branches remain for this run."
        : `Branch cleanup checked with git branch: ${remaining} runtime branch(es) still remain for this run.`,
    };
  }
  if (event.type === "cleanup.refused" || event.type === "cleanup.failed") {
    return {
      id,
      type: event.type,
      tone: event.type === "cleanup.failed" ? "error" : "warning",
      timestamp: event.timestamp,
      payload,
      message: `Cleanup ${event.type === "cleanup.failed" ? "failed" : "refused"}: ${str(payload.reason || payload.message || "see details")}.`,
    };
  }
  return undefined;
}

function isRunActivityOnlyEvent(type: string): boolean {
  return type.startsWith("merge.") || type.startsWith("cleanup.");
}

/** Fold a single runtime event into the run view state (immutably). */
export function runReducer(
  state: RunViewState,
  event: RuntimeEvent,
): RunViewState {
  const stateWithActivity = withActivity(state, event);
  // Run-level lifecycle.
  if (event.type === "run.reset") return initialRunState;
  if (event.type === "run.started")
    return {
      ...stateWithActivity,
      status: "running",
      startedAt: event.timestamp ?? state.startedAt,
      endedAt: undefined,
    };
  if (event.type === "run.completed")
    return {
      ...stateWithActivity,
      status: "completed",
      endedAt: event.timestamp ?? state.endedAt,
    };
  if (event.type === "run.failed")
    return {
      ...stateWithActivity,
      status: "failed",
      endedAt: event.timestamp ?? state.endedAt,
    };
  if (event.type === "run.status") {
    const legacyStatus = (event as RuntimeEvent & { status?: unknown }).status;
    const s = str(event.payload?.status ?? legacyStatus);
    if (s === "completed" || s === "success")
      return {
        ...stateWithActivity,
        status: "completed",
        endedAt: event.timestamp ?? state.endedAt,
      };
    if (s === "failed" || s === "cancelled")
      return {
        ...stateWithActivity,
        status: "failed",
        endedAt: event.timestamp ?? state.endedAt,
      };
    return {
      ...stateWithActivity,
      status: "running",
      startedAt: state.startedAt ?? event.timestamp,
      endedAt: undefined,
    };
  }
  if (isRunActivityOnlyEvent(event.type)) return stateWithActivity;

  const nodeId = event.nodeId;
  if (!nodeId) return stateWithActivity;

  // Ensure the node terminal exists (route by nodeId).
  const known = state.nodes[nodeId];
  const order = known ? state.order : [...state.order, nodeId];
  const current = known ?? emptyTerminal(nodeId);
  const payload = event.payload ?? {};
  let next: NodeTerminal = current;

  if (event.type in NODE_STATE_MAP) {
    const isBlockedGateSkip =
      event.type === "node.skipped" &&
      payload.kind === "gate" &&
      payload.blocked === true;
    const status = isBlockedGateSkip ? "blocked" : NODE_STATE_MAP[event.type];
    const startsNode =
      event.type === "node.starting" ||
      event.type === "node.running";
    const endsNode =
      event.type === "node.completed" ||
      event.type === "node.failed" ||
      event.type === "node.cancelled" ||
      event.type === "node.skipped";
    next = {
      ...current,
      status,
      startedAt: startsNode ? current.startedAt ?? event.timestamp : current.startedAt,
      endedAt: endsNode ? event.timestamp ?? current.endedAt : current.endedAt,
      diagnostic: diagnosticFromNodeEvent(event, status, payload) ?? current.diagnostic,
    };
  } else if (event.type === "node.stdout") {
    next = appendLine(current, { stream: "stdout", text: str(payload.line) });
  } else if (event.type === "node.stderr") {
    next = appendLine(current, { stream: "stderr", text: str(payload.line) });
  } else if (event.type === "node.timeout" || event.type === "node.rule.warning") {
    next = {
      ...current,
      diagnostic: diagnosticFromNodeEvent(event, current.status, payload) ?? current.diagnostic,
    };
  } else if (event.type === "node.patch") {
    next = {
      ...current,
      patch: {
        length:
          typeof payload.patchLength === "number"
            ? payload.patchLength
            : undefined,
        preview: str(payload.patchPreview),
      },
    };
  } else if (event.type === "node.output") {
    next = { ...current, output: payload.output, outputParseFailed: false };
  } else if (event.type === "node.output_parse_failed") {
    next = { ...current, outputParseFailed: true };
  } else if (event.type === "node.worktree.created") {
    next = {
      ...current,
      worktree: { path: str(payload.worktreePath), branch: str(payload.branchName) },
    };
  } else if (event.type === "node.plan.started") {
    next = { ...current, status: "running", plan: { status: "planning", payload } };
  } else if (event.type === "node.plan.context_required") {
    next = { ...current, status: "blocked", plan: { status: "context_required", payload } };
  } else if (event.type === "node.plan.proposal_ready") {
    next = { ...current, status: "blocked", plan: { status: "proposal_ready", payload } };
  } else if (event.type === "node.plan.failed") {
    next = { ...current, status: "failed", plan: { status: "failed", payload } };
  } else if (event.type === "node.plan.applied") {
    next = { ...current, status: "success", plan: { status: "applied", payload } };
  } else if (event.type === "node.plan.apply.failed") {
    next = { ...current, status: "failed", plan: { status: "failed", payload } };
  } else if (event.type === "node.gate.evaluating") {
    next = { ...current, status: "running", gate: { status: "evaluating", payload } };
  } else if (event.type === "node.gate.passed") {
    next = { ...current, status: "success", gate: { status: "passed", payload } };
  } else if (event.type === "node.gate.blocked") {
    next = { ...current, status: "blocked", gate: { status: "blocked", payload } };
  } else if (event.type === "node.loop.started" || event.type === "node.loop.iteration.started") {
    next = { ...current, status: "running", loop: { status: "running", payload } };
  } else if (event.type === "node.loop.iteration" || event.type === "node.loop.iteration.completed") {
    next = { ...current, loop: { status: current.loop?.status ?? "running", payload } };
  } else if (event.type === "node.loop.break") {
    next = { ...current, status: "success", loop: { status: "completed", payload } };
  } else if (event.type === "node.loop.exhausted") {
    next = { ...current, status: "failed", loop: { status: "exhausted", payload } };
  } else if (event.type === "node.loop.failed") {
    const loopStatus = payload.status === "cancelled" ? "cancelled" : "failed";
    next = { ...current, status: loopStatus, loop: { status: loopStatus, payload } };
  } else {
    // Unknown/no-op event: still register the node terminal.
    if (known) return stateWithActivity;
  }

  return { ...stateWithActivity, order, nodes: { ...stateWithActivity.nodes, [nodeId]: next } };
}

export function nodePlanStateMap(state: RunViewState): Record<string, string> {
  const map: Record<string, string> = {};
  for (const nodeId of state.order) {
    const plan = state.nodes[nodeId]?.plan;
    if (plan) map[nodeId] = plan.status;
  }
  return map;
}

export function nodeElapsedLabelMap(
  state: RunViewState,
  nowMs: number,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const nodeId of state.order) {
    const node = state.nodes[nodeId];
    if (!node?.startedAt) continue;
    const start = Date.parse(node.startedAt);
    const end = node.endedAt ? Date.parse(node.endedAt) : nowMs;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    map[nodeId] = formatElapsedTime(end - start);
  }
  return map;
}

/** Fold a batch of events (convenience). */
export function applyEvents(
  state: RunViewState,
  events: RuntimeEvent[],
): RunViewState {
  return events.reduce(runReducer, state);
}

/**
 * Live per-node status map (`nodeId → status`) derived from the run state.
 * Lets the canvas colour each GraphNode in real time off the same SSE stream
 * the run viewer consumes. Statuses are the shared runtime vocabulary
 * (pending/starting/running/success/failed/skipped/cancelled).
 */
export function nodeStatusMap(state: RunViewState): Record<string, string> {
  const map: Record<string, string> = {};
  for (const nodeId of state.order) {
    const node = state.nodes[nodeId];
    if (node) map[nodeId] = node.status;
  }
  return map;
}

/** One row of the live worktree map (VIS-3). */
export interface WorktreeEntry {
  nodeId: string;
  path?: string;
  branch?: string;
  status: string;
}

/**
 * VIS-3: live worktree map derived entirely from existing `node.worktree.created`
 * data (already folded into `NodeTerminal.worktree`). Returns one ordered entry
 * per node that has been assigned a worktree/branch — so `gate`/`skipped` and
 * not-yet-started nodes (no worktree) are naturally excluded. Framework-free and
 * unit-testable, mirroring `nodeStatusMap`. No backend change.
 */
export function worktreeMap(state: RunViewState): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const nodeId of state.order) {
    const node = state.nodes[nodeId];
    const worktree = node?.worktree;
    if (worktree && (worktree.path || worktree.branch)) {
      entries.push({
        nodeId,
        path: worktree.path,
        branch: worktree.branch,
        status: node.status,
      });
    }
  }
  return entries;
}


// ── Historical run replay ──────────────────────────────────────────────────
// A finished/in-progress run persists its events in Mongo as
// `nodeRuns[nodeId].events: { ts, level, payload }[]`, where the ORIGINAL
// runtime event `type` is preserved inside `payload.type` (see
// MongoRunRepository.appendNodeEvent). `runDocToEvents` reverses that mapping so
// a stored run doc can be folded back through `runReducer`/`applyEvents` into
// the exact terminal view it streamed live — letting the run viewer replay any
// historical run. Run-level lifecycle events aren't persisted (they have no
// nodeId), so we synthesize them from the run's `status` field.

/** Shape of a persisted node-run event (subset of INodeRunEvent). */
export interface PersistedRunEvent {
  ts?: string;
  level?: string;
  payload?: Record<string, unknown> | null;
}

/** Shape of a persisted node-run (subset of INodeRun). */
export interface PersistedNodeRun {
  nodeId?: string;
  status?: string;
  events?: PersistedRunEvent[];
}

/** Minimal run-doc shape needed to reconstruct the run view. */
export interface RunDocLike {
  status?: string;
  nodeRuns?: Map<string, PersistedNodeRun> | Record<string, PersistedNodeRun> | null;
}

// Reverse of NODE_STATE_MAP: UI status → a synthetic lifecycle event type. Used
// to guarantee each node ends on its persisted final status even if a lifecycle
// event wasn't captured among the stored events.
const STATUS_TO_EVENT: Record<string, string> = {
  pending: "node.queued",
  starting: "node.starting",
  running: "node.running",
  success: "node.completed",
  failed: "node.failed",
  cancelled: "node.cancelled",
  skipped: "node.skipped",
};

function runStatusEvent(runId: string, status: string | undefined): RuntimeEvent {
  // The reducer's run-view vocabulary is idle/running/completed/failed. Map a
  // cancelled run to `failed` (closest terminal state).
  if (status === "completed" || status === "success")
    return { type: "run.completed", runId };
  if (status === "failed" || status === "cancelled")
    return { type: "run.failed", runId };
  return { type: "run.started", runId };
}

function entriesOf(
  nodeRuns: RunDocLike["nodeRuns"],
): [string, PersistedNodeRun][] {
  if (!nodeRuns) return [];
  if (nodeRuns instanceof Map) return [...nodeRuns.entries()];
  return Object.entries(nodeRuns);
}

/**
 * Reconstruct an ordered `RuntimeEvent[]` from a persisted run document. Folding
 * the result through `applyEvents(initialRunState, …)` reproduces the run's
 * terminal view. Real events are emitted in chronological (`ts`) order; a
 * synthetic final-status event per node and a run-level lifecycle event are
 * appended so the view always reflects the persisted terminal state.
 */
export function runDocToEvents(
  runId: string,
  run: RunDocLike,
): RuntimeEvent[] {
  const real: { ts: string; ev: RuntimeEvent }[] = [];
  const finals: RuntimeEvent[] = [];

  for (const [key, nodeRun] of entriesOf(run.nodeRuns)) {
    const nodeId = nodeRun?.nodeId ?? key;
    for (const e of nodeRun?.events ?? []) {
      const payload = (e.payload ?? {}) as Record<string, unknown>;
      const { type, ...rest } = payload as { type?: unknown } & Record<string, unknown>;
      if (typeof type !== "string") continue; // not a reconstructable event
      real.push({
        ts: e.ts ?? "",
        ev: { type, runId, nodeId, timestamp: e.ts, payload: rest },
      });
    }
    // Synthetic final status so the node terminal reflects its persisted state
    // even when the lifecycle event wasn't among the stored events.
    const finalType = nodeRun?.status ? STATUS_TO_EVENT[nodeRun.status] : undefined;
    if (finalType) finals.push({ type: finalType, runId, nodeId });
  }

  // Stable chronological sort of the real events (string `ts` is ISO-comparable).
  real.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  return [
    ...real.map((r) => r.ev),
    ...finals,
    runStatusEvent(runId, run.status),
  ];
}
