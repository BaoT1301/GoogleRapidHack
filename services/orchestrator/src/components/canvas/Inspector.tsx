"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CursorIcon, EyeIcon, WarningIcon } from "@phosphor-icons/react";
import { useTRPC } from "@/trpc/client";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { KIND_META } from "@/lib/graph-constants";
import { SkillAttach } from "@/components/canvas/SkillAttach";
import { RepoPathPicker } from "@/components/canvas/RepoPathPicker";
import { BaseBranchPicker } from "@/components/canvas/BaseBranchPicker";
import {
  getLastUsedAgent,
  saveLastUsedAgent,
  getLastUsedModel,
  saveLastUsedModel,
} from "@/lib/last-used-agent";
import type { AppNode } from "@/components/canvas/serialize";

export interface NodePatch {
  label?: string;
  data?: Record<string, unknown>;
}

const CLI_OPTIONS = ["codex", "kiro", "gemini", "claude"] as const;

export function Inspector({
  node,
  personas,
  onUpdate,
  graphId,
}: {
  node: AppNode | null;
  personas: { id: string; name: string }[];
  onUpdate: (id: string, patch: NodePatch) => void;
  /** PLAN-7: when set, enables the read-only "Preview prompt" dry-run dialog. */
  graphId?: string;
}) {
  const trpc = useTRPC();
  // Resolve the graph's repo path so a node that INHERITS it (empty per-node
  // repoPath) can still list branches for the base-branch picker. Read-only,
  // enabled only when a graphId is available.
  const repoInfo = useQuery(
    trpc.graphs.repoInfo.queryOptions(
      { graphId: graphId ?? "" },
      { enabled: !!graphId, refetchOnWindowFocus: false },
    ),
  );
  const graphRepoPath = repoInfo.data?.rootRepoPath;

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-panel">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Inspector
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {!node ? (
          <EmptyInspector />
        ) : (
          <div className="flex flex-col gap-4">
            {node.data.kind === "execute" ? (
              <ExecuteInspector
                node={node}
                personas={personas}
                onUpdate={onUpdate}
                graphRepoPath={graphRepoPath}
              />
            ) : (
              <KindInspector node={node} personas={personas} onUpdate={onUpdate} />
            )}
            {graphId && <NodePromptPreview graphId={graphId} nodeId={node.id} />}
          </div>
        )}
      </div>
    </aside>
  );
}

function LabelField({
  node,
  onUpdate,
}: {
  node: AppNode;
  onUpdate: (id: string, patch: NodePatch) => void;
}) {
  return (
    <Field label="Label" htmlFor="insp-label">
      <Input
        id="insp-label"
        value={node.data.label}
        onChange={(e) => onUpdate(node.id, { label: e.target.value })}
      />
    </Field>
  );
}

