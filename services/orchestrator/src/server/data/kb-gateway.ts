// KbGateway (orchestrator side). Shared types + Mongo impl live in @repo/data-core;
// here we add the BFF-forwarding variant + the selector.
import { TRPCError } from "@trpc/server";
import {
  mongoKbGateway,
  type KbGateway,
  type StoredKbDoc,
  type KbUpsertInput,
  type KbVectorHit,
} from "@repo/data-core/gateways/kb-gateway";

export {
  MongoKbGateway,
  mongoKbGateway,
  ensureKbVectorIndex,
} from "@repo/data-core/gateways/kb-gateway";
export type { KbGateway, StoredKbDoc, KbUpsertInput, KbVectorHit } from "@repo/data-core/gateways/kb-gateway";

/** BFF implementation (BFF_URL set) — forwards to the cloud BFF, carrying the token. */
export class BffKbGateway implements KbGateway {
  private clientPromise: Promise<import("../../bff/client").BffClient>;

  constructor(baseUrl: string, token: string | null) {
    this.clientPromise = import("../../bff/client").then(({ createBffClient }) =>
      createBffClient(baseUrl, token),
    );
  }

  async get(_ownerId: string, projectId: string): Promise<StoredKbDoc | null> {
    const c = await this.clientPromise;
    return (await c.data.kb.get.query({ projectId })) as StoredKbDoc | null;
  }
  async getMeta(_ownerId: string, projectId: string): Promise<{ repoSignature?: string } | null> {
    const c = await this.clientPromise;
    return (await c.data.kb.getMeta.query({ projectId })) as { repoSignature?: string } | null;
  }
  async upsert(_ownerId: string, projectId: string, input: KbUpsertInput): Promise<StoredKbDoc> {
    const c = await this.clientPromise;
    return (await c.data.kb.upsert.mutate({ projectId, ...input })) as StoredKbDoc;
  }
  async vectorSearch(
    _ownerId: string,
    projectId: string,
    queryVector: number[],
    k: number,
  ): Promise<KbVectorHit[]> {
    const c = await this.clientPromise;
    return (await c.data.kb.vectorSearch.query({ projectId, queryVector, k })) as KbVectorHit[];
  }
}

/**
 * Pick the KB backend for a request (BFF mode vs direct Mongo).
 *
 * In BFF mode (BFF_URL set), a token is REQUIRED: the BFF derives the owner from the
 * token, whereas direct Mongo would trust the caller-supplied ownerId. Silently
 * falling back to Mongo on a missing token would change the trust model (and, in a
 * cloud BFF topology, the orchestrator can't even reach Mongo), so we fail closed
 * with UNAUTHORIZED instead. Direct-Mongo mode (no BFF_URL) is unchanged.
 */
export function getKbGateway(ctx: { token?: string | null }): KbGateway {
  const bffUrl = process.env.BFF_URL;
  if (bffUrl) {
    if (!ctx.token) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "KB access requires an authenticated token in BFF mode",
      });
    }
    return new BffKbGateway(bffUrl, ctx.token);
  }
  return mongoKbGateway;
}
