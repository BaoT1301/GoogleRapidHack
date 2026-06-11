// fixer-context (WOW-3) — a pure, READ-ONLY projection of a run's persisted
// per-node state into the grounding a spawned fixer needs: the node's latest
// diff preview + last error. No writes, no git, no network.
//
// The ported runtime persists a node's patch/error inside `nodeRuns.<id>.events`
// (event payloads `{ type:"node.patch", patchPreview }` / `{ type:"node.failed",
// reason|error|stderrPreview }`), and the top-level `nodeRuns.<id>.patch`/`error`
// fields exist on the model too — this reads whichever is present (top-level
// first, then the latest matching event). Previews are already capped at the
// 1000-char budget by `execute-runner`; we re-cap defensively.

export const FIXER_DIFF_PREVIEW_BUDGET = 1000;

/** Minimal read-only view of a persisted node run (Mongo `.lean()` shape). */
export interface PersistedNodeRunLike {
  status?: string;
  patch?: string;
  error?: { code?: string; message?: string; stack?: string } | null;
  events?: Array<{ level?: string; payload?: unknown }>;
}

/** Per-node fixer context returned by `runs.fixerContext`. */
export interface FixerNodeContext {
  nodeId: string;
  label?: string;
  diffPreview?: string;
  lastError?: string;
}

function cap(text: string, budget = FIXER_DIFF_PREVIEW_BUDGET): string {
  return text.length > budget ? text.slice(0, budget) : text;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

/** Latest event payload whose `type` matches, scanning newest-first. */
function latestPayloadOfType(
  events: PersistedNodeRunLike["events"],
  type: string,
): Record<string, unknown> | undefined {
  if (!events) return undefined;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const payload = asRecord(events[i]?.payload);
    if (payload && payload.type === type) return payload;
  }
  return undefined;
}

/**
 * Derive the read-only fixer context for a single node. Returns `diffPreview`
 * (capped) and `lastError` when available; gracefully omits them otherwise.
 */
export function deriveFixerContext(
  nodeId: string,
  nodeRun: PersistedNodeRunLike | undefined,
  label?: string,
): FixerNodeContext {
  // Diff preview: prefer a persisted top-level patch, else the latest node.patch
  // event's already-capped preview.
  let diffPreview: string | undefined;
  if (typeof nodeRun?.patch === "string" && nodeRun.patch.length > 0) {
    diffPreview = cap(nodeRun.patch);
  } else {
    const patchEvent = latestPayloadOfType(nodeRun?.events, "node.patch");
    const preview = patchEvent?.patchPreview;
    if (typeof preview === "string" && preview.length > 0) diffPreview = cap(preview);
  }

  // Last error: prefer a persisted top-level error, else the latest node.failed
  // event (reason → error → stderrPreview).
  let lastError: string | undefined;
  if (nodeRun?.error?.message) {
    lastError = nodeRun.error.message;
  } else {
    const failedEvent = latestPayloadOfType(nodeRun?.events, "node.failed");
    if (failedEvent) {
      const reason = failedEvent.reason ?? failedEvent.error ?? failedEvent.stderrPreview;
      if (typeof reason === "string" && reason.length > 0) lastError = cap(reason);
      else lastError = "Node failed";
    }
  }

  return { nodeId, label, diffPreview, lastError };
}
