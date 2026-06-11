"use client";

import { useEffect, useReducer, useRef } from "react";
import { XIcon, GitBranchIcon } from "@phosphor-icons/react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { RunTerminal } from "@/components/run/RunTerminal";
import { subscribeToRun } from "@/components/run/run-stream";
import { initialRunState, runReducer } from "@/lib/run-events";

/**
 * WOW-4: a side-panel that follows a spawned fixer's CHILD run live. It reuses
 * the same SSE pipeline as the main run viewer — `subscribeToRun` +
 * `lib/run-events.runReducer` + `RunTerminal` (Do-Not-Invent) — against the
 * child `runId` returned by `graphs.spawnChild({ autoStart: true })` (WOW-1).
 *
 * It only *consumes* the documented event stream; it never starts/stops a run
 * and never redefines the status vocabulary. The run-level `node.child_run.started`
 * linkage frame is harmlessly ignored by the shared reducer.
 */
export function ChildRunPanel({
  runId,
  label,
  onClose,
}: {
  runId: string;
  label?: string;
  onClose: () => void;
}) {
  const [state, dispatch] = useReducer(runReducer, initialRunState);
  const unsubRef = useRef<() => void>(() => {});

  // Attach to the child run's live stream; tear down on unmount / runId change.
  useEffect(() => {
    unsubRef.current();
    unsubRef.current = subscribeToRun(runId, dispatch);
    return () => unsubRef.current();
  }, [runId]);

  return (
    <aside
      className="flex h-full w-[360px] shrink-0 flex-col border-l border-border bg-panel"
      aria-label="Child run"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranchIcon size={14} className="shrink-0 text-faint" />
          <h2 className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            {label ?? "Fixer run"}
          </h2>
          <StatusBadge status={state.status} />
        </div>
        <button
          onClick={onClose}
          aria-label="Close child run panel"
          className="grid h-7 w-7 place-items-center rounded-sm text-faint hover:bg-hover hover:text-content"
        >
          <XIcon size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {state.order.length > 0 ? (
          <div className="flex h-full flex-col gap-3">
            {state.order.map((id) => (
              <div key={id} className="min-h-[160px] flex-1">
                <RunTerminal terminal={state.nodes[id]} />
              </div>
            ))}
          </div>
        ) : (
          <p className="px-2 py-6 text-center text-xs text-faint">
            Waiting for the fixer to start…
          </p>
        )}
      </div>
    </aside>
  );
}
