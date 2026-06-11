"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { WarningIcon, CircleNotchIcon } from "@phosphor-icons/react";
import { useTRPC } from "@/trpc/client";
import { useToast } from "@/components/ui/Toast";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { planToGraphSpec } from "@/lib/plan-map";
import type { INodeSpec, IEdgeSpec } from "@/db/models/graph.model";

// Client mirror of the Architect contract response (top-level discriminated union).
// See `.claude/docs/core/api-contracts/architect-plan-api.md`.
interface Approach {
  name: string;
  pros: string[];
  cons: string[];
}
interface Question {
  id: string;
  text: string;
  category?: string;
}
interface ContextRequest {
  type: "context_request";
  codebaseImpact: string;
  approaches: Approach[];
  questions: Question[];
}
interface Sprint {
  number: number;
  name: string;
  tasks: string[];
}
/** Subset of the Architect `graph_spec` body we read here (see contract §3b). */
interface GraphSpecResult {
  type: "graph_spec";
  featureName?: string;
  sprintNumber?: number;
  backlog?: { sprints?: Sprint[] };
}
/** Held while the user reviews a multi-sprint roadmap before applying this sprint. */
interface Roadmap {
  featureName: string;
  currentSprint: number;
  sprints: Sprint[];
  spec: { nodes: INodeSpec[]; edges: IEdgeSpec[] };
}
interface Message {
  role: "user" | "assistant";
  content: string;
}

