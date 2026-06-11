"use client";

import { useEffect, useRef, useState } from "react";
import { WarningIcon } from "@phosphor-icons/react";
import { statusColor } from "@/lib/status";
import { cn } from "@/lib/cn";
import { XtermView, type XtermHandle } from "@/components/run/XtermView";
import { InteractiveTerminal } from "@/components/run/InteractiveTerminal";
import type { NodeTerminal } from "@/lib/run-events";

type Tab = "terminal" | "shell" | "patch" | "output" | "plan" | "gate" | "loop";

// stderr is rendered red so it stays distinguishable now that raw bytes (not
// styled <div>s) drive the view. Reset after each line.
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

export interface PlanRunOutput {
  kind?: string;
  status?: string;
  provider?: string;
  model?: string;
  objective?: string;
  prompt?: string;
  contextRequest?: {
    confidence?: number;
    questions?: Array<string | { question?: string; text?: string }>;
    missingContext?: string[];
  };
  graphProposal?: {
    featureName?: string;
    missingContext?: string[];
    proposedNodes?: Array<{ id: string; kind?: string; label?: string }>;
    proposedEdges?: Array<{ id: string; source?: string; target?: string; kind?: string }>;
  };
  warnings?: string[];
  applied?: boolean;
}

export interface GateRunOutput {
  kind?: string;
  status?: "passed" | "blocked" | string;
  fanInMode?: "all-of" | "any-of" | string;
  upstreamTotal?: number;
  upstreamSucceeded?: number;
  upstreamFailed?: number;
  upstreamSkipped?: number;
  upstreamBlocked?: number;
  reason?: string;
  evaluatedAt?: string;
}

export interface LoopRunOutput {
  kind?: string;
  status?: "completed" | "failed" | "exhausted" | "cancelled" | string;
  childGraphId?: string;
  iterations?: number;
  maxIterations?: number;
  breakCondition?: string;
  breakConditionEvaluated?: boolean;
  breakReason?: string;
  childRunIds?: string[];
  finishedAt?: string;
}

