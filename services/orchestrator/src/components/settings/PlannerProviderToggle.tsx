"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { saveLastUsedAgent } from "@/lib/last-used-agent";

type Provider = "cloud" | "local";

interface CloudHealth {
  status: "ok" | "unreachable" | "rate_limited" | "not_configured";
  reachable: boolean;
  reason?: string;
}
interface LocalHealth {
  status: "ready" | "not_signed_in" | "not_installed";
  available: boolean;
  note?: string;
  suggestedFix?: string;
}

const CLOUD_LABEL: Record<CloudHealth["status"], { text: string; tone: Tone }> = {
  ok: { text: "Reachable", tone: "ok" },
  unreachable: { text: "Unreachable", tone: "error" },
  rate_limited: { text: "Rate-limited", tone: "warn" },
  not_configured: { text: "Not configured", tone: "warn" },
};
const LOCAL_LABEL: Record<LocalHealth["status"], { text: string; tone: Tone }> = {
  ready: { text: "kiro signed in", tone: "ok" },
  not_signed_in: { text: "kiro not signed in", tone: "error" },
  not_installed: { text: "kiro not installed", tone: "error" },
};

type Tone = "ok" | "warn" | "error";
const TONE: Record<Tone, string> = { ok: "#46b85f", warn: "#d8a72b", error: "#ef6b5c" };

/**
 * Planner provider toggle (Cloud ↔ Local). Cloud is the default; the choice is
 * persisted via `settings.update`. Shows which provider is **active** and each
 * provider's readiness (Cloud reachability + Local `kiro` status) with a one-line
 * fix hint when not ready. Consumes Track-1/3/4 contracts; never shows a key value.
 */
export function PlannerProviderToggle({ enabled = true }: { enabled?: boolean }) {
  const trpc = useTRPC();
  const settings = useQuery(trpc.settings.get.queryOptions(undefined, { enabled }));
  const status = useQuery(
    trpc.plan.providerStatus.queryOptions(undefined, { enabled, refetchOnWindowFocus: false }),
  );
  const update = useMutation(
    trpc.settings.update.mutationOptions({
      onSuccess: () => settings.refetch(),
    }),
  );

  const active = ((settings.data as { plannerProvider?: Provider } | undefined)?.plannerProvider ??
    "cloud") as Provider;
  const data = status.data as { cloud?: CloudHealth; local?: LocalHealth } | undefined;
  const cloud = data?.cloud;
  const local = data?.local;

  const select = (provider: Provider) => {
    if (provider !== active) {
      update.mutate({ plannerProvider: provider });
      if (provider === "local") {
        saveLastUsedAgent("kiro");
      } else if (provider === "cloud") {
        saveLastUsedAgent("gemini");
      }
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Planner provider" className="grid grid-cols-2 gap-2">
        <ProviderCard
          label="Cloud (Gemini)"
          sub="Hosted Architect"
          active={active === "cloud"}
          onSelect={() => select("cloud")}
          readiness={cloud ? CLOUD_LABEL[cloud.status] : undefined}
        />
        <ProviderCard
          label="Local (kiro-cli)"
          sub="Runs on this machine"
          badge="experimental"
          note="Cloud is the reliable default"
          active={active === "local"}
          disabled={!local?.available}
          onSelect={() => select("local")}
          readiness={local ? LOCAL_LABEL[local.status] : undefined}
        />
      </div>

      <p className="text-xs text-faint">
        Active planner: <span className="text-content">{active === "cloud" ? "Cloud (Gemini)" : "Local (kiro-cli)"}</span>
      </p>

      {local && local.status !== "ready" && local.suggestedFix ? (
        <p className="text-xs" style={{ color: TONE.warn }}>
          To use Local: {local.suggestedFix}
        </p>
      ) : null}
      {cloud && cloud.status !== "ok" && cloud.reason ? (
        <p className="text-xs" style={{ color: TONE.warn }}>
          Cloud: {cloud.reason}
        </p>
      ) : null}
    </div>
  );
}

function ProviderCard({
  label,
  sub,
  active,
  onSelect,
  readiness,
  badge,
  note,
  disabled,
}: {
  label: string;
  sub: string;
  active: boolean;
  onSelect: () => void;
  readiness?: { text: string; tone: Tone };
  /** Optional pill rendered next to the label (e.g. "experimental"). */
  badge?: string;
  /** Optional one-line caption under the sub-label (e.g. reliability nudge). */
  note?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onSelect}
      className={[
        "flex flex-col items-start gap-1 rounded-sm border p-3 text-left transition-colors",
        disabled
          ? "opacity-50 cursor-not-allowed border-border bg-surface"
          : active
            ? "border-accent/60 bg-accent/10"
            : "border-border bg-surface hover:border-border-strong",
      ].join(" ")}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-content">
        {label}
        {badge ? (
          <span className="rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-warning">
            {badge}
          </span>
        ) : null}
        {active ? <span className="text-[10px] text-accent">· active</span> : null}
      </span>
      <span className="text-[11px] text-faint">{sub}</span>
      {note ? <span className="text-[11px] text-faint">{note}</span> : null}
      {readiness ? (
        <span className="mt-1 flex items-center gap-1.5 text-[11px]" style={{ color: TONE[readiness.tone] }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TONE[readiness.tone] }} aria-hidden />
          {readiness.text}
        </span>
      ) : null}
    </button>
  );
}
