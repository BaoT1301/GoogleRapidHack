// ThemePackGateway — persistence seam for the user-authored canvas Theme Packs
// (shared data-core). Mongo impl lives here so both the orchestrator and the
// auth-bff service share it; the orchestrator adds the BFF-forwarding variant +
// selector. The router validates the candidate pack against the Theme Pack zod
// schema BEFORE calling the gateway, so this layer is purely persistence.
import { TRPCError } from "@trpc/server";
import { ulid } from "ulid";
import { connectDB } from "../db/client";
import {
  UserThemePackModel,
  type IUserThemePack,
} from "../db/models/user-theme-pack.model";

/** Stored pack — opaque to this layer (validated by the router before write). */
export type StoredThemePack = Record<string, unknown> & { id: string; name: string };

export interface ThemePackGateway {
  list(ownerId: string): Promise<StoredThemePack[]>;
  get(ownerId: string, id: string): Promise<StoredThemePack>;
  create(ownerId: string, input: { name: string; pack: StoredThemePack }): Promise<StoredThemePack>;
  /** Updates name and/or the (already-validated) pack. Returns the stored pack. */
  update(
    ownerId: string,
    id: string,
    updates: { name?: string; pack?: StoredThemePack },
  ): Promise<StoredThemePack>;
  remove(ownerId: string, id: string): Promise<{ deleted: boolean }>;
}

/** Direct-Mongo implementation — the shipped behavior. */
export class MongoThemePackGateway implements ThemePackGateway {
  async list(ownerId: string): Promise<StoredThemePack[]> {
    await connectDB();
    const docs = await UserThemePackModel.find({ ownerId })
      .sort({ updatedAt: -1 })
      .lean();
    return docs.map((d) => d.pack as unknown as StoredThemePack);
  }

  async get(ownerId: string, id: string): Promise<StoredThemePack> {
    await connectDB();
    const doc = await UserThemePackModel.findOne({ _id: id, ownerId }).lean();
    if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
    return doc.pack as unknown as StoredThemePack;
  }

  async create(
    ownerId: string,
    input: { name: string; pack: StoredThemePack },
  ): Promise<StoredThemePack> {
    await connectDB();
    // Server owns id + name (no spoofing / collisions with built-ins).
    const id = ulid();
    const stored: StoredThemePack = { ...input.pack, id, name: input.name };
    await UserThemePackModel.create({
      _id: id,
      ownerId,
      name: input.name,
      pack: stored,
    } satisfies Pick<IUserThemePack, "_id" | "ownerId" | "name" | "pack">);
    return stored;
  }

  async update(
    ownerId: string,
    id: string,
    updates: { name?: string; pack?: StoredThemePack },
  ): Promise<StoredThemePack> {
    await connectDB();
    const existing = await UserThemePackModel.findOne({ _id: id, ownerId }).lean();
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
    const name = updates.name ?? existing.name;
    const basePack =
      updates.pack ?? (existing.pack as unknown as StoredThemePack);
    const stored: StoredThemePack = { ...basePack, id, name };
    await UserThemePackModel.updateOne(
      { _id: id, ownerId },
      { $set: { name, pack: stored } },
    );
    return stored;
  }

  async remove(ownerId: string, id: string): Promise<{ deleted: boolean }> {
    await connectDB();
    const res = await UserThemePackModel.deleteOne({ _id: id, ownerId });
    return { deleted: res.deletedCount === 1 };
  }
}

export const mongoThemePackGateway = new MongoThemePackGateway();
