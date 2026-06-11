// ProjectGateway (orchestrator side). Shared types + Mongo impl live in @repo/data-core;
// here we add the BFF-forwarding variant + the selector.
import {
  mongoProjectGateway,
  type ProjectGateway,
  type ProjectRecord,
  type ProjectCreateInput,
  type ProjectUpdateInput,
} from "@repo/data-core/gateways/project-gateway";

export {
  MongoProjectGateway,
  mongoProjectGateway,
} from "@repo/data-core/gateways/project-gateway";
export type {
  ProjectGateway,
  ProjectRecord,
  ProjectCreateInput,
  ProjectUpdateInput,
} from "@repo/data-core/gateways/project-gateway";

/** BFF implementation (BFF_URL set) — forwards to the cloud BFF, carrying the token. */
export class BffProjectGateway implements ProjectGateway {
  private clientPromise: Promise<import("../../bff/client").BffClient>;

  constructor(baseUrl: string, token: string | null) {
    this.clientPromise = import("../../bff/client").then(({ createBffClient }) =>
      createBffClient(baseUrl, token),
    );
  }

  async list(_ownerId: string): Promise<ProjectRecord[]> {
    const c = await this.clientPromise;
    return (await c.data.projects.list.query()) as ProjectRecord[];
  }
  async get(_ownerId: string, projectId: string): Promise<ProjectRecord | null> {
    const c = await this.clientPromise;
    return (await c.data.projects.get.query({ projectId })) as ProjectRecord | null;
  }
  async create(_ownerId: string, input: ProjectCreateInput): Promise<ProjectRecord> {
    const c = await this.clientPromise;
    return (await c.data.projects.create.mutate(input)) as ProjectRecord;
  }
  async update(_ownerId: string, projectId: string, updates: ProjectUpdateInput): Promise<ProjectRecord | null> {
    const c = await this.clientPromise;
    return (await c.data.projects.update.mutate({ projectId, ...updates })) as ProjectRecord | null;
  }
  async delete(_ownerId: string, projectId: string): Promise<boolean> {
    const c = await this.clientPromise;
    const res = await c.data.projects.delete.mutate({ projectId });
    return res.success;
  }
}

/** Pick the projects backend for a request (BFF mode vs direct Mongo). */
export function getProjectGateway(ctx: { token?: string | null }): ProjectGateway {
  const bffUrl = process.env.BFF_URL;
  if (bffUrl && ctx.token) return new BffProjectGateway(bffUrl, ctx.token);
  return mongoProjectGateway;
}
