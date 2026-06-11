import { describe, it, expect } from "vitest";
import { applyCanvasConfig } from "./config";
import { classicPack } from "./packs/classic";
import { parseThemePack } from "./schema";

describe("applyCanvasConfig", () => {
  it("returns the same pack reference when there's nothing to override", () => {
    expect(applyCanvasConfig(classicPack, undefined)).toBe(classicPack);
    expect(applyCanvasConfig(classicPack, {})).toBe(classicPack);
  });

  it("overrides motion.enabled", () => {
    const off = applyCanvasConfig(classicPack, { motionEnabled: false });
    expect(off.motion.enabled).toBe(false);
    expect(classicPack.motion.enabled).toBe(true); // original untouched
  });

  it("overrides the background kind, preserving other background fields", () => {
    const out = applyCanvasConfig(classicPack, { backgroundKind: "lines" });
    expect(out.background.kind).toBe("lines");
    expect(out.background.color).toBe(classicPack.background.color);
    expect(out.background.gap).toBe(classicPack.background.gap);
  });

  it("applies both overrides at once", () => {
    const out = applyCanvasConfig(classicPack, {
      motionEnabled: false,
      backgroundKind: "none",
    });
    expect(out.motion.enabled).toBe(false);
    expect(out.background.kind).toBe("none");
  });

  it("does NOT let the grid override clobber a pack's image background", () => {
    const imagePack = parseThemePack({
      ...classicPack,
      assets: { bg: { url: "/api/assets/bg1" } },
      background: { kind: "image", assetRef: "bg" },
    });
    // A user with a stale grid override must still see the pack's image.
    const out = applyCanvasConfig(imagePack, { backgroundKind: "dots" });
    expect(out.background.kind).toBe("image");
    expect(out.background.assetRef).toBe("bg");
  });

  it("still applies motion override on an image pack (only background is preserved)", () => {
    const imagePack = parseThemePack({
      ...classicPack,
      assets: { bg: { url: "/api/assets/bg1" } },
      background: { kind: "image", assetRef: "bg" },
    });
    const out = applyCanvasConfig(imagePack, {
      motionEnabled: false,
      backgroundKind: "lines",
    });
    expect(out.motion.enabled).toBe(false);
    expect(out.background.kind).toBe("image");
  });
});
