// GraphGateway — persistence seam for the `graphs` domain (shared data-core).
//
// The Mongo implementation + the shared types/interfaces live here so BOTH the
// orchestrator and the standalone auth-bff service use the same data layer. The
// orchestrator adds the BFF-forwarding variants + selectors on top (it owns the BFF
// client); auth-bff uses `mongoGraphGateway` directly.
import { connectDB } from "../db/client";
import {
  GraphModel,
  type GraphStatus,
  type IEdgeSpec,
  type IGraph,
  type INodeSpec,
  type SupportedCli,
} from "../db/models/graph.model";

/** A graph as returned to callers — the lean doc with a string `_id`. */
export type GraphRecord = Omit<IGraph, "variables"> & {
  _id: string;
  variables?: Map<string, unknown> | Record<string, unknown>;
  [key: string]: unknown;
};

export interface GraphCreateInput {
  name: string;
  description?: string;
  rootRepoPath?: string;
  baseBranch?: string;
  cli?: SupportedCli;
}

/**
 * Fully-populated graph create — used by background/system paths that materialize a
 * graph WITH its nodes/edges and provenance (a plan sprint or a conflict-reviewer
 * child), not the empty `draft` shell `create` makes. Carries the PLAN-4 fields
 * (`planId`/`sprintNumber`/`sprintName`) and child-graph lineage
 * (`parentGraphId`/`parentNodeId`). See `GraphServiceGateway`.
 */
export interface GraphFullCreateInput {
  name: string;
  status?: GraphStatus;
  description?: string;
  rootRepoPath?: string;
  baseBranch?: string;
  cli?: SupportedCli;
  nodes?: INodeSpec[];
  edges?: IEdgeSpec[];
  planId?: string;
  sprintNumber?: number;
  sprintName?: string;
  parentGraphId?: string;
  parentNodeId?: string;
}

export interface GraphUpdateInput {
  name?: string;
  description?: string;
  rootRepoPath?: string;
  cli?: SupportedCli;
  nodes?: INodeSpec[];
  edges?: IEdgeSpec[];
  status?: GraphStatus;
}

export interface GraphGateway {
  list(ownerId: string): Promise<GraphRecord[]>;
  getById(ownerId: string, id: string): Promise<GraphRecord | null>;
  create(ownerId: string, input: GraphCreateInput): Promise<GraphRecord>;
  update(
    ownerId: string,
    id: string,
    updates: GraphUpdateInput,
  ): Promise<GraphRecord | null>;
  delete(ownerId: string, id: string): Promise<boolean>;
}

/**
 * The SERVICE-token graph seam — the subset of graph ops reachable from background
 * code that has no user token (run execution: plan-sprint creation + conflict-reviewer
 * child graphs). `mongoGraphGateway` structurally satisfies this.
 */
export interface GraphServiceGateway {
  getById(ownerId: string, id: string): Promise<GraphRecord | null>;
  createFull(ownerId: string, input: GraphFullCreateInput): Promise<GraphRecord>;
  findChildByParentNode(
    ownerId: string,
    parentGraphId: string,
    parentNodeId: string,
  ): Promise<GraphRecord | null>;
}

/** Normalize a lean/hydrated Mongo doc to a GraphRecord (string `_id`). */
function toRecord(doc: unknown): GraphRecord | null {
  if (!doc) return null;
  const d = doc as Record<string, unknown>;
  return { ...d, _id: String(d._id) } as GraphRecord;
}

/**
 * Direct-Mongo implementation — the shipped behavior. Every query is scoped by
 * `ownerId` (manual tenant isolation, ADR AD-3), exactly as the router did.
 */
export class MongoGraphGateway implements GraphGateway, GraphServiceGateway {
  async list(ownerId: string): Promise<GraphRecord[]> {
    await connectDB();
    const docs = await GraphModel.find({ ownerId }).sort({ updatedAt: -1 }).lean();
    return docs.map((d) => toRecord(d)!);
  }

  async getById(ownerId: string, id: string): Promise<GraphRecord | null> {
    await connectDB();
    const doc = await GraphModel.findOne({ _id: id, ownerId }).lean();
    return toRecord(doc);
  }

  async create(ownerId: string, input: GraphCreateInput): Promise<GraphRecord> {
    await connectDB();
    const graph = await GraphModel.create({
      ...input,
      ownerId,
      nodes: [],
      edges: [],
      status: "draft",
    });
    return toRecord(graph.toObject())!;
  }

  async update(
    ownerId: string,
    id: string,
    updates: GraphUpdateInput,
  ): Promise<GraphRecord | null> {
    await connectDB();
    const doc = await GraphModel.findOneAndUpdate(
      { _id: id, ownerId },
      { $set: updates },
      { new: true },
    ).lean();
    return toRecord(doc);
  }

  async delete(ownerId: string, id: string): Promise<boolean> {
    await connectDB();
    const res = await GraphModel.deleteOne({ _id: id, ownerId });
    return res.deletedCount === 1;
  }

  // ── Service-path methods (GraphServiceGateway) ──
  async createFull(ownerId: string, input: GraphFullCreateInput): Promise<GraphRecord> {
    await connectDB();
    const graph = await GraphModel.create({
      ...input,
      ownerId,
      nodes: input.nodes ?? [],
      edges: input.edges ?? [],
      status: input.status ?? "draft",
    });
    return toRecord(graph.toObject())!;
  }

  async findChildByParentNode(
    ownerId: string,
    parentGraphId: string,
    parentNodeId: string,
  ): Promise<GraphRecord | null> {
    await connectDB();
    const doc = await GraphModel.findOne({ ownerId, parentGraphId, parentNodeId }).lean();
    return toRecord(doc);
  }
}

export const mongoGraphGateway = new MongoGraphGateway();
