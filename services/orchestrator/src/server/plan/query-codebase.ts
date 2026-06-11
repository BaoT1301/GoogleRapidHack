/**
 * query_codebase — server-side relevance retrieval over a project's KB (P4).
 *
 * The agentic-retrieval primitive: given a task/query and a stored CodebaseContext
 * (the synced KB), rank the repo's symbols and files by relevance and return a
 * FOCUSED, bounded slice. This is the tool an agentic planner calls ("show me the
 * auth files", "who relates to billing") and what `plan.generate` uses to focus a
 * big repo's context on the parts that matter for the task — instead of dumping
 * everything. Pure + deterministic + unit-testable; the LLM-driven tool loop
 * (Gemini function-calling in services/llm) layers on top of this.
 */
import type { CodebaseContext } from "./codebase-context";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "add", "use", "using", "into", "from", "this",
  "that", "make", "build", "create", "update", "change", "refactor", "fix",
  "implement", "support", "feature", "code", "app", "system", "new", "all",
]);

/** Tokenize a prompt/query into meaningful lowercase terms (len ≥ 3, no stopwords). */
export function extractQueryTerms(query: string): string[] {
  const terms = (query.toLowerCase().match(/[a-z0-9_]+/g) ?? [])
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return [...new Set(terms)];
}

/** Relevance score of an item string against query terms (substring + camel/snake aware). */
export function scoreItem(item: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const hay = item.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (hay.includes(term)) score += 2; // direct substring hit (symbol or path)
  }
  return score;
}

/** Stable rank by score desc, keep original order on ties, cap to `limit`. */
function rankAndCap(items: string[], terms: string[], limit: number): string[] {
  return items
    .map((value, index) => ({ value, index, score: scoreItem(value, terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((e) => e.value);
}

export interface QueryCodebaseOptions {
  maxSymbols?: number;
  maxFiles?: number;
}

const DEFAULTS = { maxSymbols: 40, maxFiles: 40 } as const;

/**
 * Focus a KB on a query: returns a bounded CodebaseContext with the most relevant
 * symbols/files first. Keeps the repoSummary + stats. Returns undefined only when
 * the KB has no symbols AND no files (nothing to focus → caller falls back).
 *
 * For a small repo (under the caps) this keeps everything but ranks the relevant
 * items first; for a large repo it trims to the top-K relevant — the agentic win.
 */
export function queryCodebaseKb(
  kb: Pick<CodebaseContext, "repoSummary" | "files" | "symbols" | "edges" | "stats">,
  query: string,
  options: QueryCodebaseOptions = {},
): CodebaseContext | undefined {
  const symbols = kb.symbols ?? [];
  const files = kb.files ?? [];
  if (symbols.length === 0 && files.length === 0) return undefined;

  const terms = extractQueryTerms(query);
  const maxSymbols = options.maxSymbols ?? DEFAULTS.maxSymbols;
  const maxFiles = options.maxFiles ?? DEFAULTS.maxFiles;

  const out: CodebaseContext = {
    repoSummary: kb.repoSummary,
    symbols: symbols.length > 0 ? rankAndCap(symbols, terms, maxSymbols) : undefined,
    files: files.length > 0 ? rankAndCap(files, terms, maxFiles) : undefined,
    // Edges pass through (already bounded at sync; the per-request sanitize re-caps).
    edges: kb.edges,
    stats: kb.stats,
  };
  return out;
}

/**
 * Raw ranked matches for the `kb.query` tool surface — returns the matching
 * symbols/files (score > 0) for a query, bounded. Used by callers that want the
 * "hits" rather than a focused CodebaseContext (e.g. an LLM tool call).
 */
export function queryCodebaseMatches(
  kb: Pick<CodebaseContext, "files" | "symbols">,
  query: string,
  limit = 40,
): { symbols: string[]; files: string[] } {
  const terms = extractQueryTerms(query);
  const pick = (items: string[]) =>
    items
      .map((value, index) => ({ value, index, score: scoreItem(value, terms) }))
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
      .map((e) => e.value);
  return { symbols: pick(kb.symbols ?? []), files: pick(kb.files ?? []) };
}
