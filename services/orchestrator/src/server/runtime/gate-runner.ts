// gate-runner — pure gate fan-in resolution (RUN-3).
//
// A `gate` node is the explicit convergence/merge point for parallel tracks.
// Its fan-in mode is read from its INCOMING flow edges' `fanInMode`
// (`IEdgeSpec.fanInMode`): `any-of` when at least one incoming flow edge is
// marked `any-of`, otherwise the default `all-of`. The actual scheduling
// (when a gate becomes ready / is skipped) lives in `simple-scheduler`; this
// module is the side-effect-free verdict logic so it can be unit-tested in
// isolation and reused by both the scheduler and `run-executor`.
import type { SimpleSchedulerEdge } from "./simple-scheduler";

export type FanInMode = "all-of" | "any-of";

export type UpstreamStatus = "success" | "failed" | "skipped" | "blocked";

export interface GateUpstream {
  nodeId: string;
  status: UpstreamStatus;
}

export interface GateResolution {
  status: "success" | "blocked";
  fanInMode: FanInMode;
  satisfied: boolean;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  blockedCount: number;
  upstreamCount: number;
  reason: string;
}

/** An edge that may carry a flow-edge fan-in mode (graph-model `IEdgeSpec`). */
type FanInEdge = SimpleSchedulerEdge & { fanInMode?: FanInMode };

/**
 * Resolve a gate's fan-in mode from its incoming flow edges. Default `all-of`;
 * `any-of` when at least one incoming flow edge is explicitly `any-of`.
 * (Flow edges are `kind === "flow"` or undefined — matching the scheduler.)
 */
export function resolveGateFanInMode(
  gateNodeId: string,
  edges: FanInEdge[],
): FanInMode {
  const incomingFlow = edges.filter(
    (edge) =>
      (edge.kind === undefined || edge.kind === "flow") &&
      edge.target === gateNodeId,
  );
  return incomingFlow.some((edge) => edge.fanInMode === "any-of")
    ? "any-of"
    : "all-of";
}

/**
 * Pure fan-in verdict. A gate without gated upstreams is blocked because it is
 * not actually converging anything. `all-of` is satisfied only when every gated
 * upstream succeeded; `any-of` is satisfied when at least one did. Anything
 * else is `blocked`.
 */
export function resolveGate(input: {
  fanInMode: FanInMode;
  upstreams: GateUpstream[];
}): GateResolution {
  const { fanInMode, upstreams } = input;
  const upstreamCount = upstreams.length;
  const succeededCount = upstreams.filter((u) => u.status === "success").length;
  const failedCount = upstreams.filter((u) => u.status === "failed").length;
  const skippedCount = upstreams.filter((u) => u.status === "skipped").length;
  const blockedCount = upstreams.filter((u) => u.status === "blocked").length;

  const satisfied =
    upstreamCount > 0 &&
    (fanInMode === "any-of"
      ? succeededCount > 0
      : succeededCount === upstreamCount);

  return {
    status: satisfied ? "success" : "blocked",
    fanInMode,
    satisfied,
    succeededCount,
    failedCount,
    skippedCount,
    blockedCount,
    upstreamCount,
    reason:
      upstreamCount === 0
        ? "gate blocked: no incoming flow predecessors"
        : `gate ${satisfied ? "satisfied" : "blocked"} (${fanInMode}: ${succeededCount}/${upstreamCount} upstream succeeded)`,
  };
}
