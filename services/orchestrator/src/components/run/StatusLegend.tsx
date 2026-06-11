"use client";

import { statusColor } from "@/lib/status";

// The live per-node states the runtime streams (shared status vocabulary).
const LEGEND = ["pending", "running", "success", "failed", "skipped", "cancelled"] as const;

/** Compact legend mapping each live node status to its colour. */
export function StatusLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Node status legend">
      {LEGEND.map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: statusColor(status) }}
            aria-hidden
          />
          <span className="text-[10px] uppercase tracking-wide text-faint">{status}</span>
        </li>
      ))}
    </ul>
  );
}
