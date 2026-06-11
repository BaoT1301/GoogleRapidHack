/**
 * KB health checks — turn a KB snapshot into human-readable warnings so the user can
 * SEE whether the indexed data is sound (the "validate the data is correct" gap), and
 * so the Project Readiness panel can show actionable hints instead of a silent KB.
 *
 * Pure + framework-free (no DB/fs) → unit-tested. Callers feed it counts they already
 * have (from the sync result or a status read).
 */
export interface KbHealthInput {
  /** "mcp-context-manager" (rich) or "repo-scan" (fallback). */
  source: string;
  symbolCount: number;
  fileCount: number;
  /** Symbols that carry an embedding vector. */
  vectorCount: number;
  /** Whether the embedder is configured (so vectors are expected). */
  embeddingsEnabled: boolean;
  /** Whether the repo is a git work tree (needed for incremental change detection). */
  isGitRepo: boolean;
  /** Whether the stored KB is behind the current repo state. */
  stale: boolean;
  /** Whether a KB has ever been synced for this project. */
  synced: boolean;
}

export interface KbHealth {
  /** No blocking problems (may still have info-level warnings). */
  ok: boolean;
  warnings: string[];
}

export function evaluateKbHealth(h: KbHealthInput): KbHealth {
  const warnings: string[] = [];

  if (!h.synced) {
    return { ok: false, warnings: ["KB has not been synced yet — run a sync to index this repo."] };
  }
  if (h.symbolCount === 0) {
    warnings.push("No symbols indexed — the repo looks empty or the indexer returned nothing.");
  }
  if (!h.isGitRepo) {
    warnings.push("Not a git repository — change detection is off, so the KB won't auto-resync.");
  }
  if (h.source === "repo-scan") {
    warnings.push(
      "Using the lightweight repo-scan; set MCP_CONTEXT_URL for richer indexing (hotspots + call graph).",
    );
  }
  if (h.embeddingsEnabled && h.symbolCount > 0 && h.vectorCount === 0) {
    warnings.push("Embeddings unavailable — search falls back to keyword-only (lower quality).");
  }
  if (h.stale) {
    warnings.push("KB is out of date with the repo — re-sync to refresh.");
  }

  // "ok" = nothing that meaningfully degrades planning. Source/stale are advisory.
  const blocking = h.symbolCount === 0 || (h.embeddingsEnabled && h.vectorCount === 0);
  return { ok: !blocking, warnings };
}
