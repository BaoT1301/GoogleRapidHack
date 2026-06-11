"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, PlayIcon } from "@phosphor-icons/react";
import { ulid } from "ulid";
import { useTRPC } from "@/trpc/client";
import { useToast } from "@/components/ui/Toast";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import type { INodeSpec } from "@/db/models/graph.model";

interface FixerNodeContext {
  nodeId: string;
  label?: string;
  diffPreview?: string;
  lastError?: string;
}

/**
 * Spawn-fixer modal. Captures a fixer persona + prompt and calls
 * `trpc.graphs.spawnChild`. WOW-4: it now **spawns AND runs** the child
 * (`autoStart: true`, WOW-1), captures the returned `childRunId`, and opens the
 * live child-run side-panel via `onSpawnedRun`. The prompt is pre-filled from
 * the parent run's captured diffs/errors (`runs.fixerContext`, WOW-3); the
 * "Open child graph" link is kept.
 */
export function SpawnFixerModal({
  open,
  graphId,
  parentNodeId,
  selectedCount,
  selectedNodeIds,
  defaultPersona,
  onSpawnedRun,
  onClose,
}: {
  open: boolean;
  graphId: string;
  parentNodeId: string | null;
  selectedCount: number;
  selectedNodeIds?: string[];
  defaultPersona?: string;
  onSpawnedRun?: (childRunId: string, label: string) => void;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const { toast } = useToast();

  const [persona, setPersona] = useState(defaultPersona ?? "");
  const [prompt, setPrompt] = useState("");
  const [spawnedId, setSpawnedId] = useState<string | null>(null);
  const promptTouched = useRef(false);
  const personaTouched = useRef(false);

  const personasQuery = useQuery(
    trpc.templates.list.queryOptions({ kind: "persona" }),
  );
  const personas = (personasQuery.data ?? []) as { id: string; name: string }[];

  // MODEL-1: owner's fixer defaults (cli/model/persona) pre-fill this modal and
  // seed the spawned fixer node. Best-effort — absent config behaves as before.
  const settingsQuery = useQuery(trpc.settings.get.queryOptions(undefined, { enabled: open }));
  const fixerConfig =
    (settingsQuery.data as { fixerConfig?: { cli?: string; model?: string; persona?: string } } | undefined)
      ?.fixerConfig ?? {};

  // WOW-3 pre-fill: read the parent's latest run, then capture the selected
  // node(s)' diff/error as fixer grounding. Best-effort + guarded (no run yet
  // ⇒ no pre-fill, behaves as before).
  const captureNodeIds =
    selectedNodeIds && selectedNodeIds.length > 0
      ? selectedNodeIds
      : parentNodeId
        ? [parentNodeId]
        : [];

  const latestRun = useQuery({
    ...trpc.runs.listForGraph.queryOptions({ graphId, limit: 1 }),
    enabled: open && captureNodeIds.length > 0,
  });
  const latestRunId =
    latestRun.data && latestRun.data[0]
      ? String((latestRun.data[0] as { _id: unknown })._id)
      : undefined;

  const fixerCtx = useQuery({
    ...trpc.runs.fixerContext.queryOptions({
      runId: latestRunId as string,
      nodeIds: captureNodeIds,
    }),
    enabled: open && Boolean(latestRunId) && captureNodeIds.length > 0,
  });

  const capturedContext = buildContextSeed(
    captureNodeIds,
    (fixerCtx.data ?? []) as FixerNodeContext[],
  );

  // Pre-fill the prompt once context arrives, unless the user has typed.
  useEffect(() => {
    if (!open || promptTouched.current) return;
    const composed = composePrompt((fixerCtx.data ?? []) as FixerNodeContext[]);
    if (composed) setPrompt(composed);
  }, [open, fixerCtx.data]);

  // Pre-fill the persona from the owner's fixer defaults, unless the user picked one
  // or an explicit defaultPersona was provided.
  useEffect(() => {
    if (!open || personaTouched.current || defaultPersona) return;
    if (fixerConfig.persona) setPersona(fixerConfig.persona);
  }, [open, fixerConfig.persona, defaultPersona]);

  const spawn = useMutation(
    trpc.graphs.spawnChild.mutationOptions({
      onSuccess: (child: { _id: unknown; childRunId?: string }) => {
        setSpawnedId(String(child._id));
        if (child.childRunId) {
          onSpawnedRun?.(child.childRunId, labelFromPrompt());
          toast("Fixer spawned & running", "success");
        } else {
          toast("Fixer sub-graph created", "success");
        }
      },
      onError: (e: { message?: string }) =>
        toast(e.message || "Failed to spawn fixer", "error"),
    }),
  );

  function labelFromPrompt() {
    return prompt.trim().slice(0, 60) || "Fixer";
  }

  function reset() {
    setPrompt("");
    setPersona(defaultPersona ?? "");
    setSpawnedId(null);
    promptTouched.current = false;
    personaTouched.current = false;
  }

  function close() {
    reset();
    onClose();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!parentNodeId || !prompt.trim()) return;
    const seed: INodeSpec = {
      id: ulid(),
      kind: "execute",
      label: "Fixer",
      position: { x: 0, y: 0 },
      status: "pending",
      data: {
        persona: persona || undefined,
        prompt: prompt.trim(),
        ...(fixerConfig.cli ? { cli: fixerConfig.cli } : {}),
        ...(fixerConfig.model ? { model: fixerConfig.model } : {}),
      },
    };
    spawn.mutate({
      parentGraphId: graphId,
      parentNodeId,
      name: labelFromPrompt(),
      nodes: [seed],
      autoStart: true,
      ...(capturedContext ? { context: capturedContext } : {}),
    });
  }

  return (
    <Dialog open={open} onClose={close} title="Spawn fixer sub-graph">
      {spawnedId ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            A child sub-graph was created from this node and its fixer run is
            streaming live in the side panel.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
            <Link
              href={`/dashboard/${spawnedId}`}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-sm border border-transparent bg-accent px-4 text-sm font-medium tracking-tight text-on-accent transition-colors hover:bg-accent-strong"
            >
              Open child graph <ArrowRightIcon size={14} weight="bold" />
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-xs text-faint">
            {selectedCount > 1
              ? `${selectedCount} nodes selected — fixer attaches to the right-clicked node.`
              : "Creates a child sub-graph linked to the selected node and runs it."}
          </p>
          {(capturedContext?.lastError || capturedContext?.diffPreview) && (
            <p className="rounded-sm border border-border bg-surface px-3 py-2 text-[11px] text-faint">
              Pre-filled from the last run’s diff/errors. Edit as needed.
            </p>
          )}
          <Field label="Fixer persona">
            <Select value={persona} onChange={(e) => { personaTouched.current = true; setPersona(e.target.value); }}>
              <option value="">None</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prompt" htmlFor="fixer-prompt">
            <Textarea
              id="fixer-prompt"
              rows={4}
              value={prompt}
              onChange={(e) => {
                promptTouched.current = true;
                setPrompt(e.target.value);
              }}
              placeholder="Describe what the fixer agent should do…"
            />
          </Field>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={spawn.isPending}
              disabled={!parentNodeId || !prompt.trim()}
            >
              <PlayIcon size={13} weight="fill" /> Spawn &amp; run
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** Aggregate per-node fixer context into the additive `context` seed. */
function buildContextSeed(
  fromNodes: string[],
  ctx: FixerNodeContext[],
): { fromNodes: string[]; diffPreview?: string; lastError?: string } | undefined {
  if (fromNodes.length === 0) return undefined;
  const diffs = ctx.map((c) => c.diffPreview).filter(Boolean) as string[];
  const errors = ctx.map((c) => c.lastError).filter(Boolean) as string[];
  if (diffs.length === 0 && errors.length === 0) {
    return { fromNodes };
  }
  return {
    fromNodes,
    diffPreview: diffs.length ? diffs.join("\n\n").slice(0, 1000) : undefined,
    lastError: errors.length ? errors.join("; ") : undefined,
  };
}

/** Compose a grounded default prompt from captured node context. */
function composePrompt(ctx: FixerNodeContext[]): string {
  const withSignal = ctx.filter((c) => c.lastError || c.diffPreview);
  if (withSignal.length === 0) return "";
  const lines: string[] = ["Fix the following node(s):"];
  for (const c of withSignal) {
    const name = c.label ?? c.nodeId;
    if (c.lastError) lines.push(`- ${name}: last error — ${c.lastError}`);
    else lines.push(`- ${name}`);
  }
  return lines.join("\n");
}
