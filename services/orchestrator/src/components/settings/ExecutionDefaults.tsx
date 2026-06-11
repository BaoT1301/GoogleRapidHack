"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Field, Input, Select } from "@/components/ui/Field";

type McpStartupPolicy = "best-effort" | "require";
type FixerCli = (typeof CLI_OPTIONS)[number];

const CLI_OPTIONS = ["codex", "kiro", "gemini", "claude"] as const;

// Node kinds that actually spawn an agent (the ones a default model applies to).
const MODELLED_NODE_KINDS = ["execute", "review", "doc"] as const;

interface FixerConfigShape {
  cli?: FixerCli;
  model?: string;
  persona?: string;
}

interface SettingsShape {
  defaultModelByNodeType?: Record<string, string>;
  fixerConfig?: FixerConfigShape;
  mcpStartupPolicy?: McpStartupPolicy;
}

/**
 * MODEL-1 / MCP-RESILIENCE — execution defaults editor:
 *   - MCP startup policy (best-effort skips unreachable servers; require hard-fails),
 *   - per-node-type default model (used when a node omits `data.model`),
 *   - fixer defaults (cli/model/persona) applied to spawned fixer nodes.
 * Persisted via `settings.update`; read by the run path + spawn-child.
 */
export function ExecutionDefaults({ enabled = true }: { enabled?: boolean }) {
  const trpc = useTRPC();
  const settings = useQuery(trpc.settings.get.queryOptions(undefined, { enabled }));
  const update = useMutation(
    trpc.settings.update.mutationOptions({ onSuccess: () => settings.refetch() }),
  );

  const data = settings.data as SettingsShape | undefined;
  const policy: McpStartupPolicy = data?.mcpStartupPolicy ?? "best-effort";

  // Text fields use local state (synced from settings) so typing isn't fought by
  // the server-bound value; changes persist on blur. Radio/select persist on change.
  const [modelByType, setModelByType] = useState<Record<string, string>>({});
  const [fixer, setFixer] = useState<FixerConfigShape>({});

  useEffect(() => {
    if (data) {
      setModelByType(data.defaultModelByNodeType ?? {});
      setFixer(data.fixerConfig ?? {});
    }
  }, [data]);

  const setPolicy = (next: McpStartupPolicy) => {
    if (next !== policy) update.mutate({ mcpStartupPolicy: next });
  };

  const commitModelForKind = (kind: string, model: string) => {
    const next = { ...modelByType };
    if (model.trim()) next[kind] = model.trim();
    else delete next[kind];
    setModelByType(next);
    update.mutate({ defaultModelByNodeType: next });
  };

  const commitFixer = (next: FixerConfigShape) => {
    setFixer(next);
    update.mutate({ fixerConfig: next });
  };

  return (
    <div className="flex flex-col gap-6" aria-busy={settings.isFetching || undefined}>
      {/* MCP startup policy */}
      <div className="flex flex-col gap-2">
        <div role="radiogroup" aria-label="MCP startup policy" className="grid grid-cols-2 gap-2">
          <PolicyCard
            label="Best-effort"
            sub="Skip MCP servers that can't start; the node still runs"
            active={policy === "best-effort"}
            onSelect={() => setPolicy("best-effort")}
          />
          <PolicyCard
            label="Require"
            sub="Fail the node if any configured MCP server can't start"
            active={policy === "require"}
            onSelect={() => setPolicy("require")}
          />
        </div>
      </div>

      {/* Default model by node type */}
      <div className="flex flex-col gap-2">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-faint">
          Default model by node type
        </h4>
        <div className="grid grid-cols-1 gap-2">
          {MODELLED_NODE_KINDS.map((kind) => (
            <Field key={kind} label={kind} htmlFor={`model-${kind}`}>
              <Input
                id={`model-${kind}`}
                value={modelByType[kind] ?? ""}
                onChange={(e) =>
                  setModelByType((prev) => ({ ...prev, [kind]: e.target.value }))
                }
                onBlur={(e) => commitModelForKind(kind, e.target.value)}
                placeholder="CLI default"
              />
            </Field>
          ))}
        </div>
      </div>

      {/* Fixer defaults */}
      <div className="flex flex-col gap-2">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-faint">
          Fixer defaults
        </h4>
        <Field label="CLI" htmlFor="fixer-cli">
          <Select
            id="fixer-cli"
            value={fixer.cli ?? ""}
            onChange={(e) => commitFixer({ ...fixer, cli: (e.target.value || undefined) as FixerCli | undefined })}
          >
            <option value="">Inherit / default</option>
            {CLI_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Model" htmlFor="fixer-model">
          <Input
            id="fixer-model"
            value={fixer.model ?? ""}
            onChange={(e) => setFixer((prev) => ({ ...prev, model: e.target.value }))}
            onBlur={(e) => commitFixer({ ...fixer, model: e.target.value.trim() || undefined })}
            placeholder="CLI default"
          />
        </Field>
        <Field label="Persona" htmlFor="fixer-persona" hint="Persona/template id">
          <Input
            id="fixer-persona"
            value={fixer.persona ?? ""}
            onChange={(e) => setFixer((prev) => ({ ...prev, persona: e.target.value }))}
            onBlur={(e) => commitFixer({ ...fixer, persona: e.target.value.trim() || undefined })}
            placeholder="e.g. backend_engineer"
          />
        </Field>
      </div>
    </div>
  );
}

function PolicyCard({
  label,
  sub,
  active,
  onSelect,
}: {
  label: string;
  sub: string;
  active: boolean;
  onSelect: () => void;
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
        {active ? <span className="text-[10px] text-accent">· active</span> : null}
      </span>
      <span className="text-[11px] text-faint">{sub}</span>
    </button>
  );
}
