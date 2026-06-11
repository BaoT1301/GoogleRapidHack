/**
 * Hybrid lexical + semantic retrieval over the KB (Track D3).
 *
 * Lexical (query-codebase.ts) matches keywords; semantic (this module) matches
 * MEANING via embedding cosine similarity — so a query for "auth" can surface
 * "login"/"session"/"credentials" even without the literal token. We combine both
 * (normalized) so exact hits and related-but-differently-named code both rank well.
 *
 * Fully additive: when no embedder or no stored vectors are available, this
 * delegates to the pure-lexical `queryCodebaseMatches` (no regression).
 */
import type { Embedder } from "./embedder";
import { extractQueryTerms, queryCodebaseMatches, scoreItem } from "./query-codebase";

/** Cosine similarity of two equal-length vectors (0 when either is empty/degenerate). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface HybridKb {
  symbols?: string[];
  files?: string[];
  symbolVectors?: number[][];
}

export interface HybridOptions {
  embedder?: Embedder;
  limit?: number;
  /** Weight of the semantic score vs lexical (0..1). Default 0.6. */
  semanticWeight?: number;
  /**
   * Server-side ANN (MongoDB Atlas Vector Search). When provided AND it returns hits,
   * the semantic half comes from Atlas instead of in-app cosine. Receives the query
   * embedding + a candidate count; returns symbol+score. Falls back to in-app cosine
   * on empty/error.
   */
  vectorSearch?: (queryVec: number[], k: number) => Promise<{ symbol: string; score: number }[]>;
}

/**
 * Rank a KB's symbols/files for a query, blending lexical + semantic when vectors
 * and an embedder are available; otherwise pure lexical. Returns the top matches.
 */
export async function hybridMatches(
  kb: HybridKb,
  query: string,
  options: HybridOptions = {},
): Promise<{ symbols: string[]; files: string[] }> {
  const symbols = kb.symbols ?? [];
  const vectors = kb.symbolVectors ?? [];
  const limit = options.limit ?? 40;
  const embedder = options.embedder;

  // No semantic signal available → pure lexical (unchanged behavior). Atlas Vector
  // Search can supply the semantic half even when no in-memory vectors are present.
  if (!embedder || (vectors.length === 0 && !options.vectorSearch)) {
    return queryCodebaseMatches({ symbols, files: kb.files }, query, limit);
  }

  let queryVec: number[];
  try {
    queryVec = (await embedder([query]))[0] ?? [];
  } catch {
    return queryCodebaseMatches({ symbols, files: kb.files }, query, limit);
  }
  if (queryVec.length === 0) {
    return queryCodebaseMatches({ symbols, files: kb.files }, query, limit);
  }

  const terms = extractQueryTerms(query);
  const wSem = options.semanticWeight ?? 0.6;
  const wLex = 1 - wSem;

  // Semantic half: prefer MongoDB Atlas Vector Search (server-side ANN) when wired and
  // it returns hits; otherwise in-app cosine over the stored vectors. semBySymbol maps
  // a symbol's text → normalized semantic score (0..1).
  let semBySymbol: Map<string, number> | null = null;
  if (options.vectorSearch) {
    try {
      const hits = await options.vectorSearch(queryVec, Math.max(limit, 40));
      if (hits.length > 0) {
        const maxScore = Math.max(1e-9, ...hits.map((h) => h.score));
        semBySymbol = new Map(hits.map((h) => [h.symbol, Math.max(0, h.score) / maxScore]));
      }
    } catch {
      // fall back to in-app cosine below
    }
  }

  // Lexical scores are small integers; normalize to 0..1 by the max seen.
  const lexRaw = symbols.map((s) => scoreItem(s, terms));
  const lexMax = Math.max(1, ...lexRaw);

  const scored = symbols.map((value, i) => {
    const lex = lexRaw[i] / lexMax;
    const sem = semBySymbol
      ? semBySymbol.get(value) ?? 0
      : i < vectors.length
        ? Math.max(0, cosineSimilarity(queryVec, vectors[i]))
        : 0;
    return { value, index: i, score: wLex * lex + wSem * sem };
  });

  const rankedSymbols = scored
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((e) => e.value);

  // Files stay lexical (no per-file vectors); reuse the lexical matcher.
  const { files } = queryCodebaseMatches({ files: kb.files }, query, limit);
  return { symbols: rankedSymbols, files };
}
