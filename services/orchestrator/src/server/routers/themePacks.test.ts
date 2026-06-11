import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";
import { connectDB, disconnectDB } from "../../db/client";
import { UserThemePackModel } from "../../db/models/user-theme-pack.model";
import { buildCustomPack } from "../../lib/canvas-theme/custom";
import { classicPack } from "../../lib/canvas-theme/packs/classic";

// Integration test — requires local Mongo.
const createCaller = createCallerFactory(appRouter);
const ME = "test_user_themepacks";
const OTHER = "test_user_themepacks_other";
const me = createCaller({ userId: ME });
const other = createCaller({ userId: OTHER });

function draftPack(name: string) {
  return buildCustomPack(classicPack, {
    name,
    basePackId: "classic",
    renderMode: "pixel",
    kinds: { execute: { color: "#ff0000", assetUrl: "/api/assets/x", pixelated: true } },
    background: { kind: "lines" },
  });
}

beforeAll(async () => {
  await connectDB();
  await UserThemePackModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
});

afterAll(async () => {
  await UserThemePackModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await disconnectDB();
});

describe("themePacks router", () => {
  it("creates a pack, assigns a server id, and round-trips via list/get", async () => {
    const created = await me.themePacks.create({
      name: "My Pixel",
      pack: draftPack("ignored-name"),
    });
    expect(created.id).not.toBe("__draft__"); // server-assigned ulid
    expect(created.name).toBe("My Pixel"); // server owns the name
    expect(created.renderMode).toBe("pixel");

    const list = await me.themePacks.list();
    expect(list.some((p) => p.id === created.id)).toBe(true);

    const got = await me.themePacks.get({ id: created.id });
    expect(got.id).toBe(created.id);
    expect(got.kinds.execute.color).toBe("#ff0000");
  });

  it("rejects an invalid pack (missing a kind)", async () => {
    const broken = structuredClone(draftPack("Broken")) as Record<string, unknown>;
    delete (broken.kinds as Record<string, unknown>).loop;
    await expect(
      me.themePacks.create({ name: "Broken", pack: broken }),
    ).rejects.toThrow(/Invalid theme pack/);
  });

  it("updates name + pack and re-validates", async () => {
    const created = await me.themePacks.create({
      name: "Editable",
      pack: draftPack("Editable"),
    });
    const updated = await me.themePacks.update({
      id: created.id,
      name: "Renamed",
      pack: draftPack("whatever"),
    });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("Renamed");
    const got = await me.themePacks.get({ id: created.id });
    expect(got.name).toBe("Renamed");
  });

  it("is owner-scoped — another user can't get or list mine", async () => {
    const created = await me.themePacks.create({
      name: "Private",
      pack: draftPack("Private"),
    });
    await expect(other.themePacks.get({ id: created.id })).rejects.toThrow();
    const theirs = await other.themePacks.list();
    expect(theirs.some((p) => p.id === created.id)).toBe(false);
  });

  it("removes an owned pack", async () => {
    const created = await me.themePacks.create({
      name: "Temp",
      pack: draftPack("Temp"),
    });
    const res = await me.themePacks.remove({ id: created.id });
    expect(res.deleted).toBe(true);
    await expect(me.themePacks.get({ id: created.id })).rejects.toThrow();
  });
});
