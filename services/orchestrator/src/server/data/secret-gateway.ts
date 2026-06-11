// SecretGateway (orchestrator side). Shared types + Mongo impl live in @repo/data-core;
// here we add the BFF-forwarding variant (svc.secrets, service token) + the selector.
import {
  mongoSecretGateway,
  type SecretGateway,
  type SecretLabel,
} from "@repo/data-core/gateways/secret-gateway";

export {
  MongoSecretGateway,
  mongoSecretGateway,
} from "@repo/data-core/gateways/secret-gateway";
export type { SecretGateway, SecretLabel } from "@repo/data-core/gateways/secret-gateway";

/** BFF implementation (BFF_URL set) — forwards to the BFF `svc.secrets.*` (run token). */
export class BffSecretGateway implements SecretGateway {
  private clientPromise: Promise<import("../../bff/client").BffClient>;

  constructor(baseUrl: string, token: import("../../bff/client").ServiceTokenSource) {
    this.clientPromise = import("../../bff/client").then(({ createBffServiceClient }) =>
      createBffServiceClient(baseUrl, token),
    );
  }

  async list(ownerId: string): Promise<SecretLabel[]> {
    const c = await this.clientPromise;
    return (await c.svc.secrets.list.query({ ownerId })) as SecretLabel[];
  }
  async create(ownerId: string, label: string, value: string): Promise<{ id: string; label: string }> {
    const c = await this.clientPromise;
    // Plaintext travels to the BFF over TLS; the BFF holds the passphrase + encrypts.
    return (await c.svc.secrets.create.mutate({ ownerId, label, value })) as { id: string; label: string };
  }
  async delete(ownerId: string, id: string): Promise<boolean> {
    const c = await this.clientPromise;
    return (await c.svc.secrets.delete.mutate({ ownerId, id })).success;
  }
  async getValue(ownerId: string, secretId: string): Promise<string | null> {
    const c = await this.clientPromise;
    return (await c.svc.secrets.getValue.query({ ownerId, secretId })).value;
  }
}

/**
 * Pick the secrets backend. BFF mode (BFF_URL set) uses the trusted svc path with a
 * per-user run token resolved per request (the BFF holds the passphrase) — see
 * auth-bff-api.md §10. No BFF_URL → direct Mongo.
 */
export function getSecretGateway(): SecretGateway {
  const bffUrl = process.env.BFF_URL;
  if (bffUrl) {
    return new BffSecretGateway(bffUrl, async () => {
      const { resolveServiceToken } = await import("../../bff/service-auth");
      return resolveServiceToken();
    });
  }
  return mongoSecretGateway;
}
