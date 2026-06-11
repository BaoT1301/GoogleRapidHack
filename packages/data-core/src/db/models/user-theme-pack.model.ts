import { Schema, model, models, type Model } from "mongoose";

/**
 * A user-authored custom theme pack. The doc `_id` (ulid) IS the pack id, so it
 * never collides with the built-in ids ("classic"/"aurora"/"pixel"). The full
 * (zod-validated) ThemePack object is stored in `pack`; `pack.id` is kept equal
 * to `_id` and `pack.name` equal to `name` by the router on every write.
 */
export interface IUserThemePack {
  _id: string; // ulid (= pack id)
  ownerId: string;
  name: string;
  pack: Record<string, unknown>; // a validated ThemePack
  createdAt: Date;
  updatedAt: Date;
}

const UserThemePackSchema = new Schema<IUserThemePack>(
  {
    _id: { type: String, required: true }, // ulid, not ObjectId
    ownerId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    pack: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, _id: false },
);

// Owner's packs, most-recently-updated first.
UserThemePackSchema.index({ ownerId: 1, updatedAt: -1 });

export const UserThemePackModel: Model<IUserThemePack> =
  (models.UserThemePack as Model<IUserThemePack>) ??
  model<IUserThemePack>("UserThemePack", UserThemePackSchema);
