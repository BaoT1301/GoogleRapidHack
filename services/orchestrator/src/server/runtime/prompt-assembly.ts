/**
 * MODEL-2 — `assembleNodePrompt`: the SINGLE source of truth for composing a
 * node's final CLI prompt.
 *
 * Canonical composition (matches the pre-MODEL-2 RUN-7 behavior when there are
 * no data edges → byte-identical):
 *
 *   1. base prompt = `node.data.prompt ?? defaultPrompt ?? node.label ?? ""`
 *   2. resolve `{{upstream.<id>.<path>}}` DATA bindings (sandboxed) over the
 *      provided upstream outputs (`resolveDataBindings`)
 *   3. prepend the materialized `## Attached context` block (RUN-7,
 *      `resolveAttachedContext` / `applyAttachedContext`)
 *
 * Reused by `run-executor` (execute/review/doc branches) AND PLAN-7's read-only
 * preview (Track 4), which calls it with EMPTY upstream outputs and surfaces the
 * `unresolvedBindings`. Pure + framework-free + never throws.
 */
import { resolveDataBindings } from "./data-bindings";
import { resolveAttachedContext, applyAttachedContext } from "./context-materialize";

interface MinNode {
  id: string;
  kind?: string;
  label?: string;
  notes?: string;
  data?: unknown;
}
interface MinEdge {
  source: string;
  target: string;
  kind?: string;
}

export interface AssembleNodePromptInput {
  node: MinNode;
  nodes: MinNode[];
  edges: MinEdge[];
  /** Upstream parsed outputs keyed by nodeId (data-edge sources). */
  upstreamOutputs?: Record<string, unknown>;
  /** Kind-specific default prompt used when the node carries no `data.prompt`. */
  defaultPrompt?: string;
  /**
   * TPL-4 — resolved persona definition (workspace fork or default) for a node
   * that pins `data.persona`. Prepended as a bounded `## Persona` block.
   * Absent-safe: when undefined/empty the composed prompt is byte-identical.
   */
  personaContent?: string;
}

export interface AssembledPrompt {
  /** The fully composed prompt sent to the CLI. */
  prompt: string;
  /** `{{upstream…}}` placeholders that could not be resolved (preview/dry-run). */
  unresolvedBindings: string[];
  /** Whether an `## Attached context` block was prepended. */
  attachedContextPresent: boolean;
  /** Whether a resolved `## Persona` block was prepended (TPL-4). */
  personaBlockPresent: boolean;
}

/** Hard cap on the prepended persona block (defense-in-depth). */
const MAX_PERSONA_CHARS = 8000;

/**
 * Prepend a bounded, clearly-framed `## Persona` block to a prompt. Returns the
 * prompt UNCHANGED when there is no persona content (absent-safe) so a node with
 * no pinned persona is byte-identical to before TPL-4.
 */
export function applyPersonaBlock(prompt: string, personaContent?: string): string {
  if (!personaContent || personaContent.trim().length === 0) return prompt;
  const trimmed = personaContent.trim();
  const body =
    trimmed.length <= MAX_PERSONA_CHARS
      ? trimmed
      : `${trimmed.slice(0, MAX_PERSONA_CHARS)}\n…[truncated]`;
  const block = [
    "## Persona",
    "",
    "You operate as the persona defined below for this node. Adopt its role,",
    "scope, and operational rules.",
    "",
    body,
  ].join("\n");
  return `${block}\n\n---\n\n${prompt}`;
}

/** Read a node's `data.prompt` string, if present. */
function nodePrompt(node: MinNode): string | undefined {
  const data =
    node.data && typeof node.data === "object" && !Array.isArray(node.data)
      ? (node.data as Record<string, unknown>)
      : undefined;
  const p = data?.prompt;
  return typeof p === "string" ? p : undefined;
}

export function assembleNodePrompt(input: AssembleNodePromptInput): AssembledPrompt {
  const base = nodePrompt(input.node) ?? input.defaultPrompt ?? input.node.label ?? "";
  const { text: bound, unresolved } = resolveDataBindings(
    base,
    input.upstreamOutputs ?? {},
  );
  const attached = resolveAttachedContext(input.node.id, input.nodes, input.edges);
  const withContext = applyAttachedContext(bound, attached);
  const personaPresent = Boolean(
    input.personaContent && input.personaContent.trim().length > 0,
  );
  return {
    prompt: applyPersonaBlock(withContext, input.personaContent),
    unresolvedBindings: unresolved,
    attachedContextPresent: attached.length > 0,
    personaBlockPresent: personaPresent,
  };
}
