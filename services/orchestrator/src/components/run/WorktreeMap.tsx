"use client";

import { GitBranchIcon, FolderIcon } from "@phosphor-icons/react";
import { statusColor } from "@/lib/status";
import { worktreeMap, type RunViewState } from "@/lib/run-events";

/**
 * VIS-3: live worktree map — which node/agent is working in which worktree path
 * + branch. Derived from existing `node.worktree.created` data via the pure
 * `worktreeMap` selector (no backend change). Handles the empty / no-worktree
 * states gracefully (gate/skipped/not-started nodes have no worktree row).
 */
export function WorktreeMap({
  state,
  labelFor,
}: {
  state: RunViewState;
  labelFor?: (nodeId: string) => string;
}) {
  const entries = worktreeMap(state);

  if (entries.length === 0) {
    return (
      <p className="grid h-full place-items-center px-6 text-center text-xs text-faint">
        No worktrees yet. Each execute node gets one when it starts.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2 p-3" aria-label="Worktree map">
      {entries.map((e) => (
        <li
          key={e.nodeId}
          className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: statusColor(e.status) }}
              aria-hidden
            />
            <span className="truncate text-xs font-semibold text-content">
              {labelFor?.(e.nodeId) ?? e.nodeId}
            </span>
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-faint">
              {e.status}
            </span>
          </div>
          {e.branch && (
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
              <GitBranchIcon size={12} className="shrink-0 text-faint" />
              <span className="truncate">{e.branch}</span>
            </div>
          )}
          {e.path && (
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-faint">
              <FolderIcon size={12} className="shrink-0" />
              <span className="truncate">{e.path}</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
