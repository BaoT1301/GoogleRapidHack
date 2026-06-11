"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  GearSixIcon,
  ArrowClockwiseIcon,
  CircleNotchIcon,
} from "@phosphor-icons/react";
import { useTRPC } from "@/trpc/client";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { SystemStatus } from "@/components/SystemStatus";
import { PlannerProviderToggle } from "@/components/settings/PlannerProviderToggle";
import { MergeStrategyToggle } from "@/components/settings/MergeStrategyToggle";
import { CliCapabilities } from "@/components/settings/CliCapabilities";
import { AllowedToolsEditor } from "@/components/settings/AllowedToolsEditor";
import { ExecutionDefaults } from "@/components/settings/ExecutionDefaults";
import { TemplateManager } from "@/components/settings/TemplateManager";
import { SkillRegistry } from "@/components/settings/SkillRegistry";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { AssetManager } from "@/components/settings/AssetManager";

type HealthStatus = "ok" | "unreachable" | "rate_limited" | "not_configured";

const STATUS_META: Record<HealthStatus, { label: string; color: string }> = {
  ok: { label: "Architect reachable — model responding", color: "#3fb950" },
  unreachable: { label: "Architect unreachable", color: "#f85149" },
  rate_limited: { label: "Architect rate-limited", color: "#d8a72b" },
  not_configured: { label: "Architect not configured", color: "#9e6a03" },
};

/**
 * Persistent Settings surface (reachable from the app chrome, not just first
 * run). Presented as a WIDE, TABBED dialog so the many sections no longer fight
 * over one narrow scroll column:
 *   - General        → Architect API, Planner provider, Merge strategy, Platform
 *   - CLIs & Tools    → CLI status, per-CLI Allowed tools
 *   - Personas & Rules → TemplateManager (view defaults, view/edit forks)
 *   - Skills          → installed-skill registry
 *
 * While the Architect health probe is in flight we render SKELETONS rather than
 * misleading placeholder values (e.g. "Not configured"/"Absent" before the
 * query resolves). The service-token VALUE is never rendered — only a present/
 * absent flag (Zero-Secret Leakage, AD-8).
 */
export function SettingsPanel({
  triggerVariant = "icon",
}: {
  /**
   * How the trigger renders. "icon" (default) is the hairline gear button used
   * in compact chrome; "nav" is a text "Settings" item styled to match the
   * top-bar nav links. A plain string keeps this serializable so a Server
   * Component (the AppShell) can render this Client Component directly.
   */
  triggerVariant?: "icon" | "nav";
} = {}) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);

  const health = useQuery(
    trpc.plan.health.queryOptions(undefined, {
      enabled: open, // probe only while the panel is open
      refetchOnWindowFocus: false,
    }),
  );

  const data = health.data as
    | {
        configured: boolean;
        tokenPresent: boolean;
        apiUrl: string | null;
        reachable: boolean;
        status: HealthStatus;
        model?: string;
        reason?: string;
      }
    | undefined;

  // Distinguish "still loading" from "loaded but empty" so we never flash a
  // false default. `isError` is a terminal, resolved state (not loading).
  const loaded = data !== undefined || health.isError;

  const generalTab = (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium tracking-wide text-muted">
            Architect API
          </h3>
          <Button
            size="sm"
            variant="ghost"
            loading={health.isFetching}
            onClick={() => health.refetch()}
          >
            <ArrowClockwiseIcon size={13} /> Refresh
          </Button>
        </div>

        <HealthBadge
          fetching={health.isFetching && !data}
          error={health.isError}
          status={data?.status}
          reason={data?.reason}
        />

        {!loaded ? (
          <ArchitectRowsSkeleton />
        ) : (
          <dl
            className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs"
            aria-busy={health.isFetching || undefined}
          >
            <Row label="LLM_API_URL" value={data?.apiUrl ?? "Not configured"} />
            <Row label="Model" value={data?.model ?? "—"} />
            <Row
              label="Service token"
              value={data?.tokenPresent ? "Present" : "Absent"}
            />
          </dl>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-medium tracking-wide text-muted">
          Planner provider
        </h3>
        <PlannerProviderToggle enabled={open} />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-medium tracking-wide text-muted">
          Merge strategy
        </h3>
        <MergeStrategyToggle enabled={open} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted">Platform</h3>
        <SystemStatus />
      </section>
    </div>
  );

  const toolsTab = (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-medium tracking-wide text-muted">
          CLI status
        </h3>
        <CliCapabilities enabled={open} />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-medium tracking-wide text-muted">
          Allowed tools
        </h3>
        <AllowedToolsEditor enabled={open} />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-medium tracking-wide text-muted">
          Execution defaults
        </h3>
        <ExecutionDefaults enabled={open} />
      </section>
    </div>
  );

  const personasTab = (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-medium tracking-wide text-muted">
        Personas &amp; rules
      </h3>
      <TemplateManager enabled={open} />
    </section>
  );

  const skillsTab = (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-medium tracking-wide text-muted">
        Installed skills
      </h3>
      <SkillRegistry enabled={open} />
    </section>
  );

  const appearanceTab = (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-medium tracking-wide text-muted">
          Canvas appearance
        </h3>
        <AppearanceSettings enabled={open} />
      </section>
      <AssetManager enabled={open} />
    </div>
  );

  const tabs: TabItem[] = [
    { id: "general", label: "General", content: generalTab },
    { id: "tools", label: "CLIs & Tools", content: toolsTab },
    { id: "personas", label: "Personas & Rules", content: personasTab },
    { id: "skills", label: "Skills", content: skillsTab },
    { id: "appearance", label: "Appearance", content: appearanceTab },
  ];

  return (
    <>
      {triggerVariant === "nav" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md px-2.5 py-1.5 text-sm font-medium text-faint transition-colors hover:bg-hover hover:text-content"
        >
          Settings
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Settings"
          className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-content"
        >
          <GearSixIcon size={16} />
        </button>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Settings"
        widthClassName="max-w-3xl"
      >
        <Tabs tabs={tabs} ariaLabel="Settings sections" defaultValue="general" />
      </Dialog>
    </>
  );
}

function ArchitectRowsSkeleton() {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs" aria-busy>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-3 w-56" />
      <Skeleton className="h-3 w-12" />
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

function HealthBadge({
  fetching,
  error,
  status,
  reason,
}: {
  fetching: boolean;
  error: boolean;
  status?: HealthStatus;
  reason?: string;
}) {
  if (fetching) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        <CircleNotchIcon size={13} className="animate-spin motion-reduce:hidden" />
        Checking the Architect API…
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-xs text-danger">
        Could not run the health check.
      </p>
    );
  }
  if (!status) return null;
  const meta = STATUS_META[status];
  return (
    <p className="flex items-center gap-2 text-xs" style={{ color: meta.color }}>
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: meta.color }}
      />
      {meta.label}
      {reason && status !== "ok" ? (
        <span className="text-faint">· {reason}</span>
      ) : null}
    </p>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd className="truncate font-mono text-content" title={value}>
        {value}
      </dd>
    </>
  );
}