function ExecuteInspector({
  node,
  personas,
  onUpdate,
  graphRepoPath,
}: {
  node: AppNode;
  personas: { id: string; name: string }[];
  onUpdate: (id: string, patch: NodePatch) => void;
  /** The graph's repo path — used as the branch-list source when the node inherits it. */
  graphRepoPath?: string;
}) {
  const d = node.data.data ?? {};
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  const patchData = (k: string, v: string) =>
    onUpdate(node.id, { data: { [k]: v } });

  const rawCliValue = str("cli");
  const cliValue = rawCliValue === "fake" ? "" : rawCliValue;
  const defaultedCli = "codex";
  const currentCli = cliValue || defaultedCli;

  useEffect(() => {
    if (!rawCliValue || rawCliValue === "fake") {
      onUpdate(node.id, { data: { cli: defaultedCli } });
    }
  }, [rawCliValue, defaultedCli, node.id, onUpdate]);

  return (
    <div className="flex flex-col gap-4">
      <KindHeader kind="execute" />
      <LabelField node={node} onUpdate={onUpdate} />

      <Field label="Persona / template">
        <Select value={str("persona")} onChange={(e) => patchData("persona", e.target.value)}>
          <option value="">None</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="CLI">
        <Select
          value={currentCli}
          onChange={(e) => {
            patchData("cli", e.target.value);
            saveLastUsedAgent(e.target.value);
          }}
        >
          {CLI_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        {rawCliValue === "fake" && (
          <p className="text-[11px] text-accent mt-1">
            Legacy fake setting detected; this node will be saved as Codex for real CLI runs.
          </p>
        )}
      </Field>

      <Field
        label="Model"
        htmlFor="insp-model"
        hint="Optional. Overrides the node-type default; blank uses the CLI's own default."
      >
        <Input
          id="insp-model"
          value={str("model")}
          onChange={(e) => patchData("model", e.target.value)}
          placeholder="e.g. claude-sonnet-4, gpt-4.1, gemini-2.5-pro"
        />
      </Field>

      <Field label="Prompt" htmlFor="insp-prompt">
        <Textarea
          id="insp-prompt"
          rows={5}
          value={str("prompt")}
          onChange={(e) => patchData("prompt", e.target.value)}
          placeholder="Describe what this agent should do…"
        />
      </Field>

      <Field label="Skills" hint="Attached skills materialize into the run worktree">
        <SkillAttach
          value={Array.isArray(d.skills) ? (d.skills as string[]) : []}
          onChange={(ids) => onUpdate(node.id, { data: { skills: ids } })}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3">
        <Field label="Repo path" hint="Defaults to the graph's repo">
          <RepoPathPicker
            value={str("repoPath")}
            onChange={(v) => patchData("repoPath", v)}
            autofillDefault={false}
            placeholder={graphRepoPath || "/abs/path/to/repo"}
          />
        </Field>
        <Field label="Base branch" hint="Pick an existing branch or type a new name to create">
          <BaseBranchPicker
            value={str("baseBranch")}
            onChange={(v) => patchData("baseBranch", v)}
            repoPath={str("repoPath") || graphRepoPath}
          />
        </Field>
      </div>
    </div>
  );
}

/** Shared helpers for reading/patching a node's free-form `data` map. */
function dataAccessors(
  node: AppNode,
  onUpdate: (id: string, patch: NodePatch) => void,
) {
  const d = node.data.data ?? {};
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  const bool = (k: string) => d[k] === true;
  const patch = (k: string, v: unknown) => onUpdate(node.id, { data: { [k]: v } });
  return { str, bool, patch };
}

/** Dispatch the 6 non-Execute kinds to their editable panels. */
function KindInspector({
  node,
  personas,
  onUpdate,
}: {
  node: AppNode;
  personas: { id: string; name: string }[];
  onUpdate: (id: string, patch: NodePatch) => void;
}) {
  const { str, bool, patch } = dataAccessors(node, onUpdate);

  const trpc = useTRPC();
  const capsQuery = useQuery(
    trpc.system.capabilities.queryOptions(undefined, { refetchOnWindowFocus: false }),
  );
  const caps = capsQuery.data ?? [];

  const lastAgent = getLastUsedAgent();
  const kiroAvailable = caps.find((c) => c.cli === "kiro")?.available;
  const geminiAvailable = caps.find((c) => c.cli === "gemini")?.available;

  const defaultProvider =
    lastAgent === "kiro" && kiroAvailable
      ? "local"
      : lastAgent === "gemini" && geminiAvailable
        ? "cloud"
        : "auto";

  const currentProvider = str("provider") || defaultProvider;
  const currentProviderForModel = currentProvider === "local" ? "kiro" : currentProvider === "cloud" ? "gemini" : "";
  const lastModel = currentProviderForModel ? getLastUsedModel(currentProviderForModel) : null;

  return (
    <div className="flex flex-col gap-4">
      <KindHeader kind={node.data.kind} />
      <LabelField node={node} onUpdate={onUpdate} />

      {node.data.kind === "plan" && (
        <>
          <p className="rounded-md border border-accent/20 bg-accent/5 px-3 py-2 text-xs leading-relaxed text-muted">
            Plan nodes generate proposals during a run. They do not auto-mutate
            the graph; apply is explicit after review. Plan output is a proposal.
            Applying it updates the graph for the next run, not the already-created
            run snapshot.
          </p>
          <Field label="Objective" htmlFor="insp-objective">
            <Input
              id="insp-objective"
              value={str("objective")}
              onChange={(e) => patch("objective", e.target.value)}
              placeholder="What this plan should achieve"
            />
          </Field>
          <Field label="Prompt" htmlFor="insp-plan-prompt">
            <Textarea
              id="insp-plan-prompt"
              rows={5}
              value={str("prompt")}
              onChange={(e) => patch("prompt", e.target.value)}
              placeholder="Planning instructions for the architect…"
            />
          </Field>
          <Field
            label="Provider"
            hint="Auto lets the backend choose the best configured planner. Manual choices remain Cloud or Local."
          >
            <Select
              value={currentProvider}
              onChange={(e) => {
                patch("provider", e.target.value);
                if (e.target.value === "local") {
                  saveLastUsedAgent("kiro");
                } else if (e.target.value === "cloud") {
                  saveLastUsedAgent("gemini");
                }
              }}
            >
              <option value="auto">Auto-select best model</option>
              <option value="cloud">Cloud planner</option>
              <option value="local">Local planner</option>
            </Select>
            {!str("provider") && defaultProvider !== "auto" && (
              <p className="text-[11px] text-accent mt-1">
                Defaulted to your last used agent: {defaultProvider === "local" ? "Kiro" : "Gemini"}
              </p>
            )}
          </Field>
          <label className="flex items-start gap-2 rounded-md border border-border bg-surface/60 p-3 text-xs text-muted">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={!str("model") || str("model") === "auto"}
              onChange={(e) => patch("model", e.target.checked ? "auto" : (lastModel || "gemini-2.5-pro"))}
            />
            <span>
              <span className="block font-medium text-content">
                Auto-select best model
              </span>
              Backend router chooses a configured model for planning and returns
              the chosen provider/model with a short reason.
            </span>
          </label>
          <Field
            label="Exact model name"
            hint="Manual override must be backend-allowlisted. It is only effective when the selected backend provider supports explicit model routing; otherwise provider defaults are used."
          >
            <Input
              value={str("model")}
              disabled={!str("model") || str("model") === "auto"}
              onChange={(e) => {
                patch("model", e.target.value);
                if (currentProviderForModel && e.target.value) {
                  saveLastUsedModel(currentProviderForModel, e.target.value);
                }
              }}
              placeholder="auto"
            />
          </Field>
          {str("model") && str("model") !== "auto" && (
            <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs leading-relaxed text-warning">
              Model routing is limited for Plan runtime. This model name is saved
              and backend-validated, but the planner may still use the provider default.
            </p>
          )}
          <label className="flex items-start gap-2 rounded-md border border-border bg-surface/60 p-3 text-xs text-muted">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={bool("allowDownstreamAfterProposal")}
              onChange={(e) => patch("allowDownstreamAfterProposal", e.target.checked)}
            />
            <span>
              <span className="block font-medium text-content">
                Advanced: allow downstream after proposal
              </span>
              Leave off for demo-safe behavior. When off, proposal-ready Plan
              nodes block downstream until a user explicitly applies/reviews the
              proposal.
            </span>
          </label>
        </>
      )}

      {node.data.kind === "review" && (
        <>
          <Field label="Reviewer persona">
            <Select
              value={str("persona")}
              onChange={(e) => patch("persona", e.target.value)}
            >
              <option value="">None</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pass criteria" htmlFor="insp-criteria">
            <Textarea
              id="insp-criteria"
              rows={4}
              value={str("passCriteria")}
              onChange={(e) => patch("passCriteria", e.target.value)}
              placeholder="What must be true for this review to pass…"
            />
          </Field>
        </>
      )}

      {node.data.kind === "doc" && (
        <>
          <Field label="Target path" htmlFor="insp-doc-path">
            <Input
              id="insp-doc-path"
              value={str("targetPath")}
              onChange={(e) => patch("targetPath", e.target.value)}
              placeholder="docs/architecture.md"
            />
          </Field>
          <Field label="Template" htmlFor="insp-doc-template">
            <Textarea
              id="insp-doc-template"
              rows={4}
              value={str("template")}
              onChange={(e) => patch("template", e.target.value)}
              placeholder="Doc template / outline…"
            />
          </Field>
        </>
      )}

      {node.data.kind === "gate" && (
        <>
          <Field label="Condition" htmlFor="insp-gate-condition">
            <Input
              id="insp-gate-condition"
              value={str("condition")}
              onChange={(e) => patch("condition", e.target.value)}
              placeholder="e.g. all upstream nodes succeeded"
            />
          </Field>
          <div className="rounded-md border border-border bg-panel/70 p-3 text-xs leading-relaxed text-muted">
            Gate fan-in mode is resolved from incoming flow edges. Default is all-of;
            any incoming edge marked any-of makes the gate any-of. Edge fan-in editing
            is graph/API-level until an edge inspector is added.
          </div>
        </>
      )}

      {node.data.kind === "context" && (
        <>
          <Field label="Source path" htmlFor="insp-ctx-path">
            <Input
              id="insp-ctx-path"
              value={str("sourcePath")}
              onChange={(e) => patch("sourcePath", e.target.value)}
              placeholder="/abs/path or repo-relative path"
            />
          </Field>
          <Field label="Key" hint="Variable name this context is bound to">
            <Input
              value={str("key")}
              onChange={(e) => patch("key", e.target.value)}
              placeholder="context_key"
            />
          </Field>
        </>
      )}

      {node.data.kind === "loop" && (
        <>
          <Field label="Max iterations" htmlFor="insp-loop-max">
            <Input
              id="insp-loop-max"
              type="number"
              min={1}
              value={str("maxIterations")}
              onChange={(e) => patch("maxIterations", e.target.value)}
              placeholder="3"
            />
          </Field>
          <Field
            label="Break condition / goal hint"
            htmlFor="insp-loop-break"
            hint="MVP runtime stops when the child run succeeds or max iterations is reached. Freeform break condition is a planning hint and is not semantically evaluated yet."
          >
            <Textarea
              id="insp-loop-break"
              rows={3}
              value={str("breakCondition")}
              onChange={(e) => patch("breakCondition", e.target.value)}
              placeholder="Stop looping when…"
            />
          </Field>
        </>
      )}
    </div>
  );
}

function KindHeader({ kind }: { kind: AppNode["data"]["kind"] }) {
  const meta = KIND_META[kind];
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: meta.color }}
      />
      <span className="text-sm font-semibold tracking-tight text-content">
        {meta.label} node
      </span>
    </div>
  );
}

