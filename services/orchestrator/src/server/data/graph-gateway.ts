// GraphGateway (orchestrator side). The shared types/interfaces + the Mongo impl live
// in @repo/data-core; here we add the BFF-forwarding variants (which need the BFF
// client) + the selectors that choose Mongo vs BFF per request. auth-bff uses the
// data-core Mongo gateway directly and never imports this file.
import {
  mongoGraphGateway,
  type GraphGateway,
  type GraphServiceGateway,
  type GraphRecord,
  type GraphCreateInput,
  type GraphFullCreateInput,
  type GraphUpdateInput,
} from "@repo/data-core/gateways/graph-gateway";

export {
  MongoGraphGateway,
  mongoGraphGateway,
} from "@repo/data-core/gateways/graph-gateway";
export type {
  GraphGateway,
  GraphServiceGateway,
  GraphRecord,
  GraphCreateInput,
  GraphFullCreateInput,
  GraphUpdateInput,
} from "@repo/data-core/gateways/graph-gateway";

/**
 * BFF implementation (BFF_URL set) — forwards graph CRUD to the cloud BFF over
 * tRPC, carrying the user's token. The BFF verifies the token and injects ownerId,
 * so `ownerId` here is ignored (the cloud derives it) — the local app holds no DB
 * secret. P0-full vertical slice (graphs). See auth-bff-api.md s4.
 */
export class BffGraphGateway implements GraphGateway {
  // Lazily build the typed BFF client (keeps @trpc/client off the Mongo path).
  private clientPromise: Promise<import("../../bff/client").BffClient>;

  constructor(baseUrl: string, token: string | null) {
    this.clientPromise = import("../../bff/client").then(({ createBffClient }) =>
      createBffClient(baseUrl, token),
    );
  }

  async list(_ownerId: string): Promise<GraphRecord[]> {
    const c = await this.clientPromise;
    return (await c.data.graphs.list.query()) as GraphRecord[];
  }

  async getById(_ownerId: string, id: string): Promise<GraphRecord | null> {
    const c = await this.clientPromise;
    return (await c.data.graphs.getById.query({ id })) as GraphRecord | null;
  }

  async create(_ownerId: string, input: GraphCreateInput): Promise<GraphRecord> {
    const c = await this.clientPromise;
    return (await c.data.graphs.create.mutate(input)) as GraphRecord;
  }

  async update(
    _ownerId: string,
    id: string,
    updates: GraphUpdateInput,
  ): Promise<GraphRecord | null> {
    const c = await this.clientPromise;
    return (await c.data.graphs.update.mutate({ id, ...updates })) as GraphRecord | null;
  }

  async delete(_ownerId: string, id: string): Promise<boolean> {
    const c = await this.clientPromise;
    const res = await c.data.graphs.delete.mutate({ id });
    return res.success;
  }
}

/**
 * Pick the graph persistence backend for a request. BFF mode (BFF_URL set + a
 * forwarded token) routes through the cloud BFF so the laptop holds no DB secret;
 * otherwise the default direct-Mongo gateway (shipped behavior, byte-for-byte).
 */
export function getGraphGateway(ctx: { token?: string | null }): GraphGateway {
  const bffUrl = process.env.BFF_URL;
  if (bffUrl && ctx.token) return new BffGraphGateway(bffUrl, ctx.token);
  return mongoGraphGateway;
}

/**
 * SERVICE-token graph backend — forwards over `svc.graphs` (explicit ownerId) so
 * background run code (plan-sprint creation, conflict-reviewer child graphs) reaches
 * Atlas without a user token. Mirrors `getRunGateway()`: BFF when BFF_URL is set (the
 * per-user run token is resolved per request via resolveServiceToken), else direct
 * Mongo (shipped behavior).
 */
export class BffGraphServiceGateway implements GraphServiceGateway {
  private clientPromise: Promise<import("../../bff/client").BffClient>;

  constructor(baseUrl: string, token: import("../../bff/client").ServiceTokenSource) {
    this.clientPromise = import("../../bff/client").then(({ createBffServiceClient }) =>
      createBffServiceClient(baseUrl, token),
    );
  }

  async getById(ownerId: string, id: string): Promise<GraphRecord | null> {
    const c = await this.clientPromise;
    return (await c.svc.graphs.getById.query({ ownerId, id })) as GraphRecord | null;
  }

  async createFull(ownerId: string, input: GraphFullCreateInput): Promise<GraphRecord> {
    const c = await this.clientPromise;
    return (await c.svc.graphs.createFull.mutate({ ownerId, ...input })) as GraphRecord;
  }

  async findChildByParentNode(
    ownerId: string,
    parentGraphId: string,
    parentNodeId: string,
  ): Promise<GraphRecord | null> {
    const c = await this.clientPromise;
    return (await c.svc.graphs.findChildByParentNode.query({
      ownerId,
      parentGraphId,
      parentNodeId,
    })) as GraphRecord | null;
  }
}

export function getGraphServiceGateway(): GraphServiceGateway {
  const bffUrl = process.env.BFF_URL;
  if (bffUrl) {
    return new BffGraphServiceGateway(bffUrl, async () => {
      const { resolveServiceToken } = await import("../../bff/service-auth");
      return resolveServiceToken();
    });
  }
  return mongoGraphGateway;
}
