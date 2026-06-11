"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Skeleton } from "@/components/ui/Skeleton";
import { CliAuthBadge } from "./CliAuthBadge";
import type { CliAuthMode } from "@/lib/cli-auth";

interface Capability {
  cli: string;
  available: boolean;
  authMode?: CliAuthMode;
  note?: string;
  suggestedFix?: string;
}

/**
 * Live CLI auth/availability list — finally feeds the presentational
 * `CliAuthBadge` real data from `system.capabilities` (RUN-8 carry-over closed).
 * CLIs that expose an `authMode` (kiro) render the full auth badge; others show a
 * compact availability line. Never renders a key value (AD-8).
 */
export function CliCapabilities({ enabled = true }: { enabled?: boolean }) {
  const trpc = useTRPC();
  const q = useQuery(
    trpc.system.capabilities.queryOptions(undefined, {
      enabled,
      refetchOnWindowFocus: false,
    }),
  );

  if (q.isFetching && !q.data) {
    return (
      <ul className="flex flex-col gap-2" aria-busy aria-label="Detecting installed CLIs">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-2">
            <Skeleton rounded="full" className="h-2 w-2" />
            <Skeleton className="h-3 w-40" />
          </li>
        ))}
      </ul>
    );
  }
  if (q.isError) {
    return (
      <p role="alert" className="text-xs text-danger">
        Could not load CLI capabilities.
      </p>
    );
  }

  const caps = (q.data as Capability[] | undefined) ?? [];
  if (caps.length === 0) {
    return <p className="text-xs text-faint">No CLIs detected.</p>;
  }

  return (
    <ul className="flex flex-col gap-2" aria-label="CLI status">
      {caps.map((c) =>
        c.authMode ? (
          <li key={c.cli}>
            <CliAuthBadge cli={c.cli} authMode={c.authMode} />
          </li>
        ) : (
          <li key={c.cli} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: c.available ? "#46b85f" : "#5a5a6a" }}
              aria-hidden
            />
            <span className={c.available ? "text-content" : "text-faint"}>
              {c.cli}: {c.available ? "available" : "not available"}
            </span>
          </li>
        ),
      )}
    </ul>
  );
}
