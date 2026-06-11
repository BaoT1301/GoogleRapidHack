// RunGateway (orchestrator side). Shared types + Mongo impl live in @repo/data-core;
// here we add the BFF-forwarding variant (svc.runs, service token) + the selector.
// auth-bff uses the data-core Mongo gateway directly and never imports this file.
import {
  mongoRunGateway,
  type RunGateway,
  type RunRecord,
  type RunEventInput,
} from "@repo/data-core/gateways/run-gateway";

export {
  MongoRunGateway,
  mongoRunGateway,
} from "@repo/data-core/gateways/run-gateway";
export type { RunGateway, RunRecord, RunEventInput } from "@repo/data-core/gateways/run-gateway";

/** BFF implementation (BFF_URL set) — forwards to the BFF `svc.runs.*` (run token). */
export class BffRunGateway implements RunGateway {
  private clientPromise: Promise<import("../../bff/client").BffClient>;

  constructor(baseUrl: string, token: import("../../bff/client").ServiceTokenSource) {
    this.clientPromise = import("../../bff/client").then(({ createBffServiceClient }) =>
      createBffServiceClient(baseUrl, token),
    );
  }

  async create(ownerId: string, graphId: string): Promise<RunRecord | null> {
    const c = await this.clientPromise;
    return (await c.svc.runs.create.mutate({ ownerId, graphId })) as RunRecord | null;
  }
  async createChild(
    ownerId: string,
    childGraphId: string,
    meta: { parentRunId?: string; parentNodeIds?: string[] },
  ): Promise<RunRecord | null> {
    const c = await this.clientPromise;
    return (await c.svc.runs.createChild.mutate({
      ownerId,
      childGraphId,
      parentRunId: meta.parentRunId,
      parentNodeIds: meta.parentNodeIds,
    })) as RunRecord | null;
  }
  async getById(ownerId: string, runId: string): Promise<RunRecord | null> {
    const c = await this.clientPromise;
    return (await c.svc.runs.getById.query({ ownerId, runId })) as RunRecord | null;
  }
  async listForGraph(ownerId: string, graphId: string, limit: number): Promise<RunRecord[]> {
    const c = await this.clientPromise;
    return (await c.svc.runs.listForGraph.query({ ownerId, graphId, limit })) as RunRecord[];
  }
  async updateStatus(ownerId: string, runId: string, status: string, finishedAt?: string): Promise<RunRecord | null> {
    const c = await this.clientPromise;
    return (await c.svc.runs.updateStatus.mutate({ ownerId, runId, status, finishedAt })) as RunRecord | null;
  }
  async setNodeRun(ownerId: string, runId: string, nodeId: string, nodeRun: unknown): Promise<boolean> {
    const c = await this.clientPromise;
    return (await c.svc.runs.setNodeRun.mutate({ ownerId, runId, nodeId, nodeRun })).ok;
  }
  async patchNodeRun(ownerId: string, runId: string, nodeId: string, fields: Record<string, unknown>): Promise<boolean> {
    const c = await this.clientPromise;
    return (await c.svc.runs.patchNodeRun.mutate({ ownerId, runId, nodeId, fields })).ok;
  }
  async appendEventsBatch(ownerId: string, runId: string, nodeId: string, events: RunEventInput[]): Promise<number> {
    const c = await this.clientPromise;
    return (await c.svc.runs.appendEventsBatch.mutate({ ownerId, runId, nodeId, events })).appended;
  }
}

/**
 * Pick the runs backend. BFF mode (BFF_URL set) uses the trusted svc path with a
 * per-user run token resolved per request (legacy shared token as fallback) — see
 * auth-bff-api.md §10. No BFF_URL → direct Mongo (shipped behavior).
 */
export function getRunGateway(): RunGateway {
  const bffUrl = process.env.BFF_URL;
  if (bffUrl) {
    return new BffRunGateway(bffUrl, async () => {
      const { resolveServiceToken } = await import("../../bff/service-auth");
      return resolveServiceToken();
    });
  }
  return mongoRunGateway;
}
