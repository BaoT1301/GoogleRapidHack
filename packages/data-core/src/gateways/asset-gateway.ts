// AssetGateway — persistence seam for user-imported canvas assets (shared
// data-core). Mongo impl lives here so both the orchestrator and the auth-bff
// service share it; the orchestrator adds the BFF-forwarding variant + selector.
//
// Bytes are decoded on upload and stored as a Mongo Buffer. `list`/`get`/`create`
// return METADATA only (incl. a capability URL the canvas uses); raw bytes are
// served by `getBytesForOwner`, which the BFF exposes over a sibling HTTP route
// (GET /assets/:id/bytes) so the canvas can `<img src>` them via the orchestrator's
// token-forwarding proxy without ever shipping a service secret to the browser.
//
// Validation policy + the capability URL helper live in `./asset-policy` (a pure
// module, NO Mongoose / DB imports) so the canvas Settings panel can import them
// without dragging mongoose into the browser bundle. We re-export them here for
// convenience on the server side.
import { TRPCError } from "@trpc/server";
import { ulid } from "ulid";
import { connectDB } from "../db/client";
import {
  CanvasAssetModel,
  type ICanvasAsset,
} from "../db/models/canvas-asset.model";
import { assetCapabilityUrl } from "./asset-policy";
import {
  assetStorageKey,
  getAssetStorage,
} from "../storage/asset-storage";

export {
  ALLOWED_ASSET_TYPES,
  MAX_ASSET_BYTES,
  assetCapabilityUrl,
  isAllowedAssetType,
  validateAsset,
} from "./asset-policy";
export type {
  AssetContentType,
  AssetValidationInput,
  AssetValidationResult,
} from "./asset-policy";

export interface AssetMeta {
  id: string;
  name: string;
  contentType: string;
  size: number;
  pixelated?: boolean;
  width?: number;
  height?: number;
  /** Capability URL the canvas uses to load bytes (always orchestrator-side). */
  url: string;
  createdAt: Date;
}

export interface AssetCreateInput {
  name: string;
  contentType: string;
  /** Already-validated decoded bytes (router enforces the size/type policy). */
  bytes: Buffer;
  pixelated?: boolean;
  width?: number;
  height?: number;
}

export interface AssetBytes {
  contentType: string;
  size: number;
  bytes: Buffer;
}

export interface AssetGateway {
  list(ownerId: string): Promise<AssetMeta[]>;
  get(ownerId: string, id: string): Promise<AssetMeta>;
  create(ownerId: string, input: AssetCreateInput): Promise<AssetMeta>;
  remove(ownerId: string, id: string): Promise<{ deleted: boolean }>;
  /**
   * Server-internal: fetch raw bytes for the BFF byte route. Owner-scoped, so a
   * forged id from another user yields null, not the bytes. Never exposed via tRPC.
   */
  getBytesForOwner(ownerId: string, id: string): Promise<AssetBytes | null>;
}

function toMeta(doc: {
  _id: string;
  name: string;
  contentType: string;
  size: number;
  pixelated?: boolean;
  width?: number;
  height?: number;
  createdAt: Date;
}): AssetMeta {
  return {
    id: doc._id,
    name: doc.name,
    contentType: doc.contentType,
    size: doc.size,
    pixelated: doc.pixelated,
    width: doc.width,
    height: doc.height,
    url: assetCapabilityUrl(doc._id),
    createdAt: doc.createdAt,
  };
}

/** Direct-Mongo implementation — the shipped behavior. */
export class MongoAssetGateway implements AssetGateway {
  async list(ownerId: string): Promise<AssetMeta[]> {
    await connectDB();
    const docs = await CanvasAssetModel.find({ ownerId })
      .select("-data") // never ship bytes in the list
      .sort({ createdAt: -1 })
      .lean();
    return docs.map((d) => toMeta(d as unknown as Parameters<typeof toMeta>[0]));
  }

  async get(ownerId: string, id: string): Promise<AssetMeta> {
    await connectDB();
    const doc = await CanvasAssetModel.findOne({ _id: id, ownerId })
      .select("-data")
      .lean();
    if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
    return toMeta(doc as unknown as Parameters<typeof toMeta>[0]);
  }

  async create(ownerId: string, input: AssetCreateInput): Promise<AssetMeta> {
    await connectDB();
    const id = ulid();
    // Bytes → GCS (object store); Mongo keeps metadata only. Put bytes first so a
    // metadata row never points at a missing object.
    await getAssetStorage().put({
      key: assetStorageKey(ownerId, id),
      contentType: input.contentType,
      bytes: input.bytes,
    });
    const doc = await CanvasAssetModel.create({
      _id: id,
      ownerId,
      name: input.name,
      contentType: input.contentType,
      size: input.bytes.length,
      pixelated: input.pixelated,
      width: input.width,
      height: input.height,
    } satisfies Pick<
      ICanvasAsset,
      "_id" | "ownerId" | "name" | "contentType" | "size"
    > &
      Partial<Pick<ICanvasAsset, "pixelated" | "width" | "height">>);
    return toMeta(doc.toObject() as unknown as Parameters<typeof toMeta>[0]);
  }

  async remove(ownerId: string, id: string): Promise<{ deleted: boolean }> {
    await connectDB();
    const res = await CanvasAssetModel.deleteOne({ _id: id, ownerId });
    if (res.deletedCount === 1) {
      // Best-effort byte cleanup; the metadata row is already gone (the source of
      // truth for ownership), so a stray object is harmless.
      await getAssetStorage().delete(assetStorageKey(ownerId, id));
    }
    return { deleted: res.deletedCount === 1 };
  }

  async getBytesForOwner(ownerId: string, id: string): Promise<AssetBytes | null> {
    await connectDB();
    // Owner-scoped metadata lookup is the authorization gate — a forged id from
    // another user finds no row and yields null.
    const doc = await CanvasAssetModel.findOne({ _id: id, ownerId }).lean();
    if (!doc) return null;
    // Bytes live in GCS; legacy (pre-migration) assets may still carry an inline
    // Mongo Buffer — fall back to it so old assets keep loading.
    const fromGcs = await getAssetStorage().get(assetStorageKey(ownerId, id));
    const bytes = fromGcs ?? (doc.data as unknown as Buffer | undefined) ?? null;
    if (!bytes) return null;
    return { contentType: doc.contentType, size: doc.size, bytes };
  }
}

export const mongoAssetGateway = new MongoAssetGateway();
