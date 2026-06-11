import { assembleNodePrompt } from "../runtime/prompt-assembly";
import { REVIEWER_AGENT_NAME, REVIEWER_TRUST_TOOLS } from "../runtime/reviewer-agent";
import { DOC_AGENT_NAME, DOC_TRUST_TOOLS } from "../runtime/doc-agent";
import { SUPPORTED_CLIS, type SupportedCli } from "../runtime/types";

/**
 * PLAN-7 — pure, READ-ONLY assembly of a node's would-be prompt for the
 * Inspector dry-run preview. It reuses the MODEL-2 `assembleNodePrompt` seam
 * (Do-Not-Invent — never re-implements prompt assembly) with EMPTY upstream
 * outputs (a dry-run has no run), surfacing any `{{upstream…}}` placeholders as
 * `unresolvedBindings`. It NEVER spawns, writes, or creates a worktree.
 *
 * The CLI / agent / trust-tools mirror what `run-executor` would resolve at run
 * time so the preview is faithful:
 *   - CLI: node `data.cli` → graph-level `cli` → "codex".
 *   - review nodes: persona-locked `orch-reviewer` agent + read-only trust-tools.
 *   - doc nodes: persona-locked `orch-doc` agent + doc-scoped (read+write) trust-tools.
 *   - execute (and other) nodes: the owner's resolved execute trust-tools.
 */

interface PreviewNode {
  id: string;
  kind?: string;
  label?: string;
  notes?: string;
  data?: unknown;
}
interface PreviewEdge {
  source: string;
  target: string;
  kind?: string;
}
export interface PreviewGraphLike {
  nodes?: PreviewNode[];
  edges?: PreviewEdge[];
  cli?: string;
}

export interface NodePromptPreview {
  nodeId: string;
  kind: string;
  prompt: string;
  cli: SupportedCli;
  agent?: string;
  trustTools: string;
  attachedContextPresent: boolean;
  unresolvedBindings: string[];
}

/** Read a node's `data.cli` string, if present. */
function nodeCli(node: PreviewNode): string | undefined {
  const data =
    node.data && typeof node.data === "object" && !Array.isArray(node.data)
      ? (node.data as Record<string, unknown>)
      : undefined;
  const cli = data?.cli;
  return typeof cli === "string" ? cli : undefined;
}

export function buildNodePromptPreview(input: {
  graph: PreviewGraphLike;
  nodeId: string;
  /** Owner-resolved execute trust-tools (`toTrustToolsArg(resolveAllowedTools)`). */
  executeTrustTools: string;
}): NodePromptPreview | null {
  const nodes = input.graph.nodes ?? [];
  const node = nodes.find((n) => n.id === input.nodeId);
  if (!node) return null;
  const edges = input.graph.edges ?? [];
  const kind = node.kind ?? "execute";
  const label = node.label ?? "";

  // Mirror run-executor's per-kind defaults so the preview matches a real run.
  let defaultPrompt: string | undefined;
  let agent: string | undefined;
  let trustTools = input.executeTrustTools;
  if (kind === "review") {
    defaultPrompt =
      `Audit the work in this run's worktree for regressions, broken contracts, and out-of-scope edits. ${label}`.trim();
    agent = REVIEWER_AGENT_NAME;
    trustTools = REVIEWER_TRUST_TOOLS;
  } else if (kind === "doc") {
    defaultPrompt =
      `Update the documentation to reflect this run's work. Edit ONLY .claude/** and *.md files. ${label}`.trim();
    agent = DOC_AGENT_NAME;
    trustTools = DOC_TRUST_TOOLS;
  }

  const { prompt, unresolvedBindings, attachedContextPresent } = assembleNodePrompt({
    node,
    nodes,
    edges,
    upstreamOutputs: {}, // dry-run: no settled upstream outputs
    defaultPrompt,
  });

  const candidate = nodeCli(node) ?? input.graph.cli ?? "codex";
  const cli = (SUPPORTED_CLIS as readonly string[]).includes(candidate)
    ? (candidate as SupportedCli)
    : "codex";

  return {
    nodeId: node.id,
    kind,
    prompt,
    cli,
    agent,
    trustTools,
    attachedContextPresent,
    unresolvedBindings,
  };
}
