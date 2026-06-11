import { Schema, model, models, type Model } from "mongoose";

/**
 * One embedded symbol per document — the shape MongoDB Atlas Vector Search needs
 * ($vectorSearch indexes a single `vector` field per doc, not an array-of-vectors).
 * The KB doc (codebase-kb.model) still stores the parallel symbols/symbolVectors
 * arrays for the in-app cosine fallback; this collection mirrors them per-symbol so
 * retrieval can run as a server-side ANN query against Atlas.
 *
 * Scoped by ownerId+projectId (both are `filter` fields in the vector index).
 */
export interface IKbSymbolVector {
  ownerId: string;
  projectId: string;
  /** Stable position in the KB's symbols[] (for dedupe/debug). */
  idx: number;
  /** The enriched symbol text (name + signature/doc) — returned by search. */
  symbol: string;
  vector: number[];
  embedModel?: string;
}

const KbSymbolVectorSchema = new Schema<IKbSymbolVector>(
  {
    ownerId: { type: String, required: true },
    projectId: { type: String, required: true },
    idx: { type: Number, required: true },
    symbol: { type: String, required: true },
    vector: { type: [Number], required: true },
    embedModel: { type: String },
  },
  { timestamps: false },
);

// Scope lookups/deletes; the Atlas VECTOR index on `vector` is created separately
// via createSearchIndex (see kb-gateway.ensureKbVectorIndex) — not a normal index.
KbSymbolVectorSchema.index({ ownerId: 1, projectId: 1 });

export const KbSymbolVectorModel: Model<IKbSymbolVector> =
  (models.KbSymbolVector as Model<IKbSymbolVector>) ??
  model<IKbSymbolVector>("KbSymbolVector", KbSymbolVectorSchema);

/** Name of the Atlas vector-search index + embedding dimensionality (Gemini text-embedding-004). */
export const KB_VECTOR_INDEX = "kb_symbol_vector_index";
export const KB_VECTOR_DIMS = 768;