export function PlanPanel({
  open,
  onClose,
  onApply,
  rootRepoPath,
  baseBranch,
  onPlanGraphsCreated,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (spec: { nodes: INodeSpec[]; edges: IEdgeSpec[] }) => void;
  /** PLAN-4: repo context the expanded sprint graphs inherit (absent-safe). */
  rootRepoPath?: string;
  baseBranch?: string;
  /** PLAN-4: notified after "Create all N sprint graphs" succeeds. */
  onPlanGraphsCreated?: (result: {
    planId: string;
    graphs: { graphId: string; sprintNumber: number }[];
  }) => void;
}) {
  const trpc = useTRPC();
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [context, setContext] = useState<ContextRequest | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Monotonic run id — a cancelled/superseded request never applies its result.
  const runId = useRef(0);

  const generate = useMutation(trpc.plan.generate.mutationOptions());
  // PLAN-4: expand a multi-sprint roadmap into one linked graph per sprint.
  const createPlanGraphs = useMutation(trpc.graphs.createPlanGraphs.mutationOptions());

  // The persisted Settings planner toggle drives which provider services this
  // plan (Cloud default / Local kiro-cli). Read-only here; flipping it lives in
  // SettingsPanel. Resolved server-side too, so an absent value is safe.
  const settingsQ = useQuery(
    trpc.settings.get.queryOptions(undefined, { enabled: open, refetchOnWindowFocus: false }),
  );
  const provider = (settingsQ.data as { plannerProvider?: "cloud" | "local" } | undefined)
    ?.plannerProvider;

  function reset() {
    setPrompt("");
    setContext(null);
    setAnswers({});
    setRoadmap(null);
    setError(null);
    runId.current++;
    generate.reset();
  }

  function close() {
    reset();
    onClose();
  }

  function handleResult(res: unknown, id: number) {
    if (id !== runId.current) return; // cancelled / superseded
    const body = (res ?? {}) as { type?: string };
    if (body.type === "context_request") {
      setContext(res as ContextRequest);
      return;
    }
    if (body.type === "graph_spec") {
      const spec = planToGraphSpec(res);
      if (spec.nodes.length === 0) {
        setError(
          "The planner returned a plan with no tracks. Try a more specific prompt.",
        );
        return;
      }
      // PLAN-3: when the Architect returns a multi-sprint backlog, surface the
      // whole phased roadmap for review before applying THIS sprint's tracks.
      // Absent-safe: with no backlog we keep the original immediate-apply flow.
      const g = res as GraphSpecResult;
      const sprints = Array.isArray(g.backlog?.sprints)
        ? g.backlog!.sprints!.filter(
            (s): s is Sprint => Boolean(s) && typeof s.number === "number",
          )
        : [];
      if (sprints.length > 0) {
        setRoadmap({
          featureName: typeof g.featureName === "string" ? g.featureName : "Plan",
          currentSprint: typeof g.sprintNumber === "number" ? g.sprintNumber : 1,
          sprints,
          spec,
        });
        return;
      }
      onApply(spec);
      toast(`Applied ${spec.nodes.length} nodes`, "success");
      close();
      return;
    }
    setError("Unexpected response from the planner.");
  }

  function fail(id: number, err: unknown) {
    if (id !== runId.current) return;
    const message = err instanceof Error ? err.message.trim() : "";

    // Local planner failure → show the REAL reason from the backend (which names
    // the local planner), never the Cloud "Architect API" text. The Local planner
    // is experimental; the message nudges back to the reliable Cloud default.
    if (provider === "local") {
      setError(
        message && /local planner/i.test(message)
          ? message
          : "Local planner (kiro-cli) returned no usable plan — try Cloud, or refine the prompt.",
      );
      return;
    }

    // Cloud (default) failure → keep the LLM_API_URL / token hint, surfacing the
    // upstream message when present.
    setError(
      message
        ? `${message} — couldn’t reach the Architect API (check LLM_API_URL / LLM_SERVICE_TOKEN). You can keep building on the canvas manually.`
        : "Couldn’t reach the Architect API (check LLM_API_URL / LLM_SERVICE_TOKEN). You can keep building on the canvas manually.",
    );
  }

  // Step 1 — Socratic: surface approaches + clarifying questions.
  function ask(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!prompt.trim()) return;
    const id = ++runId.current;
    generate.mutate(
      // Pass the graph's repo so the Architect reasons about THIS repo (live scan),
      // not the orchestrator's cwd fallback.
      { prompt: prompt.trim(), messages: [], approved: false, provider, rootRepoPath },
      { onSuccess: (r) => handleResult(r, id), onError: (e) => fail(id, e) },
    );
  }

  // Step 2 — approved: send accumulated answers, receive the graph_spec.
  function plan(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!context) return;
    const answersText = context.questions
      .map((q) => `Q: ${q.text}\nA: ${answers[q.id]?.trim() || "(no answer)"}`)
      .join("\n\n");
    // When the Architect was confident and asked NO questions, answersText is empty —
    // fall back to the original prompt so the approved request is never blank.
    const approvedPrompt = answersText.trim() || prompt.trim();
    const messages: Message[] = [
      { role: "user", content: prompt.trim() },
      {
        role: "assistant",
        content: `${context.codebaseImpact}\n\nClarifying questions:\n${context.questions
          .map((q) => `- ${q.text}`)
          .join("\n")}`,
      },
    ];
    const id = ++runId.current;
    generate.mutate(
      { prompt: approvedPrompt, messages, approved: true, provider, rootRepoPath },
      { onSuccess: (r) => handleResult(r, id), onError: (e) => fail(id, e) },
    );
  }

  function cancel() {
    runId.current++; // invalidate the in-flight request's callbacks
    generate.reset();
  }

  // Apply the current sprint's tracks after the user has reviewed the roadmap.
  function applyRoadmap() {
    if (!roadmap) return;
    onApply(roadmap.spec);
    toast(`Applied ${roadmap.spec.nodes.length} nodes`, "success");
    close();
  }

  // PLAN-4: expand the WHOLE roadmap into one linked graph per sprint (the
  // "second brain"). The current sprint carries the full mapped topology; later
  // sprints are seeded from their task lists server-side. Only offered for
  // multi-sprint plans — single-sprint plans keep the immediate-apply flow.
  function createAllSprints() {
    if (!roadmap) return;
    setError(null);
    createPlanGraphs.mutate(
      {
        featureName: roadmap.featureName,
        currentSprint: roadmap.currentSprint,
        currentSpec: roadmap.spec,
        sprints: roadmap.sprints,
        rootRepoPath,
        baseBranch,
      },
      {
        onSuccess: (res) => {
          const result = res as {
            planId: string;
            graphs: { graphId: string; sprintNumber: number }[];
          };
          toast(`Created ${result.graphs.length} linked sprint graphs`, "success");
          onPlanGraphsCreated?.(result);
          close();
        },
        onError: (e) => {
          const message = e instanceof Error ? e.message.trim() : "";
          setError(
            message || "Couldn’t create the sprint graphs. Please try again.",
          );
        },
      },
    );
  }

  const pending = generate.isPending;

  return (
    <Dialog open={open} onClose={close} title="Generate graph from a prompt">
      {pending ? (
        <Loading onCancel={cancel} />
      ) : roadmap ? (
        <div className="flex flex-col gap-4">
          <p className="text-xs leading-relaxed text-muted">
            The Architect mapped <span className="text-content">{roadmap.featureName}</span>{" "}
            across {roadmap.sprints.length}{" "}
            {roadmap.sprints.length === 1 ? "sprint" : "sprints"}. Sprint{" "}
            {roadmap.currentSprint} is detailed below and will be applied to the canvas.
          </p>

          <PlanBacklog sprints={roadmap.sprints} currentSprint={roadmap.currentSprint} />

          {error && <InlineError message={error} />}

          <div className="mt-1 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            {roadmap.sprints.length >= 2 && (
              <Button
                type="button"
                variant="ghost"
                onClick={createAllSprints}
                loading={createPlanGraphs.isPending}
                disabled={createPlanGraphs.isPending}
              >
                Create all {roadmap.sprints.length} sprint graphs
              </Button>
            )}
            <Button
              type="button"
              onClick={applyRoadmap}
              disabled={createPlanGraphs.isPending}
            >
              Apply sprint {roadmap.currentSprint}
            </Button>
          </div>
        </div>
      ) : context ? (
        <form onSubmit={plan} className="flex flex-col gap-4">
          <p className="text-xs leading-relaxed text-muted">
            {context.codebaseImpact}
          </p>

          {context.approaches.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium tracking-wide text-muted">
                Approaches
              </span>
              {context.approaches.map((a) => (
                <div
                  key={a.name}
                  className="rounded-sm border border-border bg-surface px-3 py-2 text-xs"
                >
                  <div className="font-medium text-content">{a.name}</div>
                  <div className="mt-1 text-faint">
                    Pros: {a.pros.join(", ")} · Cons: {a.cons.join(", ")}
                  </div>
                </div>
              ))}
            </div>
          )}

          {context.questions.map((q) => (
            <Field key={q.id} label={q.text} htmlFor={`q-${q.id}`}>
              <Textarea
                id={`q-${q.id}`}
                rows={2}
                value={answers[q.id] ?? ""}
                onChange={(e) =>
                  setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                }
              />
            </Field>
          ))}

          {error && <InlineError message={error} />}

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit">Generate plan</Button>
          </div>
        </form>
      ) : (
        <form onSubmit={ask} className="flex flex-col gap-4">
          <Field label="Prompt" htmlFor="plan-prompt">
            <Textarea
              id="plan-prompt"
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Add OAuth login with a Google provider and a settings page…"
            />
          </Field>

          {error && <InlineError message={error} />}

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!prompt.trim()}>
              Ask the Architect
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function Loading({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm text-muted">
        <CircleNotchIcon size={16} className="animate-spin" />
        Asking the Architect…
      </div>
      <div className="flex flex-col gap-2" aria-hidden>
        <div className="h-3 w-3/4 animate-pulse rounded-sm bg-hover" />
        <div className="h-3 w-full animate-pulse rounded-sm bg-hover" />
        <div className="h-3 w-2/3 animate-pulse rounded-sm bg-hover" />
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning"
    >
      <WarningIcon size={14} className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

/**
 * PLAN-3 — the multi-sprint roadmap ("second brain"). Renders the Architect's
 * `backlog.sprints` as a semantic ordered list, highlighting the current sprint.
 * Absent-safe: renders nothing when there are no sprints. Accessible: ordered
 * list with a labelled region, current sprint marked via `aria-current`, and no
 * motion (reduced-motion-safe by construction).
 */
export function PlanBacklog({
  sprints,
  currentSprint,
}: {
  sprints: Sprint[];
  currentSprint: number;
}) {
  if (!Array.isArray(sprints) || sprints.length === 0) return null;
  return (
    <section aria-label="Multi-sprint roadmap" className="flex flex-col gap-2">
      <span className="text-xs font-medium tracking-wide text-muted">Roadmap</span>
      <ol className="flex flex-col gap-2">
        {sprints.map((s) => {
          const isCurrent = s.number === currentSprint;
          const tasks = Array.isArray(s.tasks) ? s.tasks : [];
          return (
            <li
              key={s.number}
              aria-current={isCurrent ? "step" : undefined}
              className={`rounded-sm border px-3 py-2 text-xs ${
                isCurrent
                  ? "border-accent/60 bg-accent/10"
                  : "border-border bg-surface"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-content">
                  Sprint {s.number}: {s.name}
                </span>
                {isCurrent && (
                  <span className="rounded-sm border border-accent/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">
                    Current
                  </span>
                )}
              </div>
              {tasks.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-faint">
                  {tasks.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
