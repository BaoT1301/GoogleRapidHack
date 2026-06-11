import { Schema, model, models, type Model } from "mongoose";

/**
 * Synced codebase knowledge base (Cloud Infra P3 / D5, D6).
 *
 * A bounded, secret-free structural snapshot of a project's repo (the same shape
 * the planner consumes as `codebaseContext`), persisted per `ownerId + projectId`
 * so the cloud planner/conductor can read it without touching the user's laptop.
 * The local index stays the source of truth; this is the synced mirror.
 *
 * The stored shape mirrors `CodebaseContext` (server/plan/codebase-context.ts) but
 * is declared locally so the DB layer does not import the server/plan layer.
 */
export const KB_SOURCES = ["repo-scan", "mcp-context-manager"] as const;
export type KbSource = (typeof KB_SOURCES)[number];

export interface ICodebaseKb {
  ownerId: string; // Clerk userId
  projectId: string;
  source: KbSource;
  repoSummary?: string;
  files: string[];
  symbols: string[];
  /**
   * Track D: embedding vectors aligned to the first N `symbols` (N capped at sync).
   * Optional — present only when embeddings are enabled; query_codebase falls back
   * to pure lexical ranking when absent.
   */
  symbolVectors?: number[][];
  embedModel?: string;
  /**
   * Track E: a compact slice of the call/import graph among the kept symbols, so the
   * planner can reason about FLOW (who calls/imports whom), not just location.
   */
  edges?: { from: string; to: string; type: string }[];
  /** Cheap repo signature (git HEAD + dirty hash) for staleness/auto-sync. */
  repoSignature?: string;
  stats?: {
    fileCount?: number;
    symbolCount?: number;
    languages?: string[];
  };
  indexedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CodebaseKbSchema = new Schema<ICodebaseKb>(
  {
    ownerId: { type: String, required: true, index: true },
    projectId: { type: String, required: true },
    source: { type: String, enum: KB_SOURCES, required: true },
    repoSummary: { type: String },
    files: { type: [String], default: [] },
    symbols: { type: [String], default: [] },
    symbolVectors: { type: [[Number]], default: undefined },
    embedModel: { type: String },
    edges: {
      type: [{ from: String, to: String, type: { type: String }, _id: false }],
      default: undefined,
    },
    repoSignature: { type: String },
    stats: {
      fileCount: { type: Number },
      symbolCount: { type: Number },
      languages: { type: [String], default: undefined },
    },
    indexedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// One KB doc per (owner, project) — sync upserts it.
CodebaseKbSchema.index({ ownerId: 1, projectId: 1 }, { unique: true });

export const CodebaseKbModel: Model<ICodebaseKb> =
  (models.CodebaseKb as Model<ICodebaseKb>) ??
  model<ICodebaseKb>("CodebaseKb", CodebaseKbSchema);
