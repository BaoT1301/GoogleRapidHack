import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";
import { connectDB, disconnectDB } from "../../db/client";
import { CanvasAssetModel } from "../../db/models/canvas-asset.model";
import { MAX_ASSET_BYTES } from "../assets/validate";
import {
  FakeAssetStorage,
  __setAssetStorageForTest,
} from "@repo/data-core/storage/asset-storage";

// Integration test — requires local Mongo. Asset bytes go to GCS in prod; here we
// inject an in-memory fake so create/get-bytes/remove work without credentials.
const createCaller = createCallerFactory(appRouter);
const ME = "test_user_assets";
const OTHER = "test_user_assets_other";
const me = createCaller({ userId: ME });
const other = createCaller({ userId: OTHER });

// 1x1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeAll(async () => {
  __setAssetStorageForTest(new FakeAssetStorage());
  await connectDB();
  await CanvasAssetModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
});

afterAll(async () => {
  __setAssetStorageForTest(null);
  await CanvasAssetModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await disconnectDB();
});

describe("assets router", () => {
  it("uploads → lists → gets an asset (round-trip) with a capability URL", async () => {
    const up = await me.assets.upload({
      name: "sprite.png",
      contentType: "image/png",
      dataBase64: PNG_BASE64,
      pixelated: true,
    });
    expect(up.id).toBeTruthy();
    expect(up.url).toBe(`/api/assets/${up.id}`);
    expect(up.size).toBeGreaterThan(0);
    expect(up.pixelated).toBe(true);

    const list = await me.assets.list();
    expect(list.some((a) => a.id === up.id)).toBe(true);
    // List never ships the raw bytes.
    expect((list[0] as unknown as Record<string, unknown>).data).toBeUndefined();

    const got = await me.assets.get({ id: up.id });
    expect(got.name).toBe("sprite.png");
    expect(got.contentType).toBe("image/png");
  });

  it("rejects an oversized asset", async () => {
    const big = Buffer.alloc(MAX_ASSET_BYTES + 32).toString("base64");
    await expect(
      me.assets.upload({
        name: "huge.png",
        contentType: "image/png",
        dataBase64: big,
      }),
    ).rejects.toThrow(/too large/);
  });

  it("rejects an unsupported content type at the input boundary", async () => {
    // Bypass the compile-time enum to prove the zod enum rejects at runtime.
    const badInput = {
      name: "x.zip",
      contentType: "application/zip",
      dataBase64: PNG_BASE64,
    } as unknown as Parameters<typeof me.assets.upload>[0];
    await expect(me.assets.upload(badInput)).rejects.toThrow();
  });

  it("is owner-scoped — another user cannot get or list my asset", async () => {
    const up = await me.assets.upload({
      name: "mine.png",
      contentType: "image/png",
      dataBase64: PNG_BASE64,
    });
    await expect(other.assets.get({ id: up.id })).rejects.toThrow();
    const theirList = await other.assets.list();
    expect(theirList.some((a) => a.id === up.id)).toBe(false);
  });

  it("removes an owned asset", async () => {
    const up = await me.assets.upload({
      name: "tmp.png",
      contentType: "image/png",
      dataBase64: PNG_BASE64,
    });
    const res = await me.assets.remove({ id: up.id });
    expect(res.deleted).toBe(true);
    await expect(me.assets.get({ id: up.id })).rejects.toThrow();
  });
});
