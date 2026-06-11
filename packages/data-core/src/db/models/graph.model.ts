import { Schema, model, models, type Model } from "mongoose";

// ─── Enums ──────────────────────────────────────────────────────────────────
export const NODE_KINDS = [
  "plan",
  "execute",
  "review",
  "doc",
  "gate",
  "context",
  "loop",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const NODE_STATUSES = [
  "pending",
  "ready",
  "running",
  "paused",
  "success",
  "failed",
  "skipped",
  "blocked",
] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export const EDGE_KINDS = ["flow", "data", "attaches-to", "loop"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

// CLI-2: graph-level CLI selection (workflow setting). Kept as a LOCAL literal
// list so the DB model does not import the runtime layer. MUST stay in sync with
// `SupportedCli` in `server/runtime/types.ts` — `graph.model.cli-sync.test.ts`
// pins the equality so the two can never drift.
export const SUPPORTED_CLIS = ["fake", "codex", "kiro", "gemini", "claude"] as const;
export type SupportedCli = (typeof SUPPORTED_CLIS)[number];

export const GRAPH_STATUSES = [
  "draft",
  "running",
  "paused",
  "completed",
  "archived",
  "failed",
] as const;
export type GraphStatus = (typeof GRAPH_STATUSES)[number];

// ─── Subdocument shapes (plain TS interfaces, not `typeof Schema`) ────────────
export interface INodeSpec {
  id: string;
  kind: NodeKind;
  label: string;
  position: { x: number; y: number };
  status: NodeStatus;
  notes?: string;
  /** Kind-specific fields (persona, cli, prompt, worktree, …) — see ADR §5. */
  data: Record<string, unknown>;
}

export interface IEdgeSpec {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  outputKey?: string; // data edges
  inputKey?: string; // data edges
  fanInMode?: "all-of" | "any-of"; // flow edges
}

export interface IGraph {
  graphSpecVersion: string;
  ownerId: string; // Clerk userId — every query is scoped by this
  name: string;
  description?: string;
  rootRepoPath?: string;
  baseBranch: string;
  /**
   * CLI-2: graph-level CLI for the workflow. Optional + additive — when set,
   * `run-executor` uses it for nodes that omit `data.cli` (per-node `data.cli`
   * still wins). Existing graphs without it are unaffected (resolves to "fake").
   */
  cli?: SupportedCli;
  status: GraphStatus;
  nodes: INodeSpec[];
  edges: IEdgeSpec[];
  variables?: Map<string, unknown>;
  parentGraphId?: string; // set when this graph is a spawned child sub-graph
  parentNodeId?: string;
  /**
   * PLAN-4: multi-sprint plan linkage. When a multi-sprint Architect backlog is
   * expanded into ONE graph per sprint, all those graphs share a generated
   * `planId` and carry their ordered `sprintNumber` (+ human `sprintName`).
   * Additive + optional — mirrors the `parentGraphId`/`parentNodeId` precedent
   * (plain optional String/Number, no default); existing graphs are unaffected
   * (absent → a standalone single-canvas graph as before).
   */
  planId?: string;
  sprintNumber?: number;
  sprintName?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────
const NodeSpecSchema = new Schema<INodeSpec>(
  {
    id: { type: String, required: true },
    kind: { type: String, enum: NODE_KINDS, required: true },
    label: { type: String, required: true },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
    status: { type: String, enum: NODE_STATUSES, default: "pending" },
    notes: String,
    data: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const EdgeSpecSchema = new Schema<IEdgeSpec>(
  {
    id: { type: String, required: true },
    source: { type: String, required: true },
    target: { type: String, required: true },
    kind: { type: String, enum: EDGE_KINDS, required: true },
    outputKey: String,
    inputKey: String,
    fanInMode: { type: String, enum: ["all-of", "any-of"] },
  },
  { _id: false },
);

const GraphSchema = new Schema<IGraph>(
  {
    graphSpecVersion: { type: String, default: "1.0" },
    ownerId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: String,
    rootRepoPath: String,
    baseBranch: { type: String, default: "main" },
    // CLI-2: additive, optional, enum-validated. No default → absent on existing
    // graphs (run-executor falls back to per-node cli → "fake").
    cli: { type: String, enum: SUPPORTED_CLIS },
    status: { type: String, enum: GRAPH_STATUSES, default: "draft" },
    nodes: { type: [NodeSpecSchema], default: [] },
    edges: { type: [EdgeSpecSchema], default: [] },
    variables: { type: Map, of: Schema.Types.Mixed },
    parentGraphId: String,
    parentNodeId: String,
    // PLAN-4: additive, optional multi-sprint linkage. No defaults → absent on
    // existing graphs (which stay standalone). All graphs expanded from one
    // multi-sprint plan share `planId` + carry their ordered `sprintNumber`.
    planId: String,
    sprintNumber: Number,
    sprintName: String,
  },
  { timestamps: true },
);

// User's graphs, most-recently-updated first.
GraphSchema.index({ ownerId: 1, updatedAt: -1 });

// PLAN-4: a plan's linked sprint graphs, ordered by sprintNumber (owner-scoped
// progress aggregation in PLAN-5 reads them this way).
GraphSchema.index({ ownerId: 1, planId: 1, sprintNumber: 1 });

// HMR-safe: reuse the compiled model if it already exists (Next dev reloads modules).
export const GraphModel: Model<IGraph> =
  (models.Graph as Model<IGraph>) ?? model<IGraph>("Graph", GraphSchema);
