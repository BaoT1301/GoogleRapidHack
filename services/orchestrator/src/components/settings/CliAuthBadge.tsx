"use client";

import { describeCliAuth, type CliAuthMode } from "@/lib/cli-auth";

const TONE_COLOR: Record<"ok" | "warn" | "error", string> = {
  ok: "#46b85f",
  warn: "#d8a72b",
  error: "#ef6b5c",
};

/**
 * Auth-state badge for a CLI. Renders "signed in (host login) / using API key
 * (fallback) / not signed in — <how to fix>". Never renders the key value.
 * Pure/presentational: the resolved `authMode` is supplied by the caller.
 */
export function CliAuthBadge({
  cli,
  authMode,
}: {
  cli: string;
  authMode: CliAuthMode | undefined;
}) {
  const info = describeCliAuth(cli, authMode);
  const color = TONE_COLOR[info.tone];

  return (
    <div className="flex items-start gap-2 text-xs" role="status">
      <span
        className="mt-1 h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <div className="flex flex-col">
        <span style={{ color }}>{info.label}</span>
        {info.hint ? <span className="text-faint">{info.hint}</span> : null}
      </div>
    </div>
  );
}