export function RunTerminal({
  terminal,
  label,
  planOutput,
  gateOutput,
  loopOutput,
  onApplyPlanProposal,
  applyingPlanProposal,
  runId,
}: {
  terminal: NodeTerminal;
  label?: string;
  planOutput?: PlanRunOutput;
  gateOutput?: GateRunOutput;
  loopOutput?: LoopRunOutput;
  onApplyPlanProposal?: (nodeId: string) => Promise<void> | void;
  applyingPlanProposal?: boolean;
  /** Enables the interactive worktree shell (requires a live run + worktree). */
  runId?: string;
}) {
  const [tab, setTab] = useState<Tab>("terminal");
  const color = statusColor(terminal.status);
  const hasPlan = Boolean(planOutput) || Boolean(terminal.plan);
  const hasGate = Boolean(gateOutput) || Boolean(terminal.gate);
  const hasLoop = Boolean(loopOutput) || Boolean(terminal.loop);

  const termRef = useRef<XtermHandle>(null);
  // Monotonic count of lines ever received = retained + evicted. Lets us write
  // only the newly-arrived tail into xterm, robust against ring-buffer eviction
  // (VIS-1) which shifts the retained window without changing its length.
  const writtenRef = useRef(0);
  const worktreePath = terminal.worktree?.path;
  const shellAvailable = Boolean(runId && worktreePath);

  // Push newly-appended lines into the terminal emulator (xterm parses the ANSI
  // colour / cursor / erase sequences the old plain-text view mangled).
  useEffect(() => {
    const total = terminal.droppedLines + terminal.lines.length;
    if (total <= writtenRef.current) return;
    const toWrite = Math.min(total - writtenRef.current, terminal.lines.length);
    const start = terminal.lines.length - toWrite;
    for (let i = start; i < terminal.lines.length; i += 1) {
      const l = terminal.lines[i];
      const text = l.stream === "stderr" ? `${RED}${l.text}${RESET}` : l.text;
      termRef.current?.write(`${text}\r\n`);
    }
    writtenRef.current = total;
  }, [terminal.lines, terminal.droppedLines]);

  // Re-fit when the terminal tab becomes visible (a hidden container measures 0).
  useEffect(() => {
    if (tab === "terminal") termRef.current?.fit();
  }, [tab]);

  const hasOutput = terminal.lines.length > 0 || terminal.droppedLines > 0;

  return (
    <div className="flex h-full min-w-[280px] flex-col rounded-md border border-border bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className="truncate text-xs font-semibold text-content">
            {label ?? terminal.nodeId}
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-faint">
            {terminal.status}
          </span>
        </div>
        <div className="flex gap-1">
          {(["terminal", "shell", "patch", "output", ...(hasPlan ? ["plan" as const] : []), ...(hasGate ? ["gate" as const] : []), ...(hasLoop ? ["loop" as const] : [])] as Tab[]).map((t) => {
            const disabled = t === "shell" && !shellAvailable;
            return (
              <button
                key={t}
                onClick={() => !disabled && setTab(t)}
                disabled={disabled}
                title={
                  disabled
                    ? "Shell opens once this node has a worktree"
                    : undefined
                }
                className={cn(
                  "rounded-sm px-2 py-0.5 text-[10px] uppercase tracking-wide transition-colors",
                  tab === t ? "bg-active text-content" : "text-faint hover:text-muted",
                  disabled && "cursor-not-allowed opacity-40 hover:text-faint",
                )}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {/* Terminal tab — xterm is always mounted (preserves scrollback across
            tab switches) and just hidden when another tab is active. */}
        <div className={cn("absolute inset-0 flex flex-col", tab !== "terminal" && "hidden")}>
          {terminal.droppedLines > 0 && (
            <p className="border-b border-border px-3 py-1 text-[10px] uppercase tracking-wide text-warning">
              +{terminal.droppedLines} earlier line
              {terminal.droppedLines === 1 ? "" : "s"} dropped
            </p>
          )}
          {!hasOutput && (
            terminal.diagnostic ? (
              <TerminalDiagnostic diagnostic={terminal.diagnostic} />
            ) : (
              <p className="px-3 py-3 font-mono text-[11px] text-faint">No output yet.</p>
            )
          )}
          <XtermView ref={termRef} className={cn("min-h-0 flex-1 p-2", !hasOutput && "hidden")} />
        </div>

        {/* Shell tab — interactive PTY into the node's worktree (lazy: only
            connects once opened). */}
        {tab === "shell" && shellAvailable && (
          <div className="absolute inset-0">
            <InteractiveTerminal
              runId={runId as string}
              nodeId={terminal.nodeId}
              worktreePath={worktreePath}
            />
          </div>
        )}

        {tab === "patch" && (
          <div className="absolute inset-0 overflow-auto p-3 font-mono text-[11px] leading-relaxed">
            {terminal.patch ? (
              <>
                <p className="mb-1 text-faint">{terminal.patch.length ?? 0} bytes</p>
                <pre className="whitespace-pre-wrap text-muted">{terminal.patch.preview}</pre>
              </>
            ) : (
              <p className="text-faint">No patch.</p>
            )}
          </div>
        )}

        {tab === "output" && (
          <div className="absolute inset-0 overflow-auto p-3 font-mono text-[11px] leading-relaxed">
            {terminal.outputParseFailed && (
              <p className="mb-2 flex items-center gap-1.5 text-warning">
                <WarningIcon size={12} /> Structured output missing or malformed.
              </p>
            )}
            {terminal.output !== undefined ? (
              <pre className="whitespace-pre-wrap text-muted">
                {JSON.stringify(terminal.output, null, 2)}
              </pre>
            ) : (
              !terminal.outputParseFailed && <p className="text-faint">No output.</p>
            )}
          </div>
        )}

        {tab === "plan" && (
          <PlanOutputView
            terminal={terminal}
            planOutput={planOutput}
            applying={Boolean(applyingPlanProposal)}
            onApply={onApplyPlanProposal ? () => onApplyPlanProposal(terminal.nodeId) : undefined}
          />
        )}

        {tab === "gate" && (
          <GateOutputView terminal={terminal} gateOutput={gateOutput} />
        )}

        {tab === "loop" && (
          <LoopOutputView terminal={terminal} loopOutput={loopOutput} />
        )}
      </div>
    </div>
  );
}

function TerminalDiagnostic({
  diagnostic,
}: {
  diagnostic: NonNullable<NodeTerminal["diagnostic"]>;
}) {
  return (
    <div
      className={cn(
        "m-3 rounded-md border p-3 text-xs",
        diagnostic.tone === "error"
          ? "border-danger/35 bg-danger/5 text-danger"
          : diagnostic.tone === "warning"
            ? "border-warning/35 bg-warning/5 text-warning"
            : "border-border bg-panel text-muted",
      )}
    >
      <p className="font-semibold">{diagnostic.title}</p>
      <p className="mt-1 whitespace-pre-wrap leading-relaxed">{diagnostic.message}</p>
      {diagnostic.payload && Object.keys(diagnostic.payload).length > 0 && (
        <details className="mt-2 text-[10px] text-muted">
          <summary className="cursor-pointer uppercase tracking-wide">Details</summary>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(diagnostic.payload, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function GateOutputView({
  terminal,
  gateOutput,
}: {
  terminal: NodeTerminal;
  gateOutput?: GateRunOutput;
}) {
  const payload = gateOutput ?? terminal.gate?.payload ?? {};
  const status = String(gateOutput?.status ?? terminal.gate?.status ?? payload.status ?? "unknown");
  const fanInMode = String(gateOutput?.fanInMode ?? payload.fanInMode ?? "all-of");
  const upstreamTotal = num(gateOutput?.upstreamTotal ?? payload.upstreamTotal);
  const upstreamSucceeded = num(gateOutput?.upstreamSucceeded ?? payload.upstreamSucceeded);
  const upstreamFailed = num(gateOutput?.upstreamFailed ?? payload.upstreamFailed);
  const upstreamSkipped = num(gateOutput?.upstreamSkipped ?? payload.upstreamSkipped);
  const upstreamBlocked = num(gateOutput?.upstreamBlocked ?? payload.upstreamBlocked);
  const reason = String(gateOutput?.reason ?? payload.reason ?? "");
  const passed = status === "passed";

  return (
    <div className="space-y-3 text-muted">
      <section className={cn(
        "rounded-md border p-3",
        passed ? "border-accent/25 bg-accent/5" : "border-warning/30 bg-warning/5",
      )}>
        <p className="text-[10px] uppercase tracking-[0.14em] text-faint">Gate summary</p>
        <p className={cn("mt-1 text-sm font-semibold", passed ? "text-accent" : "text-warning")}>
          {passed
            ? `Gate passed: ${upstreamSucceeded}/${upstreamTotal} upstream succeeded, ${fanInMode}`
            : `Gate blocked: ${upstreamSucceeded}/${upstreamTotal} upstream succeeded, ${fanInMode} required`}
        </p>
        {reason && <p className="mt-2 text-xs text-muted">{reason}</p>}
      </section>
      <section className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-sm border border-border bg-panel/70 p-2">
          <p className="text-[10px] uppercase tracking-wide text-faint">Failed</p>
          <p className="text-content">{upstreamFailed}</p>
        </div>
        <div className="rounded-sm border border-border bg-panel/70 p-2">
          <p className="text-[10px] uppercase tracking-wide text-faint">Skipped</p>
          <p className="text-content">{upstreamSkipped}</p>
        </div>
        <div className="rounded-sm border border-border bg-panel/70 p-2">
          <p className="text-[10px] uppercase tracking-wide text-faint">Blocked</p>
          <p className="text-content">{upstreamBlocked}</p>
        </div>
        <div className="rounded-sm border border-border bg-panel/70 p-2">
          <p className="text-[10px] uppercase tracking-wide text-faint">Evaluated</p>
          <p className="truncate text-content">{String(gateOutput?.evaluatedAt ?? payload.evaluatedAt ?? "live")}</p>
        </div>
      </section>
    </div>
  );
}

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function LoopOutputView({
  terminal,
  loopOutput,
}: {
  terminal: NodeTerminal;
  loopOutput?: LoopRunOutput;
}) {
  const payload = (loopOutput ?? terminal.loop?.payload ?? {}) as Record<string, unknown>;
  const status = String(loopOutput?.status ?? terminal.loop?.status ?? payload.status ?? "running");
  const childGraphId = String(loopOutput?.childGraphId ?? payload.childGraphId ?? "unresolved");
  const iterations = num(loopOutput?.iterations ?? payload.iterations ?? payload.iteration);
  const maxIterations = num(loopOutput?.maxIterations ?? payload.maxIterations);
  const breakReason = String(loopOutput?.breakReason ?? payload.breakReason ?? "");
  const childRunIds = loopOutput?.childRunIds ?? arr(payload.childRunIds);
  const breakCondition = String(loopOutput?.breakCondition ?? payload.breakCondition ?? "");
  const evaluated = loopOutput?.breakConditionEvaluated ?? payload.breakConditionEvaluated;
  const failed = status === "failed" || status === "exhausted" || status === "cancelled";

  return (
    <div className="space-y-3 text-muted">
      <section className={cn(
        "rounded-md border p-3",
        failed ? "border-warning/30 bg-warning/5" : "border-accent/25 bg-accent/5",
      )}>
        <p className="text-[10px] uppercase tracking-[0.14em] text-faint">Loop summary</p>
        <p className={cn("mt-1 text-sm font-semibold", failed ? "text-warning" : "text-accent")}>
          Loop {status}: {iterations}/{maxIterations || "?"} iteration{iterations === 1 ? "" : "s"}
        </p>
        {breakReason && <p className="mt-2 text-xs text-muted">Break reason: {breakReason}</p>}
      </section>
      <section className="rounded-md border border-border bg-panel/70 p-3 text-xs">
        <p className="text-[10px] uppercase tracking-wide text-faint">Child graph</p>
        <p className="mt-1 break-all text-content">{childGraphId}</p>
        {childRunIds.length > 0 && (
          <>
            <p className="mt-3 text-[10px] uppercase tracking-wide text-faint">Child runs</p>
            <ul className="mt-1 space-y-1">
              {childRunIds.map((id) => (
                <li key={id} className="break-all text-muted">{id}</li>
              ))}
            </ul>
          </>
        )}
      </section>
      {breakCondition && (
        <section className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs">
          <p className="font-semibold text-warning">Break condition is a planning hint</p>
          <p className="mt-1 text-muted">{breakCondition}</p>
          <p className="mt-2 text-faint">
            Evaluated by runtime: {evaluated === false ? "no" : "not reported"}. MVP runtime stops on child success,
            child cancellation/failure, or max iteration cap.
          </p>
        </section>
      )}
    </div>
  );
}

function PlanOutputView({
  terminal,
  planOutput,
  applying,
  onApply,
}: {
  terminal: NodeTerminal;
  planOutput?: PlanRunOutput;
  applying: boolean;
  onApply?: () => Promise<void> | void;
}) {
  const status = planOutput?.status ?? terminal.plan?.status;
  const proposal = planOutput?.graphProposal;
  const context = planOutput?.contextRequest;
  const warnings = planOutput?.warnings ?? [];
  const questions = context?.questions ?? [];
  const missingContext = context?.missingContext ?? proposal?.missingContext ?? [];
  const applied = planOutput?.applied === true || terminal.plan?.status === "applied";
  const failed = status === "failed" || terminal.plan?.status === "failed";
  const contextRequired = status === "context_required" || terminal.plan?.status === "context_required";
  const proposalReady = status === "proposal_ready" || terminal.plan?.status === "proposal_ready";
  const reason = String(terminal.plan?.payload?.reason ?? "");

  if (!planOutput && terminal.plan) {
    return (
      <div className="space-y-3 text-muted">
        <p className="text-xs uppercase tracking-wide text-faint">Plan event</p>
        <p>Status: <span className="text-content">{terminal.plan.status}</span></p>
        <pre className="whitespace-pre-wrap text-[10px] text-muted">
          {JSON.stringify(terminal.plan.payload ?? {}, null, 2)}
        </pre>
      </div>
    );
  }

  if (!planOutput) return <p className="text-faint">No Plan output.</p>;

  return (
    <div className="space-y-3 text-muted">
      <div
        className={cn(
          "rounded-md border p-3",
          failed
            ? "border-danger/35 bg-danger/5"
            : applied
              ? "border-success/35 bg-success/5"
              : contextRequired
                ? "border-warning/30 bg-warning/5"
                : proposalReady
                  ? "border-accent/35 bg-accent/5"
                  : "border-border bg-panel/70",
        )}
      >
        <p className="text-[10px] uppercase tracking-[0.14em] text-faint">Plan status</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p
            className={cn(
              "text-sm font-semibold",
              failed
                ? "text-danger"
                : applied
                  ? "text-success"
                  : contextRequired
                    ? "text-warning"
                    : proposalReady
                      ? "text-accent"
                      : "text-content",
            )}
          >
            {status ?? "unknown"}
          </p>
          {proposalReady && !applied && (
            <span className="rounded-full border border-accent/35 bg-accent/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent">
              Unapplied proposal
            </span>
          )}
          {applied && (
            <span className="rounded-full border border-success/35 bg-success/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-success">
              Applied
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-faint">
          Provider: {planOutput.provider ?? "default"}
          {planOutput.model ? ` / ${planOutput.model}` : ""}
        </p>
        {failed && reason && (
          <p className="mt-2 text-xs text-danger">Reason: {reason}</p>
        )}
      </div>

      {context && (
        <section className="rounded-md border border-warning/30 bg-warning/5 p-3">
          <p className="text-xs font-semibold text-warning">
            Planner needs more context before producing a graph.
          </p>
          {typeof context.confidence === "number" && (
            <p className="mt-1 text-xs text-muted">Confidence: {Math.round(context.confidence * 100)}%</p>
          )}
          {questions.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
              {questions.map((q, i) => (
                <li key={i}>{typeof q === "string" ? q : q.question ?? q.text ?? JSON.stringify(q)}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {proposal && (
        <section className="rounded-md border border-accent/25 bg-accent/5 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-content">
                {proposal.featureName ?? "Graph proposal ready"}
              </p>
              <p className="mt-1 text-xs text-muted">
                {(proposal.proposedNodes ?? []).length} proposed nodes / {(proposal.proposedEdges ?? []).length} proposed edges
              </p>
            </div>
            {onApply && (
              <button
                onClick={onApply}
                disabled={applying || applied}
                className="rounded-sm border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {applied ? "Applied" : applying ? "Applying…" : "Apply proposal to canvas"}
              </button>
            )}
          </div>
          {(proposal.proposedNodes ?? []).length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-wide text-faint">Proposed nodes</p>
              <ul className="mt-1 space-y-1 text-xs">
                {(proposal.proposedNodes ?? []).slice(0, 8).map((node) => (
                  <li key={node.id} className="truncate">
                    {node.label ?? node.id} <span className="text-faint">({node.kind ?? "node"})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(proposal.proposedEdges ?? []).length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-wide text-faint">Proposed edges</p>
              <ul className="mt-1 space-y-1 text-xs">
                {(proposal.proposedEdges ?? []).slice(0, 8).map((edge) => (
                  <li key={edge.id} className="truncate">
                    {edge.source} → {edge.target} <span className="text-faint">({edge.kind ?? "flow"})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {missingContext.length > 0 && (
        <section>
          <p className="text-[10px] uppercase tracking-wide text-faint">Missing context</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
            {missingContext.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </section>
      )}

      {warnings.length > 0 && (
        <section className="rounded-md border border-warning/30 bg-warning/5 p-3">
          <p className="text-xs font-semibold text-warning">Warnings</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
            {warnings.map((warning, i) => <li key={i}>{warning}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
