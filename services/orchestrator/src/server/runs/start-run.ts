import { getRunGateway } from "../data/run-gateway";

export interface StartRunForGraphInput {
  graphId: string;
  ownerId: string;
}

/**
 * WOW-1 spawn-and-run seam. Create a `Run` for an owned graph (immutable
 * `graphSnapshot`) and fire its execution fire-and-forget — progress streams
 * over SSE (`GET /api/runs/:runId/events`) and the final state lands in Mongo.
 *
 * This is the SAME run path the `runs.create` + `runs.start` tRPC mutations use
 * (snapshot → `executeRun`); it merely combines them in one owner-scoped helper
 * so `graphs.spawnChild({ autoStart: true })` can start the child it just
 * created WITHOUT duplicating `executeRun` (Do-Not-Invent).
 *
 * Owner-scoped: returns `null` when the graph is not owned by the caller (the
 * caller maps that to a 404). A child whose inherited `rootRepoPath` is missing
 * still fails honestly inside `executeRun` (`run.failed`).
 */
export async function startRunForGraph(
  input: StartRunForGraphInput,
): Promise<string | null> {
  // P0-full: create the run through the gateway (Mongo, or the cloud BFF in BFF
  // mode). Returns null when the graph is not owned by the caller (→ 404).
  const run = await getRunGateway().create(input.ownerId, input.graphId);
  if (!run) return null;
  const runId = String(run._id);

  // Lazy-import the runtime so its heavy modules only load when a run starts
  // (mirrors `runs.start`). Don't await — the UI follows via SSE.
  const { executeRun } = await import("../runtime/run-executor");
  void executeRun(runId, input.ownerId).catch((err) => {
    console.error(`[startRunForGraph] run ${runId} crashed:`, err);
  });
  return runId;
}
