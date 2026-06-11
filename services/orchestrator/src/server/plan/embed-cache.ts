/**
 * Incremental embedding (KB sync cost saver). The previous KB doc IS the cache:
 * vectors are stored aligned to their symbol texts, so on a resync we reuse the
 * vector of any symbol whose text is unchanged and only call the embedder for the
 * new/changed ones. One changed file no longer means re-embedding all ~500 symbols.
 *
 * Cache key = the exact symbol text that was embedded (e.g. "AppError — src/lib/api/
 * response.ts", or later a signature/docstring). If the embedding MODEL changed, the
 * whole cache is invalidated (vectors from different models aren't comparable).
 *
 * Pure + framework-free (no DB, no network beyond the injected embedder) so it is
 * unit-tested in isolation.
 */
import type { Embedder } from "./embedder";

export interface EmbedWithCacheInput {
  /** New symbol texts to embed (already capped to EMBED_CAP by the caller). */
  symbols: string[];
  /** Previously-stored symbol texts (aligned to `prevVectors`). */
  prevSymbols?: string[];
  /** Previously-stored vectors (aligned to `prevSymbols`). */
  prevVectors?: number[][];
  /** Model that produced `prevVectors`; cache is used only when it matches `model`. */
  prevModel?: string;
  /** Current embedding model id. */
  model: string;
  embedder: Embedder;
}

export interface EmbedWithCacheResult {
  /** Vectors aligned 1:1 to `symbols`. */
  vectors: number[][];
  /** How many symbols were freshly embedded (cache misses). */
  embedded: number;
  /** How many symbols reused a cached vector (cache hits). */
  reused: number;
}

/**
 * Embed `symbols`, reusing `prevVectors` for any symbol whose text is unchanged.
 * Only the cache misses are sent to the embedder (batched in one call). Returns the
 * full aligned vector list plus hit/miss counts (surfaced for validation/UX).
 */
export async function embedWithCache(
  input: EmbedWithCacheInput,
): Promise<EmbedWithCacheResult> {
  const { symbols, embedder, model } = input;

  // Build text -> vector cache from the previous doc, but only when the model is the
  // same (vectors from a different model live in a different space — never reuse).
  const cache = new Map<string, number[]>();
  if (input.prevModel && input.prevModel === model) {
    const prevSymbols = input.prevSymbols ?? [];
    const prevVectors = input.prevVectors ?? [];
    const n = Math.min(prevSymbols.length, prevVectors.length);
    for (let i = 0; i < n; i++) {
      const vec = prevVectors[i];
      if (Array.isArray(vec) && vec.length > 0) cache.set(prevSymbols[i], vec);
    }
  }

  const out: (number[] | undefined)[] = new Array(symbols.length);
  const misses: string[] = [];
  const missIdx: number[] = [];
  for (let i = 0; i < symbols.length; i++) {
    const hit = cache.get(symbols[i]);
    if (hit) {
      out[i] = hit;
    } else {
      missIdx.push(i);
      misses.push(symbols[i]);
    }
  }

  // Cache hits are the symbols whose vector we reused (everything not a miss).
  const reused = symbols.length - misses.length;
  let embedded = 0;
  if (misses.length > 0) {
    const fresh = await embedder(misses);
    for (let k = 0; k < missIdx.length; k++) {
      const v = fresh[k];
      // A short/truncated embedder response leaves some misses without a vector. Store
      // [] (keeps the array aligned to symbols[] for the cosine fallback) but DON'T
      // count it as embedded — otherwise `embedded`/vectorCount overstate real coverage.
      if (Array.isArray(v) && v.length > 0) {
        out[missIdx[k]] = v;
        embedded++;
      } else {
        out[missIdx[k]] = [];
      }
    }
  }

  return {
    vectors: out.map((v) => v ?? []),
    embedded,
    reused,
  };
}
