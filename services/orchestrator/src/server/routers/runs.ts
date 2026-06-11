import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, createTRPCRouter } from "../init";
import { EVENT_LEVELS } from "../../db/models/run.model";
import { getRunGateway } from "../data/run-gateway";
import { sseHub } from "../sse/hub";
import { redactSecrets } from "../runtime/secret-redaction";
import {
  deriveFixerContext,
  type FixerNodeContext,
  type PersistedNodeRunLike,
} from "../runs/fixer-context";

const eventInput = z.object({
  ts: z.string(),
  level: z.enum(EVENT_LEVELS),
  payload: z.any(),
});

// Runs persistence routes through the run gateway (Mongo by default; the cloud BFF
// over the SERVICE path when BFF_URL is set, authenticated per request by a per-user
// run token). Run EXECUTION (start/cancel) stays local — only persistence + ownership
// reads hop. SSE emission stays local + real-time. authedProcedure (not dbProcedure):
// the Mongo gateway self-connects; the BFF gateway needs no local DB.

export const runsRouter = createTRPCRouter({
  // Start a run: snapshots the (owned) graph immutably.
  create: authedProcedure
    .input(z.object({ graphId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const run = await getRunGateway().create(ctx.userId, input.graphId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      return run;
    }),

  getById: authedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ ctx, input }) => {
      const run = await getRunGateway().getById(ctx.userId, input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      return run;
    }),

  // WOW-3: read-only fixer context — per requested node, the node's latest diff
  // preview + last error from THIS run's persisted state. Owner-scoped; never
  // writes; never leaks secrets (derives from already-redacted persisted events).
  fixerContext: authedProcedure
    .input(z.object({ runId: z.string(), nodeIds: z.array(z.string()).min(1) }))
    .query(async ({ ctx, input }): Promise<FixerNodeContext[]> => {
      const run = await getRunGateway().getById(ctx.userId, input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });

      const snapshot = run.graphSnapshot as { nodes?: { id: string; label?: string }[] };
      const labelOf = (nodeId: string) =>
        (snapshot.nodes ?? []).find((n) => n.id === nodeId)?.label;
      const nodeRuns = run.nodeRuns as unknown as
        | Record<string, PersistedNodeRunLike>
        | undefined;

      return input.nodeIds.map((nodeId) =>
        deriveFixerContext(nodeId, nodeRuns?.[nodeId], labelOf(nodeId)),
      );
    }),

  listForGraph: authedProcedure
    .input(z.object({ graphId: z.string(), limit: z.number().min(1).max(100).default(10) }))
    .query(async ({ ctx, input }) => {
      return getRunGateway().listForGraph(ctx.userId, input.graphId, input.limit);
    }),

  // Update overall run status.
  updateStatus: authedProcedure
    .input(
      z.object({
        runId: z.string(),
        status: z.string(),
        finishedAt: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = await getRunGateway().updateStatus(
        ctx.userId,
        input.runId,
        input.status,
        input.finishedAt,
      );
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      // Notify run-level subscribers (local SSE).
      sseHub.emit(input.runId, {
        type: "run.status",
        status: input.status,
        ts: new Date().toISOString(),
      });
      return run;
    }),

  // Set/replace a node's run record (call this before appending events).
  updateNodeRun: authedProcedure
    .input(z.object({ runId: z.string(), nodeId: z.string(), nodeRun: z.any() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await getRunGateway().setNodeRun(ctx.userId, input.runId, input.nodeId, input.nodeRun);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok };
    }),

  // Append a BATCH of stdout/tool events (not one write per line — ADR AD-8).
  // Persists via the gateway (which redacts at the seam) AND streams live to SSE.
  appendEventsBatch: authedProcedure
    .input(
      z.object({
        runId: z.string(),
        nodeId: z.string(),
        events: z.array(eventInput).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Redact for the live SSE stream (the gateway redacts again for persistence).
      const events = input.events.map((e) => redactSecrets(e));
      const appended = await getRunGateway().appendEventsBatch(
        ctx.userId,
        input.runId,
        input.nodeId,
        events,
      );
      for (const ev of events) {
        sseHub.emitToNode(input.runId, input.nodeId, ev as Record<string, unknown>);
      }
      return { appended };
    }),

  // Start executing an owned run's nodes (local runtime). Fire-and-forget: returns
  // immediately; progress streams over SSE and final state persists (via the run
  // repository — Mongo or the cloud BFF). executeRun selects its persistence
  // backend internally from the env.
  start: authedProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const run = await getRunGateway().getById(ctx.userId, input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });

      const { executeRun } = await import("../runtime/run-executor");
      // Forward the user's live token so the start-time settings read (merge strategy)
      // resolves from the cloud BFF in BFF mode. Background execution thereafter uses
      // the run-token/service path; the user token is only needed for this start read.
      void executeRun(input.runId, ctx.userId, { token: ctx.token }).catch((err) => {
        console.error(`[runs.start] run ${input.runId} crashed:`, err);
      });
      return { started: true, runId: input.runId };
    }),

  // Phase 7.2: create and start a run for a spawned child graph. Persistence routes
  // through the run gateway (Mongo by default; the cloud BFF over the SERVICE path
  // when BFF_URL is set) — the gateway snapshots the child graph + stamps lineage and
  // validates ownership/parent-run server-side. Execution stays local.
  createAndStartChild: authedProcedure
    .input(
      z.object({
        childGraphId: z.string(),
        parentRunId: z.string().optional(),
        parentNodeIds: z.array(z.string().min(1)).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = await getRunGateway().createChild(ctx.userId, input.childGraphId, {
        parentRunId: input.parentRunId,
        parentNodeIds: input.parentNodeIds,
      });
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      const runId = String(run._id);

      const { executeRun } = await import("../runtime/run-executor");
      void executeRun(runId, ctx.userId, { token: ctx.token }).catch((err) => {
        console.error(`[runs.createAndStartChild] run ${runId} crashed:`, err);
      });

      return {
        started: true,
        runId,
        eventsUrl: `/api/runs/${runId}/events`,
        parentGraphId: run.parentGraphId as string | undefined,
        parentRunId: (run.parentRunId as string | undefined) ?? input.parentRunId,
        parentNodeIds: run.parentNodeIds as string[] | undefined,
        childGraphId: run.childGraphId as string | undefined,
        childRunId: (run.childRunId as string | undefined) ?? runId,
      };
    }),

  // Stop an owned run: kills its in-flight processes (local) + marks it cancelled.
  // Idempotent — cancelling a run with no live processes is a success (killed: 0).
  cancel: authedProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const run = await getRunGateway().getById(ctx.userId, input.runId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });

      const { sharedProcessManager } = await import("../runtime/run-executor");
      const killed = await sharedProcessManager.cancelRun(input.runId);

      await getRunGateway().updateStatus(
        ctx.userId,
        input.runId,
        "cancelled",
        new Date().toISOString(),
      );
      sseHub.emit(input.runId, {
        type: "run.cancelled",
        status: "cancelled",
        ts: new Date().toISOString(),
      });
      return { cancelled: true, runId: input.runId, killed };
    }),
});
