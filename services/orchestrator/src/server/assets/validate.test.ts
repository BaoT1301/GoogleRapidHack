import { describe, it, expect } from "vitest";
import {
  validateAsset,
  isAllowedAssetType,
  assetUrl,
  MAX_ASSET_BYTES,
} from "./validate";

describe("validateAsset", () => {
  it("accepts a small png", () => {
    expect(validateAsset({ contentType: "image/png", size: 1024 })).toEqual({
      ok: true,
    });
  });

  it("rejects an unsupported type", () => {
    const r = validateAsset({ contentType: "application/zip", size: 10 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Unsupported/);
  });

  it("rejects an empty asset", () => {
    expect(validateAsset({ contentType: "image/png", size: 0 }).ok).toBe(false);
  });

  it("rejects an oversized asset", () => {
    const r = validateAsset({
      contentType: "image/png",
      size: MAX_ASSET_BYTES + 1,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/too large/);
  });

  it("isAllowedAssetType narrows known types", () => {
    expect(isAllowedAssetType("image/webp")).toBe(true);
    expect(isAllowedAssetType("image/tiff")).toBe(false);
  });

  it("builds a capability URL", () => {
    expect(assetUrl("abc123")).toBe("/api/assets/abc123");
  });
});
