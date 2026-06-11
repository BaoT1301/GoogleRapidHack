"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useToast } from "@/components/ui/Toast";
import {
  subscribeToRun,
  subscribeToFakeRun,
  type FakeNode,
} from "@/components/run/run-stream";
import {
  initialRunState,
  nodeElapsedLabelMap,
  nodePlanStateMap,
  nodeStatusMap,
  runReducer,
  runDocToEvents,
  type RunDocLike,
} from "@/lib/run-events";
import type {
  GateRunOutput,
  LoopRunOutput,
  PlanRunOutput,
} from "@/components/run/RunTerminal";

export interface UseRunControllerArgs {
  graphId: string;
  executeNodes: FakeNode[];
  hasRepoPath: boolean;
  /**
   * Whether the run drawer is currently open. Used only to gate the run-history
   * query so it doesn't fetch eagerly for every graph that never opens the
   * drawer. Defaults to enabled when omitted. The SSE/run state stays live
   * regardless so the header Stop button works while the drawer is closed.
   */
  panelOpen?: boolean;
  onBeforeRun?: () => Promise<unknown>;
  onNodeStatuses?: (statuses: Record<string, string>) => void;
  onNodePlanStates?: (statuses: Record<string, string>) => void;
  onNodeElapsedLabels?: (labels: Record<string, string>) => void;
  onApplyPlanProposal?: (input: { runId: string; nodeId: string }) => Promise<void> | void;
}

export type RunView = "terminals" | "worktrees";

/**
 * Shared run orchestration: owns the reducer-driven run state, the
 * create/start/cancel mutations, the SSE subscription lifecycle, history
 * replay, and the derived per-node outputs. Consumed by BOTH the header
 * Run/Stop button and the RunDrawer body so they stay in lock-step.
 *
 * The launch path strictly preserves the ordering
 * `flush → create → subscribe(open) → start`: a fast run can finish in
 * <300ms, so we must attach the live stream before starting.
 */
