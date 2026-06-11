import { Schema, model, models, type Model } from "mongoose";

/**
 * User-imported canvas asset (theme-pack sprites, background images, status
 * overlays). Stored owner-scoped in Mongo as a decoded binary buffer — assets
 * are small (pixel-art sprites / tiles), so a single doc is simpler than GridFS
 * and avoids any filesystem-write assumptions in the standalone build.
 *
 * The raw bytes are served by the `/api/assets/[id]` route handler (capability
 * URL — the ulid id is unguessable). Upload/list/delete are authed + owner
 * scoped. No secrets are ever stored here.
 */
export interface ICanvasAsset {
  _id: string; // ulid
  ownerId: string;
  name: string;
  contentType: string;
  size: number; // bytes
  /**
   * Legacy inline bytes. New assets store bytes in GCS (object store) and leave
   * this unset; kept optional so pre-migration documents still read.
   */
  data?: Buffer;
  pixelated?: boolean;
  width?: number;
  height?: number;
  createdAt: Date;
  updatedAt: Date;
}

const CanvasAssetSchema = new Schema<ICanvasAsset>(
  {
    _id: { type: String, required: true }, // ulid (not ObjectId)
    ownerId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: false }, // legacy inline bytes; GCS is authoritative
    pixelated: { type: Boolean },
    width: { type: Number },
    height: { type: Number },
  },
  { timestamps: true, _id: false },
);

// Owner's assets, most-recently-created first.
CanvasAssetSchema.index({ ownerId: 1, createdAt: -1 });

export const CanvasAssetModel: Model<ICanvasAsset> =
  (models.CanvasAsset as Model<ICanvasAsset>) ??
  model<ICanvasAsset>("CanvasAsset", CanvasAssetSchema);
