/**
 * Embedder client (Track D) — orchestrator → services/llm /api/v1/embed.
 *
 * Used to embed KB symbols at sync and the query at retrieval time, for hybrid
 * semantic + lexical ranking. Gated by ORCH_KB_EMBEDDINGS: unset/false ⇒ no
 * embedder ⇒ pure lexical retrieval (current behavior, no regression, no live
 * dependency). Real embeddings light up when services/llm (with /api/v1/embed) is
 * deployed — same pattern as the agentic /api/v1/generate endpoint.
 */
export type Embedder = (texts: string[]) => Promise<number[][]>;

/** True when KB embeddings are enabled (opt-in) and the LLM service is configured. */
export function embeddingsEnabled(): boolean {
  return (
    process.env.ORCH_KB_EMBEDDINGS === "1" &&
    !!(process.env.LLM_API_URL ?? process.env.LLM_PROXY_URL)
  );
}

// Gemini's embedContent caps how many texts it accepts per request; batch under it
// so a large repo (hundreds of symbols) doesn't blow the limit in one call.
const EMBED_BATCH = 96;

/** HTTP embedder hitting services/llm; undefined when embeddings are disabled. */
export function getEmbedder(): Embedder | undefined {
  if (!embeddingsEnabled()) return undefined;
  const url = process.env.LLM_API_URL ?? process.env.LLM_PROXY_URL;
  const embedBatch = async (batch: string[]): Promise<number[][]> => {
    const res = await fetch(`${url}/api/v1/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Service-Token": process.env.LLM_SERVICE_TOKEN ?? "" },
      body: JSON.stringify({ texts: batch }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`embed failed: ${res.status}`);
    const body = (await res.json()) as { vectors?: number[][] };
    return body.vectors ?? [];
  };
  return async (texts: string[]) => {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      out.push(...(await embedBatch(texts.slice(i, i + EMBED_BATCH))));
    }
    return out;
  };
}
