"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";

type Strategy = "base-fanin" | "lineage";

/**
 * Merge-back model toggle. `base-fanin` (default) merges every successful track
 * independently into the graph's base branch. `lineage` forks each node from its
 * parent branch(es) (convergence nodes merge their parents) and merges only the
 * leaf/terminal node into base, pruning intermediate branches. Persisted via
 * `settings.update`; read by the run path (`resolveMergeStrategy`).
 */
export function MergeStrategyToggle({ enabled = true }: { enabled?: boolean }) {
  const trpc = useTRPC();
  const settings = useQuery(trpc.settings.get.queryOptions(undefined, { enabled }));
  const update = useMutation(
    trpc.settings.update.mutationOptions({ onSuccess: () => settings.refetch() }),
  );

  const active = ((settings.data as { mergeStrategy?: Strategy } | undefined)?.mergeStrategy ??
    "base-fanin") as Strategy;

  const select = (strategy: Strategy) => {
    if (strategy !== active) update.mutate({ mergeStrategy: strategy });
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Merge strategy" className="grid grid-cols-2 gap-2">
        <StrategyCard
          label="Fan-in to base"
          sub="Every track merges into the base branch"
          active={active === "base-fanin"}
          onSelect={() => select("base-fanin")}
        />
        <StrategyCard
          label="Lineage (stacked)"
          sub="Nodes fork from parents; only the leaf merges to base"
          badge="new"
          active={active === "lineage"}
          onSelect={() => select("lineage")}
        />
      </div>
      <p className="text-xs text-faint">
        Active model:{" "}
        <span className="text-content">
          {active === "lineage" ? "Lineage (stacked branches)" : "Fan-in to base"}
        </span>
      </p>
    </div>
  );
}

function StrategyCard({
  label,
  sub,
  active,
  onSelect,
  badge,
}: {
  label: string;
  sub: string;
  active: boolean;
  onSelect: () => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={[
        "flex flex-col items-start gap-1 rounded-sm border p-3 text-left transition-colors",
        active
          ? "border-accent/60 bg-accent/10"
          : "border-border bg-surface hover:border-border-strong",
      ].join(" ")}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-content">
        {label}
        {badge ? (
          <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-accent">
            {badge}
          </span>
        ) : null}
        {active ? <span className="text-[10px] text-accent">· active</span> : null}
      </span>
      <span className="text-[11px] text-faint">{sub}</span>
    </button>
  );
}