export function useRunController({
  graphId,
  executeNodes,
  hasRepoPath,
  panelOpen = true,
  onBeforeRun,
  onNodeStatuses,
  onNodePlanStates,
  onNodeElapsedLabels,
  onApplyPlanProposal,
}: UseRunControllerArgs) {
  const trpc = useTRPC();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(runReducer, initialRunState);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [applyingPlanNodeId, setApplyingPlanNodeId] = useState<string | null>(null);
  const [confirmStopOpen, setConfirmStopOpen] = useState(false);
  const [view, setView] = useState<RunView>("terminals");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const unsubRef = useRef<() => void>(() => {});
  // Re-entrancy guard: blocks a second launch during the create→subscribe→start
  // window where neither mutation reports `isPending` yet.
  const launchingRef = useRef(false);

  // Push live per-node status to the canvas (real-time node colouring).
  useEffect(() => {
    onNodeStatuses?.(nodeStatusMap(state));
    onNodePlanStates?.(nodePlanStateMap(state));
    onNodeElapsedLabels?.(nodeElapsedLabelMap(state, clockNow));
  }, [clockNow, state, onNodeElapsedLabels, onNodePlanStates, onNodeStatuses]);

  useEffect(() => {
    if (state.status !== "running") return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.status]);

  const history = useQuery(
    trpc.runs.listForGraph.queryOptions(
      { graphId, limit: 10 },
      // Don't fetch history for graphs whose drawer never opens; still load it
      // while a run is active so reopening shows the in-flight run.
      { enabled: panelOpen || Boolean(activeRunId) },
    ),
  );
  const createRun = useMutation(trpc.runs.create.mutationOptions());
  const startRun = useMutation(trpc.runs.start.mutationOptions());
  const cancelRun = useMutation(trpc.runs.cancel.mutationOptions());
  const activeRun = useQuery(
    trpc.runs.getById.queryOptions(
      { runId: activeRunId ?? "" },
      {
        enabled: Boolean(activeRunId && !activeRunId.startsWith("fake_")),
        refetchInterval: state.status === "running" ? 1200 : false,
      },
    ),
  );

  // Tear down any active subscription on unmount.
  useEffect(() => () => unsubRef.current(), []);

  const labelFor = useCallback(
    (id: string) => executeNodes.find((n) => n.id === id)?.label ?? id,
    [executeNodes],
  );

  const outputFor = useCallback(
    <T,>(nodeId: string, key: "plan" | "gate" | "loop"): T | undefined => {
      const nodeRuns = (
        activeRun.data as
          | { nodeRuns?: Record<string, { outputs?: Record<string, unknown> }> }
          | undefined
      )?.nodeRuns;
      const value = nodeRuns?.[nodeId]?.outputs?.[key];
      return value && typeof value === "object" ? (value as T) : undefined;
    },
    [activeRun.data],
  );

  const planOutputFor = useCallback(
    (nodeId: string) => outputFor<PlanRunOutput>(nodeId, "plan"),
    [outputFor],
  );
  const gateOutputFor = useCallback(
    (nodeId: string) => outputFor<GateRunOutput>(nodeId, "gate"),
    [outputFor],
  );
  const loopOutputFor = useCallback(
    (nodeId: string) => outputFor<LoopRunOutput>(nodeId, "loop"),
    [outputFor],
  );

  const applyPlanProposal = useCallback(
    async (nodeId: string) => {
      if (!activeRunId || !onApplyPlanProposal) return;
      try {
        setApplyingPlanNodeId(nodeId);
        await onApplyPlanProposal({ runId: activeRunId, nodeId });
        await activeRun.refetch();
      } finally {
        setApplyingPlanNodeId(null);
      }
    },
    [activeRunId, onApplyPlanProposal, activeRun],
  );

  const startRealRun = useCallback(async () => {
    if (!hasRepoPath) {
      toast("Set a repo path on this graph before running", "error");
      return;
    }
    // Prevent a double-launch from rapid clicks / shortcut + click.
    if (launchingRef.current || state.status === "running") return;
    launchingRef.current = true;
    try {
      unsubRef.current();
      // Clear any previous run's terminals so a re-run starts from a clean
      // slate (node ids are stable across runs, so stale lines would otherwise
      // bleed into the new run's output).
      dispatch({ type: "run.reset", runId: "" });
      // Flush the debounced canvas save so the run snapshots the latest graph.
      await onBeforeRun?.();
      const run = await createRun.mutateAsync({ graphId });
      const runId = String((run as { _id: unknown })._id);
      setActiveRunId(runId);
      // Attach the live stream BEFORE starting (fast runs finish in <300ms).
      await new Promise<void>((resolve, reject) => {
        unsubRef.current = subscribeToRun(runId, dispatch, resolve, () => {
          reject(new Error("Run event stream failed to open"));
        });
      });
      await startRun.mutateAsync({ runId });
      history.refetch();
    } catch (error) {
      unsubRef.current();
      unsubRef.current = () => {};
      setActiveRunId(null);
      dispatch({ type: "run.reset", runId: "" });
      const message = error instanceof Error && /event stream/i.test(error.message)
        ? "Failed to start run: event stream could not connect"
        : "Failed to start run";
      toast(message, "error");
    } finally {
      launchingRef.current = false;
    }
  }, [hasRepoPath, state.status, onBeforeRun, createRun, graphId, startRun, history, toast]);

  const stopRun = useCallback(async () => {
    if (!activeRunId) return;
    try {
      await cancelRun.mutateAsync({ runId: activeRunId });
      toast("Run cancelled", "info");
      history.refetch();
    } catch {
      toast("Failed to cancel run", "error");
    } finally {
      setConfirmStopOpen(false);
    }
  }, [activeRunId, cancelRun, history, toast]);

  const startFakeRun = useCallback(() => {
    unsubRef.current();
    if (executeNodes.length === 0) {
      toast("Add an Execute node first", "error");
      return;
    }
    dispatch({ type: "run.reset", runId: "" });
    const runId = `fake_${Date.now()}`;
    setActiveRunId(runId);
    unsubRef.current = subscribeToFakeRun(runId, executeNodes, dispatch);
  }, [executeNodes, toast]);

  // Open a past run from history: rebuild its terminal view from the persisted
  // events, then re-attach the live SSE stream if the run is still in progress.
  const openHistoricalRun = useCallback(
    async (runId: string) => {
      try {
        unsubRef.current();
        dispatch({ type: "run.reset", runId });
        const run = (await queryClient.fetchQuery(
          trpc.runs.getById.queryOptions({ runId }),
        )) as RunDocLike;
        for (const event of runDocToEvents(runId, run)) dispatch(event);
        setActiveRunId(runId);
        // Still running → follow it live; finished runs stay a static replay.
        if (run.status === "running") {
          unsubRef.current = subscribeToRun(runId, dispatch);
        }
      } catch {
        toast("Failed to open run", "error");
      }
    },
    [queryClient, trpc, toast],
  );

  // Return from a run's terminals to the history list.
  const backToHistory = useCallback(() => {
    unsubRef.current();
    unsubRef.current = () => {};
    dispatch({ type: "run.reset", runId: activeRunId ?? "" });
    setActiveRunId(null);
    history.refetch();
  }, [activeRunId, history]);

  const isStarting = createRun.isPending || startRun.isPending;
  const isRunning = state.status === "running";

  return {
    // state
    state,
    activeRunId,
    totalNodeCount: executeNodes.length,
    view,
    setView,
    isRunning,
    isStarting,
    hasActiveView: state.order.length > 0,
    cancelPending: cancelRun.isPending,
    confirmStopOpen,
    openStopConfirm: () => setConfirmStopOpen(true),
    closeStopConfirm: () => setConfirmStopOpen(false),
    applyingPlanNodeId,
    // history
    history: {
      loading: history.isLoading,
      error: history.isError,
      runs: (history.data ?? []) as { _id: unknown; status: string }[],
    },
    // actions
    startRealRun,
    stopRun,
    startFakeRun,
    openHistoricalRun,
    backToHistory,
    applyPlanProposal,
    canApplyPlanProposal: Boolean(onApplyPlanProposal),
    // derived accessors
    labelFor,
    planOutputFor,
    gateOutputFor,
    loopOutputFor,
  };
}

export type RunController = ReturnType<typeof useRunController>;
