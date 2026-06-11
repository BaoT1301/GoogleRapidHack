"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/cn";
import { currentSprintNumber, type SprintProgress } from "@/server/graphs/plan-progress";

/**
 * PLAN-5 — the "second brain" ledger. Aggregates live progress across a plan's
 * linked sprint graphs (PLAN-4) into an ordered, per-sprint / per-track status
 * view. Read-only; refreshes by polling the `graphs.planProgress` query on a
 * bounded interval (no new SSE event types). Absent-safe: renders nothing when
 * the plan has no sprint graphs.
 */
export function PlanLedger({ planId }: { planId: string }) {
  const trpc = useTRPC();
  const q = useQuery(
    trpc.graphs.planProgress.queryOptions(
      { planId },
      { refetchInterval: 4000, refetchOnWindowFocus: false },
    ),
  );
  const sprints = (q.data?.sprints ?? []) as SprintProgress[];
  if (sprints.length === 0) return null;
  return <PlanLedgerView sprints={sprints} />;
}

/**
 * Presentational ledger — pure (no data fetching), exported for isolated tests.
 * Mirrors the `PlanBacklog` styling; the active sprint is marked `aria-current`.
 */
export function PlanLedgerView({ sprints }: { sprints: SprintProgress[] }) {
  const current = currentSprintNumber(sprints);
  return (
    <section
      aria-label="Plan progress ledger"
      className="flex max-h-[60vh] w-72 flex-col gap-2 overflow-y-auto rounded-md border border-border bg-panel/85 p-3 backdrop-blur-xl"
    >
      <span className="text-xs font-medium tracking-wide text-muted">Plan progress</span>
      <ol className="flex flex-col gap-2">
        {sprints.map((s) => {
          const isCurrent = s.sprintNumber !== undefined && s.sprintNumber === current;
          return (
            <li
              key={s.graphId}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "rounded-sm border px-3 py-2 text-xs",
                isCurrent ? "border-accent/60 bg-accent/10" : "border-border bg-surface",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-content">
                  Sprint {s.sprintNumber ?? "?"}: {s.sprintName ?? s.name}
                </span>
                <StatusBadge status={s.status} />
              </div>
              {s.nodes.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {s.nodes.map((n) => (
                    <li key={n.nodeId} className="flex items-center justify-between gap-2">
                      <span className="truncate text-faint">{n.label}</span>
                      <StatusBadge status={n.status} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
