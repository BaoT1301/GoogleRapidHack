// SettingsGateway (orchestrator side). Shared types + Mongo impl (incl. per-CLI
// normalization) live in @repo/data-core; here we add the BFF variant + the selector.
import {
  mongoSettingsGateway,
  type SettingsGateway,
  type SettingsValue,
  type SettingsUpdateInput,
} from "@repo/data-core/gateways/settings-gateway";

export {
  MongoSettingsGateway,
  mongoSettingsGateway,
} from "@repo/data-core/gateways/settings-gateway";
export type {
  SettingsGateway,
  SettingsValue,
  SettingsUpdateInput,
} from "@repo/data-core/gateways/settings-gateway";

/** BFF implementation (BFF_URL set) — forwards to the cloud BFF, carrying the token. */
export class BffSettingsGateway implements SettingsGateway {
  private clientPromise: Promise<import("../../bff/client").BffClient>;

  constructor(baseUrl: string, token: string | null) {
    this.clientPromise = import("../../bff/client").then(({ createBffClient }) =>
      createBffClient(baseUrl, token),
    );
  }

  async get(_ownerId: string): Promise<SettingsValue> {
    const c = await this.clientPromise;
    return (await c.data.settings.get.query()) as SettingsValue;
  }

  async update(_ownerId: string, input: SettingsUpdateInput): Promise<SettingsValue> {
    const c = await this.clientPromise;
    return (await c.data.settings.update.mutate(input)) as SettingsValue;
  }
}

/** Pick the settings backend for a request (BFF mode vs direct Mongo). */
export function getSettingsGateway(ctx: { token?: string | null }): SettingsGateway {
  const bffUrl = process.env.BFF_URL;
  if (bffUrl && ctx.token) return new BffSettingsGateway(bffUrl, ctx.token);
  return mongoSettingsGateway;
}
