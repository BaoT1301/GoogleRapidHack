// AssetGateway (orchestrator side). Shared types + Mongo impl + validation policy
// live in @repo/data-core; here we add the BFF variant + the selector. The BFF
// auto-scopes on ctx.userId, so `ownerId` is ignored at the wire (the cloud
// derives it). Mirrors template-gateway.ts byte-for-byte.
//
// NOTE: `getBytesForOwner` is server-internal and only ever called inside the
// orchestrator's `/api/assets/[id]` proxy when BFF mode is OFF. In BFF mode, the
// proxy issues a plain HTTP fetch to `${BFF_URL}/assets/:id/bytes` directly — it
// never goes through the gateway abstraction (this method intentionally throws).
import type {
  AssetBytes,
  AssetCreateInput,
  AssetGateway,
  AssetMeta,
} from "@repo/data-core/gateways/asset-gateway";
import { mongoAssetGateway } from "@repo/data-core/gateways/asset-gateway";

export {
  ALLOWED_ASSET_TYPES,
  MAX_ASSET_BYTES,
  MongoAssetGateway,
  assetCapabilityUrl,
  isAllowedAssetType,
  mongoAssetGateway,
  validateAsset,
} from "@repo/data-core/gateways/asset-gateway";
export type {
  AssetBytes,
  AssetContentType,
  AssetCreateInput,
  AssetGateway,
  AssetMeta,
  AssetValidationInput,
  AssetValidationResult,
} from "@repo/data-core/gateways/asset-gateway";

/** BFF implementation (BFF_URL set) — forwards CRUD to the cloud BFF, carrying the token. */
export class BffAssetGateway implements AssetGateway {
  private clientPromise: Promise<import("../../bff/client").BffClient>;

  constructor(baseUrl: string, token: string | null) {
    this.clientPromise = import("../../bff/client").then(({ createBffClient }) =>
      createBffClient(baseUrl, token),
    );
  }

  async list(_ownerId: string): Promise<AssetMeta[]> {
    const c = await this.clientPromise;
    return (await c.data.assets.list.query()) as AssetMeta[];
  }
  async get(_ownerId: string, id: string): Promise<AssetMeta> {
    const c = await this.clientPromise;
    return (await c.data.assets.get.query({ id })) as AssetMeta;
  }
  async create(_ownerId: string, input: AssetCreateInput): Promise<AssetMeta> {
    const c = await this.clientPromise;
    // The BFF accepts base64 over the wire (sprite-sized payloads).
    return (await c.data.assets.upload.mutate({
      name: input.name,
      contentType: input.contentType as
        | "image/png"
        | "image/jpeg"
        | "image/gif"
        | "image/webp"
        | "image/svg+xml",
      dataBase64: input.bytes.toString("base64"),
      pixelated: input.pixelated,
      width: input.width,
      height: input.height,
    })) as AssetMeta;
  }
  async remove(_ownerId: string, id: string): Promise<{ deleted: boolean }> {
    const c = await this.clientPromise;
    return (await c.data.assets.remove.mutate({ id })) as { deleted: boolean };
  }
  // Server-internal: not exposed via tRPC. The orchestrator's byte-route proxy
  // hits ${BFF_URL}/assets/:id/bytes directly in BFF mode (streaming-friendly).
  // This method is only here to satisfy the AssetGateway contract; calling it
  // through the BFF gateway is a programming error.
  async getBytesForOwner(): Promise<AssetBytes | null> {
    throw new Error(
      "BffAssetGateway.getBytesForOwner: bytes are streamed via the byte-route proxy, not the tRPC gateway",
    );
  }
}

/** Pick the assets backend for a request (BFF mode vs direct Mongo). */
export function getAssetGateway(ctx: { token?: string | null }): AssetGateway {
  const bffUrl = process.env.BFF_URL;
  if (bffUrl && ctx.token) return new BffAssetGateway(bffUrl, ctx.token);
  return mongoAssetGateway;
}
