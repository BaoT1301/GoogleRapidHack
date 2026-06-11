// RunGateway — persistence seam for the `runs` domain (shared data-core).
//
// The Mongo implementation + shared types live here so both the orchestrator and the
// auth-bff service share one data layer. Redaction happens at the persistence seam
// (regardless of caller) so secrets never land in stored events. The orchestrator adds
// the BFF-forwarding variant + selector (it owns the BFF client); auth-bff uses
// `mongoRunGateway` directly.
import { TRPCError } from "@trpc/server";
import { connectDB } from "../db/client";
import { RunModel } from "../db/models/run.model";
import { mongoGraphGateway } from "./graph-gateway";
import { redactSecrets } from "../runtime/secret-redaction";

export interface RunEventInput {
  ts: string;
  level: string;
  payload?: unknown;
}
export type RunRecord = Record<string, unknown> & { _id: string };

export interface RunGateway {
  create(ownerId: string, graphId: string): Promise<RunRecord | null>;
  /**
   * Create a run for a spawned CHILD graph (Phase 7.2). Snapshots the child graph,
   * stamps parent lineage + `childGraphId`, and sets `childRunId` to the new run's
   * own id. Validates (server-side, so it holds in BFF mode too) that the graph is a
   * spawned child and that any supplied `parentRunId` belongs to the owner + parent
   * graph. Returns null when the child graph is not found.
   */
  createChild(
    ownerId: string,
    childGraphId: string,
    meta: { parentRunId?: string; parentNodeIds?: string[] },
  ): Promise<RunRecord | null>;
  getById(ownerId: string, runId: string): Promise<RunRecord | null>;
  listForGraph(ownerId: string, graphId: string, limit: number): Promise<RunRecord[]>;
  updateStatus(ownerId: string, runId: string, status: string, finishedAt?: string): Promise<RunRecord | null>;
  /** Set/replace a node's run record (before appending events). */
  setNodeRun(ownerId: string, runId: string, nodeId: string, nodeRun: unknown): Promise<boolean>;
  /** Field-level patch of a node's run record (preserves events) — the runtime path. */
  patchNodeRun(ownerId: string, runId: string, nodeId: string, fields: Record<string, unknown>): Promise<boolean>;
  /** Append a BATCH of events to a node (redacts + auto-creates the nodeRun). */
  appendEventsBatch(ownerId: string, runId: string, nodeId: string, events: RunEventInput[]): Promise<number>;
}

function toRecord(doc: unknown): RunRecord | null {
  if (!doc) return null;
  const d = doc as Record<string, unknown>;
  return { ...d, _id: String(d._id) };
}

/** Direct-Mongo implementation — the shipped behavior. */
export class MongoRunGateway implements RunGateway {
  async create(ownerId: string, graphId: string): Promise<RunRecord | null> {
    await connectDB();
    const graph = await mongoGraphGateway.getById(ownerId, graphId);
    if (!graph) return null;
    const run = await RunModel.create({
      graphId,
      ownerId,
      graphSnapshot: graph,
      status: "running",
      startedAt: new Date().toISOString(),
      nodeRuns: new Map(),
    });
    return toRecord(run.toObject());
  }

  async createChild(
    ownerId: string,
    childGraphId: string,
    meta: { parentRunId?: string; parentNodeIds?: string[] },
  ): Promise<RunRecord | null> {
    await connectDB();
    const graph = await mongoGraphGateway.getById(ownerId, childGraphId);
    if (!graph) return null;

    const parentGraphId = graph.parentGraphId as string | undefined;
    const parentNodeId = graph.parentNodeId as string | undefined;
    if (!parentGraphId || !parentNodeId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Graph is not a spawned child graph",
      });
    }

    // Validate the supplied parent run belongs to this owner + parent graph.
    if (meta.parentRunId) {
      const parentRun = await RunModel.findOne({
        _id: meta.parentRunId,
        ownerId,
        graphId: parentGraphId,
      })
        .select("_id")
        .lean();
      if (!parentRun) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Parent run not found" });
      }
    }

    const parentNodeIds =
      meta.parentNodeIds && meta.parentNodeIds.length > 0
        ? meta.parentNodeIds
        : [parentNodeId];

    const run = await RunModel.create({
      graphId: String(graph._id),
      ownerId,
      graphSnapshot: graph,
      status: "running",
      startedAt: new Date().toISOString(),
      nodeRuns: new Map(),
      parentGraphId,
      parentRunId: meta.parentRunId,
      parentNodeIds,
      childGraphId: String(graph._id),
    });
    const runId = String(run._id);
    // childRunId is the run's own id — settable only after creation.
    await RunModel.updateOne({ _id: runId, ownerId }, { $set: { childRunId: runId } });
    return toRecord({ ...run.toObject(), childRunId: runId });
  }

  async getById(ownerId: string, runId: string): Promise<RunRecord | null> {
    await connectDB();
    return toRecord(await RunModel.findOne({ _id: runId, ownerId }).lean());
  }

  async listForGraph(ownerId: string, graphId: string, limit: number): Promise<RunRecord[]> {
    await connectDB();
    const docs = await RunModel.find({ graphId, ownerId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return docs.map((d) => toRecord(d)!);
  }

  async updateStatus(ownerId: string, runId: string, status: string, finishedAt?: string): Promise<RunRecord | null> {
    await connectDB();
    const doc = await RunModel.findOneAndUpdate(
      { _id: runId, ownerId },
      { $set: { status, ...(finishedAt ? { finishedAt } : {}) } },
      { new: true },
    ).lean();
    return toRecord(doc);
  }

  async setNodeRun(ownerId: string, runId: string, nodeId: string, nodeRun: unknown): Promise<boolean> {
    await connectDB();
    const res = await RunModel.updateOne(
      { _id: runId, ownerId },
      { $set: { [`nodeRuns.${nodeId}`]: nodeRun } },
    );
    return res.matchedCount > 0;
  }

  async patchNodeRun(ownerId: string, runId: string, nodeId: string, fields: Record<string, unknown>): Promise<boolean> {
    await connectDB();
    if (Object.keys(fields).length === 0) return true;
    // Ensure the nodeRun exists, then field-level $set (preserves events).
    await RunModel.updateOne(
      { _id: runId, ownerId, [`nodeRuns.${nodeId}`]: { $exists: false } },
      { $set: { [`nodeRuns.${nodeId}`]: { nodeId, status: "pending", attempt: 0, events: [] } } },
    );
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) set[`nodeRuns.${nodeId}.${k}`] = v;
    const res = await RunModel.updateOne({ _id: runId, ownerId }, { $set: set });
    return res.matchedCount > 0;
  }

  async appendEventsBatch(ownerId: string, runId: string, nodeId: string, events: RunEventInput[]): Promise<number> {
    await connectDB();
    // Scrub secrets at the persistence seam (SEC-2) regardless of caller.
    const safe = events.map((e) => redactSecrets(e));
    const res = await RunModel.updateOne(
      { _id: runId, ownerId },
      { $push: { [`nodeRuns.${nodeId}.events`]: { $each: safe } } },
    );
    if (res.matchedCount === 0) throw new TRPCError({ code: "NOT_FOUND" });
    // $push into a missing Map path is a no-op — auto-create the nodeRun.
    if (res.modifiedCount === 0) {
      await RunModel.updateOne(
        { _id: runId, ownerId },
        { $set: { [`nodeRuns.${nodeId}`]: { nodeId, status: "running", attempt: 0, events: safe } } },
      );
    }
    return safe.length;
  }
}

export const mongoRunGateway = new MongoRunGateway();