function EmptyInspector() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <CursorIcon size={22} className="text-faint" />
      <p className="text-sm text-muted">Select a node to edit it.</p>
    </div>
  );
}

/**
 * PLAN-7 — read-only "Preview prompt" dry-run. Opens a labelled dialog showing
 * the FULLY-ASSEMBLED prompt (base + resolved data bindings + attached context)
 * plus the resolved CLI / agent / trust-tools and any unresolved `{{upstream…}}`
 * bindings. The query (`graphs.previewNodePrompt`) is strictly read-only — it
 * spawns nothing. Fetched lazily (only while the dialog is open).
 */
function NodePromptPreview({ graphId, nodeId }: { graphId: string; nodeId: string }) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const q = useQuery(
    trpc.graphs.previewNodePrompt.queryOptions(
      { graphId, nodeId },
      { enabled: open, refetchOnWindowFocus: false },
    ),
  );

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="self-start"
      >
        <EyeIcon size={14} /> Preview prompt
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Prompt preview (dry-run)">
        {q.isLoading ? (
          <p className="text-xs text-muted">Assembling the prompt…</p>
        ) : q.isError ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
          >
            <WarningIcon size={14} className="mt-0.5 shrink-0" />
            Couldn’t assemble the prompt preview.
          </p>
        ) : q.data ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-faint">CLI</dt>
              <dd className="font-mono text-content">{q.data.cli}</dd>
              {q.data.agent && (
                <>
                  <dt className="text-faint">Agent</dt>
                  <dd className="font-mono text-content">{q.data.agent}</dd>
                </>
              )}
              <dt className="text-faint">Trust tools</dt>
              <dd className="font-mono text-content">{q.data.trustTools || "(none)"}</dd>
            </dl>

            {q.data.attachedContextPresent && (
              <p className="text-[11px] text-muted">
                Includes an attached context block (untrusted data).
              </p>
            )}

            {q.data.unresolvedBindings.length > 0 && (
              <p
                role="note"
                data-testid="unresolved-bindings"
                className="flex flex-wrap items-start gap-x-1.5 gap-y-1 rounded-sm border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning"
              >
                <WarningIcon size={14} className="mt-0.5 shrink-0" />
                <span>Unresolved data bindings (no upstream run yet):</span>
                <span className="font-mono">{q.data.unresolvedBindings.join(", ")}</span>
              </p>
            )}

            <Field label="Assembled prompt" htmlFor="preview-prompt">
              <Textarea
                id="preview-prompt"
                readOnly
                rows={12}
                value={q.data.prompt}
                className="font-mono text-[11px]"
              />
            </Field>

            <p className="text-[11px] text-faint">
              Read-only preview — nothing is run, written, or checked out.
            </p>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
