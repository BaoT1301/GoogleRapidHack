// TemplateGateway (orchestrator side). Shared types + Mongo impl live in
// @repo/data-core; here we add the BFF variant + the selector.
import {
  mongoTemplateGateway,
  type TemplateGateway,
  type TemplateRecord,
  type TemplateSourceFilter,
  type TemplateCreateInput,
  type TemplateDuplicateInput,
} from "@repo/data-core/gateways/template-gateway";
import { type TemplateKind } from "@repo/data-core/db/models/template.model";

export {
  MongoTemplateGateway,
  mongoTemplateGateway,
} from "@repo/data-core/gateways/template-gateway";
export type {
  TemplateGateway,
  TemplateRecord,
  TemplateSourceFilter,
  TemplateCreateInput,
  TemplateDuplicateInput,
} from "@repo/data-core/gateways/template-gateway";

/** BFF implementation (BFF_URL set) — forwards to the cloud BFF, carrying the token. */
export class BffTemplateGateway implements TemplateGateway {
  private clientPromise: Promise<import("../../bff/client").BffClient>;

  constructor(baseUrl: string, token: string | null) {
    this.clientPromise = import("../../bff/client").then(({ createBffClient }) =>
      createBffClient(baseUrl, token),
    );
  }

  async list(_ownerId: string, kind?: TemplateKind): Promise<TemplateRecord[]> {
    const c = await this.clientPromise;
    return (await c.data.templates.list.query(kind ? { kind } : undefined)) as TemplateRecord[];
  }
  async getById(_ownerId: string, id: string, source?: TemplateSourceFilter): Promise<TemplateRecord> {
    const c = await this.clientPromise;
    return (await c.data.templates.getById.query({ id, source })) as TemplateRecord;
  }
  async fork(_ownerId: string, templateId: string): Promise<TemplateRecord> {
    const c = await this.clientPromise;
    return (await c.data.templates.fork.mutate({ templateId })) as TemplateRecord;
  }
  async create(_ownerId: string, input: TemplateCreateInput): Promise<TemplateRecord> {
    const c = await this.clientPromise;
    return (await c.data.templates.create.mutate(input)) as TemplateRecord;
  }
  async duplicate(_ownerId: string, input: TemplateDuplicateInput): Promise<TemplateRecord> {
    const c = await this.clientPromise;
    return (await c.data.templates.duplicate.mutate(input)) as TemplateRecord;
  }
  async update(_ownerId: string, id: string, content: string): Promise<TemplateRecord> {
    const c = await this.clientPromise;
    return (await c.data.templates.update.mutate({ id, content })) as TemplateRecord;
  }
  async delete(_ownerId: string, id: string, kind: TemplateKind) {
    const c = await this.clientPromise;
    return (await c.data.templates.delete.mutate({ id, kind })) as {
      id: string;
      kind: TemplateKind;
      deleted: true;
    };
  }
  async getWorkspaceFork(_ownerId: string, id: string, kind: TemplateKind): Promise<TemplateRecord | null> {
    const c = await this.clientPromise;
    return (await c.data.templates.getWorkspaceFork.query({ id, kind })) as TemplateRecord | null;
  }
}

/** Pick the templates backend for a request (BFF mode vs direct Mongo). */
export function getTemplateGateway(ctx: { token?: string | null }): TemplateGateway {
  const bffUrl = process.env.BFF_URL;
  if (bffUrl && ctx.token) return new BffTemplateGateway(bffUrl, ctx.token);
  return mongoTemplateGateway;
}
