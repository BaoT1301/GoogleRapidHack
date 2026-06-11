// KbGateway — persistence seam for the codebase KB (shared data-core). The DB half
// (get / getMeta / upsert); extraction stays local in the orchestrator. Mongo impl +
// shared types here; the orchestrator adds the BFF variant + selector.
import { connectDB } from "../db/client";
import { CodebaseKbModel, type KbSource } from "../db/models/codebase-kb.model";
import {
  KbSymbolVectorModel,
  KB_VECTOR_INDEX,
  KB_VECTOR_DIMS,
} from "../db/models/kb-symbol-vector.model";

/** A symbol returned by Atlas Vector Search, with its similarity score. */
export interface KbVectorHit {
  symbol: string;
  score: number;
}

export interface StoredKbDoc {
  source: KbSource;
  repoSummary?: string;
  files: string[];
  symbols: string[];
  symbolVectors?: number[][];
  embedModel?: string;
  edges?: { from: string; to: string; type: string }[];
  repoSignature?: string;
  stats?: { fileCount?: number; symbolCount?: number; languages?: string[] };
  indexedAt: Date;
}

export type KbUpsertInput = StoredKbDoc;

export interface KbGateway {
  /** Full stored KB (incl. vectors) or null when never synced. */
  get(ownerId: string, projectId: string): Promise<StoredKbDoc | null>;
  /** Lightweight freshness meta (no vectors) for auto-sync; null when no KB. */
  getMeta(ownerId: string, projectId: string): Promise<{ repoSignature?: string } | null>;
  /** Upsert the extracted snapshot. */
  upsert(ownerId: string, projectId: string, input: KbUpsertInput): Promise<StoredKbDoc>;
  /**
   * MongoDB Atlas Vector Search over the project's per-symbol embeddings. Returns the
   * top-k most semantically similar symbols. Returns [] when the vector index isn't
   * available yet (still building / not created / no embeddings) so callers fall back
   * to in-app cosine.
   */
  vectorSearch(
    ownerId: string,
    projectId: string,
    queryVector: number[],
    k: number,
  ): Promise<KbVectorHit[]>;
}

/**
 * Best-effort, idempotent creation of the Atlas vector-search index on the
 * kb_symbol_vectors collection. Atlas builds it asynchronously (minutes); until then
 * $vectorSearch returns nothing and callers fall back. Safe to call repeatedly.
 */
let vectorIndexEnsured = false;
export async function ensureKbVectorIndex(): Promise<boolean> {
  if (vectorIndexEnsured) return true;
  try {
    await connectDB();
    // Driver 6.6+ Collection.createSearchIndex. Throws if it already exists → fine.
    await (KbSymbolVectorModel.collection as unknown as {
      createSearchIndex: (d: unknown) => Promise<string>;
    }).createSearchIndex({
      name: KB_VECTOR_INDEX,
      type: "vectorSearch",
      definition: {
        fields: [
          { type: "vector", path: "vector", numDimensions: KB_VECTOR_DIMS, similarity: "cosine" },
          { type: "filter", path: "ownerId" },
          { type: "filter", path: "projectId" },
        ],
      },
    });
    vectorIndexEnsured = true;
    return true;
  } catch (err) {
    // Latch ONLY on a permanent condition (already exists, or non-Atlas/unsupported) so
    // a transient error — Atlas briefly unreachable, a flaky perms check — is retried on
    // the next call instead of pinning retrieval to the cosine fallback for the whole
    // process lifetime. Either way we degrade silently (callers fall back).
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    const permanent =
      /already exists|duplicate|exists|not supported|unsupported|command not found|unknown command|no such command|atlas/i.test(
        msg,
      );
    if (permanent) vectorIndexEnsured = true;
    return false;
  }
}

function toStored(doc: Record<string, unknown> | null): StoredKbDoc | null {
  if (!doc) return null;
  const d = doc as Partial<StoredKbDoc>;
  return {
    source: d.source as KbSource,
    repoSummary: d.repoSummary,
    files: d.files ?? [],
    symbols: d.symbols ?? [],
    symbolVectors: d.symbolVectors,
    embedModel: d.embedModel,
    edges: d.edges,
    repoSignature: d.repoSignature,
    stats: d.stats,
    indexedAt: (d.indexedAt as Date) ?? new Date(),
  };
}

