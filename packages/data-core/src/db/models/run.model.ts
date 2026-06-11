import { Schema, model, models, type Model } from "mongoose";

export const EVENT_LEVELS = [
  "info",
  "warn",
  "error",
  "tool",
  "stdout",
  "stderr",
] as const;
export type EventLevel = (typeof EVENT_LEVELS)[number];

// One streamed event from a CLI subprocess (Stephen's runner emits these).
export interface INodeRunEvent {
  ts: string;
  level: EventLevel;
  payload: unknown;
}

// State of a single node within a run.
export interface INodeRun {
  nodeId: string;
  status: string;
  attempt: number;
  startedAt?: string;
  finishedAt?: string;
  cli?: string; // "claude" | "gemini" | "codex" | "kiro"
  worktreePath?: string;
  branchName?: string; // "agent/<runId>/<nodeId>"
  baseRef?: string;
  resolvedPersona?: { id?: string; version?: string; sha?: string };
  resolvedPromptSha?: string;
  events: INodeRunEvent[];
  outputs?: Record<string, unknown>;
  patch?: string; // git diff vs baseRef (capped; large → GridFS later)
  error?: { code?: string; message?: string; stack?: string };
}

export interface IRun {
  graphId: string;
  graphSnapshot: Record<string, unknown>; // immutable copy of the GraphSpec at run time
  ownerId: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  nodeRuns: Map<string, INodeRun>;
  // Child-run lineage (Phase 7.2 spawned child graphs). Set when a run is created
  // for a spawned child graph via runs.createChild; all optional + additive so
  // normal runs are unaffected.
  parentGraphId?: string;
  parentRunId?: string;
  parentNodeIds?: string[];
  childGraphId?: string;
  childRunId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const NodeRunEventSchema = new Schema<INodeRunEvent>(
  {
    ts: { type: String, required: true },
    level: { type: String, enum: EVENT_LEVELS, required: true },
    payload: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const NodeRunSchema = new Schema<INodeRun>(
  {
    nodeId: { type: String, required: true },
    status: { type: String, default: "pending" },
    attempt: { type: Number, default: 0 },
    startedAt: String,
    finishedAt: String,
    cli: String,
    worktreePath: String,
    branchName: String,
    baseRef: String,
    resolvedPersona: {
      id: String,
      version: String,
      sha: String,
    },
    resolvedPromptSha: String,
    events: { type: [NodeRunEventSchema], default: [] },
    outputs: { type: Schema.Types.Mixed },
    patch: String,
    error: {
      code: String,
      message: String,
      stack: String,
    },
  },
  { _id: false },
);

const RunSchema = new Schema<IRun>(
  {
    graphId: { type: String, required: true, index: true },
    graphSnapshot: { type: Schema.Types.Mixed, required: true },
    ownerId: { type: String, required: true, index: true },
    status: { type: String, default: "running" },
    startedAt: String,
    finishedAt: String,
    // Keyed by nodeId. Default is a factory so each doc gets its own Map.
    nodeRuns: { type: Map, of: NodeRunSchema, default: () => new Map() },
    // Child-run lineage (Phase 7.2). Indexed where queried by parent.
    parentGraphId: { type: String, index: true },
    parentRunId: String,
    parentNodeIds: { type: [String], default: undefined },
    childGraphId: String,
    childRunId: String,
  },
  { timestamps: true },
);

RunSchema.index({ ownerId: 1, createdAt: -1 });
RunSchema.index({ graphId: 1, createdAt: -1 });

export const RunModel: Model<IRun> =
  (models.Run as Model<IRun>) ?? model<IRun>("Run", RunSchema);
