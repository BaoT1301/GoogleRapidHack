// ThemePackGateway (orchestrator side). Shared types + Mongo impl live in
// @repo/data-core; here we add the BFF variant + the selector. The BFF auth-scopes
// every procedure on the verified ctx.userId, so `ownerId` is ignored (the cloud
// derives it). Mirrors template-gateway.ts byte-for-byte.
import {
  mongoThemePackGateway,
  type StoredThemePack,
  type ThemePackGateway,
} from "@repo/data-core/gateways/theme-pack-gateway";

export {
  MongoThemePackGateway,
  mongoThemePackGateway,
} from "@repo/data-core/gateways/theme-pack-gateway";
export type {
  StoredThemePack,
  ThemePackGateway,
} from "@repo/data-core/gateways/theme-pack-gateway";

/** BFF implementation (BFF_URL set) — forwards CRUD to the cloud BFF, carrying the token. */
export class BffThemePackGateway implements ThemePackGateway {
  private clientPromise: Promise<import("../../bff/client").BffClient>;

  constructor(baseUrl: string, token: string | null) {
    this.clientPromise = import("../../bff/client").then(({ createBffClient }) =>
      createBffClient(baseUrl, token),
    );
  }

  async list(_ownerId: string): Promise<StoredThemePack[]> {
    const c = await this.clientPromise;
    return (await c.data.themePacks.list.query()) as StoredThemePack[];
  }
  async get(_ownerId: string, id: string): Promise<StoredThemePack> {
    const c = await this.clientPromise;
    return (await c.data.themePacks.get.query({ id })) as StoredThemePack;
  }
  async create(
    _ownerId: string,
    input: { name: string; pack: StoredThemePack },
  ): Promise<StoredThemePack> {
    const c = await this.clientPromise;
    return (await c.data.themePacks.create.mutate(input)) as StoredThemePack;
  }
  async update(
    _ownerId: string,
    id: string,
    updates: { name?: string; pack?: StoredThemePack },
  ): Promise<StoredThemePack> {
    const c = await this.clientPromise;
    return (await c.data.themePacks.update.mutate({
      id,
      ...updates,
    })) as StoredThemePack;
  }
  async remove(_ownerId: string, id: string): Promise<{ deleted: boolean }> {
    const c = await this.clientPromise;
    return (await c.data.themePacks.remove.mutate({ id })) as { deleted: boolean };
  }
}

/** Pick the themePacks backend for a request (BFF mode vs direct Mongo). */
export function getThemePackGateway(ctx: { token?: string | null }): ThemePackGateway {
  const bffUrl = process.env.BFF_URL;
  if (bffUrl && ctx.token) return new BffThemePackGateway(bffUrl, ctx.token);
  return mongoThemePackGateway;
}