/** Direct-Mongo implementation — the shipped behavior. */
export class MongoKbGateway implements KbGateway {
  async get(ownerId: string, projectId: string): Promise<StoredKbDoc | null> {
    await connectDB();
    return toStored(await CodebaseKbModel.findOne({ ownerId, projectId }).lean());
  }

  async getMeta(ownerId: string, projectId: string): Promise<{ repoSignature?: string } | null> {
    await connectDB();
    const kb = await CodebaseKbModel.findOne({ ownerId, projectId })
      .select("repoSignature")
      .lean();
    if (!kb) return null;
    return { repoSignature: kb.repoSignature };
  }

  async upsert(ownerId: string, projectId: string, input: KbUpsertInput): Promise<StoredKbDoc> {
    await connectDB();
    const doc = await CodebaseKbModel.findOneAndUpdate(
      { ownerId, projectId },
      {
        $set: {
          source: input.source,
          repoSummary: input.repoSummary,
          files: input.files,
          symbols: input.symbols,
          symbolVectors: input.symbolVectors,
          embedModel: input.embedModel,
          edges: input.edges,
          stats: input.stats,
          repoSignature: input.repoSignature,
          indexedAt: input.indexedAt,
        },
      },
      { upsert: true, new: true },
    ).lean();

    // Mirror the embeddings into per-symbol docs for Atlas Vector Search. Best-effort:
    // a failure here never fails the KB upsert (the cosine fallback still works off the
    // arrays stored above).
    await this.replaceSymbolVectors(ownerId, projectId, input).catch(() => {});

    return toStored(doc)!;
  }

  /** Replace the project's per-symbol vector docs to match the latest upsert. */
  private async replaceSymbolVectors(
    ownerId: string,
    projectId: string,
    input: KbUpsertInput,
  ): Promise<void> {
    const symbols = input.symbols ?? [];
    const vectors = input.symbolVectors ?? [];
    await connectDB();
    await KbSymbolVectorModel.deleteMany({ ownerId, projectId });
    if (vectors.length === 0) return;
    const docs = vectors
      .map((vector, idx) => ({
        ownerId,
        projectId,
        idx,
        symbol: symbols[idx] ?? "",
        vector,
        embedModel: input.embedModel,
      }))
      // Only persist vectors of the EXACT indexed dimensionality. A model/provider
      // change (or a partial/empty embed) yields off-dimension vectors that the Atlas
      // $vectorSearch index ($numDimensions = KB_VECTOR_DIMS) would reject at query
      // time; dropping them here keeps the collection clean and search reliable (the
      // in-app cosine fallback still works off the KB doc's parallel arrays).
      .filter(
        (d) =>
          d.symbol.length > 0 &&
          Array.isArray(d.vector) &&
          d.vector.length === KB_VECTOR_DIMS,
      );
    if (docs.length > 0) {
      await KbSymbolVectorModel.insertMany(docs, { ordered: false });
      // Proactively ensure the Atlas vector index exists (idempotent, best-effort) so
      // it starts building right after the first sync rather than on first query.
      void ensureKbVectorIndex().catch(() => {});
    }
  }

  async vectorSearch(
    ownerId: string,
    projectId: string,
    queryVector: number[],
    k: number,
  ): Promise<KbVectorHit[]> {
    // Guard the dimensionality: a wrong-dim query vector (model/provider change) would
    // make $vectorSearch throw; short-circuit to the cosine/lexical fallback instead.
    if (queryVector.length !== KB_VECTOR_DIMS) return [];
    try {
      await connectDB();
      await ensureKbVectorIndex();
      const rows = await KbSymbolVectorModel.aggregate<KbVectorHit>([
        {
          $vectorSearch: {
            index: KB_VECTOR_INDEX,
            path: "vector",
            queryVector,
            numCandidates: Math.max(100, k * 10),
            limit: k,
            filter: { ownerId, projectId },
          },
        },
        { $project: { _id: 0, symbol: 1, score: { $meta: "vectorSearchScore" } } },
      ]);
      return rows;
    } catch {
      // Index not ready / non-Atlas / no embeddings → caller falls back to cosine.
      return [];
    }
  }
}

export const mongoKbGateway = new MongoKbGateway();
