"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  CaretDownIcon,
  CaretUpIcon,
  FolderPlusIcon,
  PlayIcon,
  StopIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { RunTerminal } from "@/components/run/RunTerminal";
import { WorktreeMap } from "@/components/run/WorktreeMap";
import { StatusLegend } from "@/components/run/StatusLegend";
import { useResizableDrawer } from "@/lib/use-resizable-drawer";
import { cn } from "@/lib/cn";
import { formatElapsedTime } from "@/lib/run-events";
import type { RunController, RunView } from "@/components/run/useRunController";

/**
 * Persistent, resizable/collapsible bottom drawer that hosts the run
 * monitoring experience. Presentational: all run state + actions come from the
 * shared `useRunController` instance owned by the parent (so the canvas header
 * Run/Stop button stays in lock-step with the drawer).
 */
export function RunDrawer({
  controller,
  hasRepoPath,
  onClose,
  onRequestSetRepoPath,
}: {
  controller: RunController;
  hasRepoPath: boolean;
  onClose: () => void;
  /** Surface the repo-path setter when the graph can't run yet. */
  onRequestSetRepoPath?: () => void;
}) {
  const drawer = useResizableDrawer();
  const {
    state,
    activeRunId,
    totalNodeCount,
    view,
    setView,
    isRunning,
    hasActiveView,
    cancelPending,
    confirmStopOpen,
    openStopConfirm,
    closeStopConfirm,
    history,
    stopRun,
    openHistoricalRun,
    backToHistory,
    applyPlanProposal,
    canApplyPlanProposal,
    applyingPlanNodeId,
    labelFor,
    planOutputFor,
    gateOutputFor,
    loopOutputFor,
  } = controller;

  const showRepoGuidance = !hasRepoPath && !hasActiveView;
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [fallbackStartedAt, setFallbackStartedAt] = useState<number | null>(null);

  useEffect(() => {
    if (state.status === "running" && !state.startedAt && fallbackStartedAt == null) {
      setFallbackStartedAt(Date.now());
    }
    if (state.status !== "running") {
      setFallbackStartedAt(null);
    }
  }, [fallbackStartedAt, state.startedAt, state.status]);

  useEffect(() => {
    if (state.status !== "running") return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.status]);

  const runProgress = useMemo(
    () => computeRunProgress(state, totalNodeCount, clockNow, fallbackStartedAt),
    [clockNow, fallbackStartedAt, state, totalNodeCount],
  );

  return (
    <section
      className="flex flex-col border-t border-border bg-panel"
      aria-label="Run drawer"
    >
      {/* Drag-to-resize handle (top edge). Hidden when collapsed. */}
      {!drawer.collapsed && (
        <div
          {...drawer.dragHandleProps}
          className={cn(
            "group relative h-1.5 w-full cursor-row-resize touch-none",
            "before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-border",
            "hover:before:bg-accent focus-visible:outline-none focus-visible:before:bg-accent",
            drawer.isDragging && "before:bg-accent",
          )}
        />
      )}

      {/* Header bar — always visible, even when collapsed. */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={drawer.toggleCollapsed}
            aria-expanded={!drawer.collapsed}
            aria-label={drawer.collapsed ? "Expand run drawer" : "Collapse run drawer"}
            className="grid h-6 w-6 place-items-center rounded-sm text-faint transition-colors hover:bg-hover hover:text-content"
          >
            {drawer.collapsed ? <CaretUpIcon size={14} /> : <CaretDownIcon size={14} />}
          </button>
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Run
          </h2>
          {hasActiveView && (
            <button
              onClick={backToHistory}
              className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-faint transition-colors hover:bg-hover hover:text-content"
            >
              <ArrowLeftIcon size={12} /> Runs
            </button>
          )}
          {activeRunId && <StatusBadge status={state.status} />}
          {activeRunId && (
            <div
              className="flex min-w-[150px] items-center gap-2 rounded-full border border-border bg-surface px-2 py-1"
              title={`${runProgress.settled}/${runProgress.total} nodes settled`}
              aria-label={`Run elapsed ${runProgress.elapsedLabel}, ${runProgress.settled} of ${runProgress.total} nodes settled`}
            >
              <span className="font-mono text-[10px] text-muted">
                {runProgress.elapsedLabel}
              </span>
              <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-border">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width,background-color] duration-500",
                    state.status === "failed"
                      ? "bg-danger"
                      : state.status === "completed"
                        ? "bg-success"
                        : "bg-warning",
                  )}
                  style={{ width: `${runProgress.percent}%` }}
                />
              </div>
              <span className="text-[10px] text-faint">
                {runProgress.settled}/{runProgress.total}
              </span>
            </div>
          )}
          {!drawer.collapsed && activeRunId && <StatusLegend />}
          {!drawer.collapsed && hasActiveView && (
            <div className="flex gap-1" role="tablist" aria-label="Run view">
              {(["terminals", "worktrees"] as RunView[]).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={
                    "rounded-sm px-2 py-0.5 text-[10px] uppercase tracking-wide transition-colors " +
                    (view === v ? "bg-active text-content" : "text-faint hover:text-muted")
                  }
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <Button
              size="sm"
              variant="danger"
              onClick={openStopConfirm}
              disabled={cancelPending}
            >
              <StopIcon size={13} weight="fill" /> Stop
            </Button>
          )}
          <button
            onClick={onClose}
            aria-label="Close run drawer"
            className="grid h-7 w-7 place-items-center rounded-sm text-faint hover:bg-hover hover:text-content"
          >
            <XIcon size={15} />
          </button>
        </div>
      </div>

      {/* Body — hidden when collapsed; height driven by the resizable hook. */}
      {!drawer.collapsed && (
        <div className="min-h-0 overflow-hidden" style={{ height: drawer.height }}>
          {state.activity.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto border-b border-border bg-surface/60 px-4 py-1.5">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
                Progress
              </span>
              {state.activity.slice(-4).map((item) => (
                <span
                  key={item.id}
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[10px] tracking-wide",
                    item.tone === "success" && "border-success/30 bg-success/10 text-success",
                    item.tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
                    item.tone === "error" && "border-danger/30 bg-danger/10 text-danger",
                    item.tone === "info" && "border-border bg-panel text-muted",
                  )}
                  title={item.type}
                >
                  {item.message}
                </span>
              ))}
            </div>
          )}
          {showRepoGuidance ? (
            <div className="grid h-full place-items-center p-4">
              <EmptyState
                icon={<FolderPlusIcon size={20} weight="fill" />}
                title="Set a repo path to run"
                description="This graph isn't linked to a repository yet. Point it at a Git repo and the Run button will launch agents against it."
                action={
                  onRequestSetRepoPath ? (
                    <Button size="sm" variant="ghost" onClick={onRequestSetRepoPath}>
                      <FolderPlusIcon size={13} /> Set repo path
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : hasActiveView ? (
            view === "terminals" ? (
              <div className="flex h-full gap-3 overflow-x-auto p-3">
                {state.order.map((id) => (
                  <RunTerminal
                    key={id}
                    terminal={state.nodes[id]}
                    label={labelFor(id)}
                    planOutput={planOutputFor(id)}
                    gateOutput={gateOutputFor(id)}
                    loopOutput={loopOutputFor(id)}
                    onApplyPlanProposal={canApplyPlanProposal ? applyPlanProposal : undefined}
                    applyingPlanProposal={applyingPlanNodeId === id}
                    runId={activeRunId ?? undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="h-full overflow-y-auto">
                <WorktreeMap state={state} labelFor={labelFor} />
              </div>
            )
          ) : (
            <RunHistory
              loading={history.loading}
              error={history.error}
              runs={history.runs}
              onOpen={openHistoricalRun}
            />
          )}
        </div>
      )}

      <Dialog open={confirmStopOpen} onClose={closeStopConfirm} title="Stop run?">
        <div className="flex flex-col gap-5">
          <p className="text-sm leading-relaxed text-muted">
            Stop this run? Running agents will be terminated. Any work not yet
            merged back will be left in its worktree.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={closeStopConfirm}>
              Keep running
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={stopRun}
              loading={cancelPending}
            >
              <StopIcon size={13} weight="fill" /> Stop run
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}

function RunHistory({
  loading,
  error,
  runs,
  onOpen,
}: {
  loading: boolean;
  error: boolean;
  runs: { _id: unknown; status: string }[];
  onOpen: (runId: string) => void;
}) {
  if (loading) return <Centered>Loading run history…</Centered>;
  if (error) return <Centered>Couldn’t load run history.</Centered>;
  if (runs.length === 0)
    return (
      <div className="grid h-full place-items-center">
        <EmptyState
          icon={<PlayIcon size={20} weight="fill" />}
          title="No runs yet"
          description="Start a run to stream live node output here."
        />
      </div>
    );
  return (
    <ul className="divide-y divide-border overflow-y-auto p-2 text-sm">
      {runs.map((r) => {
        const id = String(r._id);
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => onOpen(id)}
              title="Open this run's output"
              className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-2 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <span className="truncate font-mono text-xs text-faint">{id}</span>
              <StatusBadge status={r.status} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">
      {children}
    </div>
  );
}

const SETTLED_NODE_STATUSES = new Set([
  "success",
  "failed",
  "skipped",
  "cancelled",
  "blocked",
]);

export function computeRunProgress(
  state: RunController["state"],
  minimumTotal: number,
  nowMs: number,
  fallbackStartedAt: number | null,
): {
  elapsedLabel: string;
  settled: number;
  total: number;
  percent: number;
} {
  const startMs = state.startedAt ? Date.parse(state.startedAt) : fallbackStartedAt;
  const endMs = state.endedAt ? Date.parse(state.endedAt) : undefined;
  const elapsedMs =
    startMs && Number.isFinite(startMs)
      ? Math.max(0, (endMs && Number.isFinite(endMs) ? endMs : nowMs) - startMs)
      : 0;
  const settled = state.order.filter((id) =>
    SETTLED_NODE_STATUSES.has(state.nodes[id]?.status),
  ).length;
  const total = Math.max(1, minimumTotal, state.order.length);
  const percent =
    state.status === "completed" || state.status === "failed"
      ? 100
      : Math.min(100, Math.max(4, Math.round((settled / total) * 100)));
  return {
    elapsedLabel: formatElapsedTime(elapsedMs),
    settled,
    total,
    percent,
  };
}
