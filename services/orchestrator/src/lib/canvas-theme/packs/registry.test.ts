import { describe, it, expect } from "vitest";
import {
  THEME_PACKS,
  getPack,
  listPacks,
  CLASSIC_PACK_ID,
  PIXEL_PACK_ID,
  AURORA_PACK_ID,
} from "../index";
import { safeParseThemePack } from "../schema";

describe("theme pack registry (Task 12)", () => {
  it("registers Classic, Pixel, and Aurora", () => {
    const ids = listPacks().map((p) => p.id);
    expect(ids).toContain(CLASSIC_PACK_ID);
    expect(ids).toContain(PIXEL_PACK_ID);
    expect(ids).toContain(AURORA_PACK_ID);
  });

  it("every registered pack re-validates against the schema", () => {
    for (const pack of Object.values(THEME_PACKS)) {
      expect(safeParseThemePack(pack).success).toBe(true);
    }
  });

  it("getPack resolves each id; unknown falls back to Classic", () => {
    expect(getPack(PIXEL_PACK_ID).id).toBe(PIXEL_PACK_ID);
    expect(getPack(AURORA_PACK_ID).id).toBe(AURORA_PACK_ID);
    expect(getPack("nope").id).toBe(CLASSIC_PACK_ID);
  });

  it("the Pixel pack is image/sprite based (renderMode pixel + assets + assetRefs)", () => {
    const pixel = getPack(PIXEL_PACK_ID);
    expect(pixel.renderMode).toBe("pixel");
    expect(Object.keys(pixel.assets).length).toBeGreaterThan(0);
    // Every kind references a bundled sprite.
    for (const kind of Object.values(pixel.kinds)) {
      expect(kind.assetRef).toBeTruthy();
      expect(pixel.assets[kind.assetRef as string]).toBeTruthy();
    }
    expect(pixel.background.kind).toBe("image");
  });

  it("the Aurora pack is a pure vector pack (no assets, animated edges)", () => {
    const aurora = getPack(AURORA_PACK_ID);
    expect(aurora.renderMode).toBe("vector");
    expect(Object.keys(aurora.assets).length).toBe(0);
    expect(aurora.edges.data.animated).toBe(true);
  });
});
