import { describe, it, expect } from "vitest";
import {
  edgeRenderProps,
  backgroundRenderProps,
  resolveAsset,
  shouldPixelate,
  backgroundFilterStyle,
  backgroundTint,
  statusAsset,
} from "./apply";
import { classicPack } from "./packs/classic";
import { parseThemePack } from "./schema";
import { EDGE_KINDS } from "@/lib/graph-constants";

describe("edgeRenderProps (Classic parity)", () => {
  it("derives stroke + width from the pack and animates only `flow`", () => {
    for (const kind of EDGE_KINDS) {
      const props = edgeRenderProps(classicPack, kind);
      expect(props.style.stroke).toBe(classicPack.edges[kind].color);
      expect(props.style.strokeWidth).toBe(1.5);
      expect(props.animated).toBe(kind === "flow");
    }
  });

  it("falls back to the flow edge when kind is undefined", () => {
    const props = edgeRenderProps(classicPack, undefined);
    expect(props.style.stroke).toBe(classicPack.edges.flow.color);
  });
});

describe("backgroundRenderProps", () => {
  it("maps the Classic dot grid (color + gap)", () => {
    const bg = backgroundRenderProps(classicPack);
    expect(bg).toEqual({
      variant: "dots",
      color: "rgba(255,255,255,0.06)",
      gap: 22,
      size: undefined,
    });
  });

  it("returns null for a `none` background", () => {
    const pack = parseThemePack({
      ...classicPack,
      background: { kind: "none" },
    });
    expect(backgroundRenderProps(pack)).toBeNull();
  });

  it("surfaces imageAssetRef for an image background and falls back to dots variant", () => {
    const pack = parseThemePack({
      ...classicPack,
      assets: { bg: { url: "/bg.png", pixelated: true } },
      background: { kind: "image", assetRef: "bg" },
    });
    const bg = backgroundRenderProps(pack);
    expect(bg?.imageAssetRef).toBe("bg");
    expect(bg?.variant).toBe("dots");
  });
});

describe("resolveAsset / shouldPixelate", () => {
  const pixelPack = parseThemePack({
    ...classicPack,
    renderMode: "pixel",
    assets: { "node-plan": { url: "/api/assets/x", pixelated: true } },
  });

  it("resolves an assetRef to its def, or undefined when missing", () => {
    expect(resolveAsset(pixelPack, "node-plan")?.url).toBe("/api/assets/x");
    expect(resolveAsset(pixelPack, "missing")).toBeUndefined();
    expect(resolveAsset(pixelPack, undefined)).toBeUndefined();
  });

  it("pixelates for pixel-mode packs and for per-asset pixelated flags", () => {
    expect(shouldPixelate(pixelPack, undefined)).toBe(true); // renderMode pixel
    expect(shouldPixelate(classicPack, undefined)).toBe(false); // vector
    expect(
      shouldPixelate(classicPack, { url: "/x", pixelated: true }),
    ).toBe(true);
  });
});

describe("backgroundFilterStyle / backgroundTint", () => {
  it("returns {} when no filter is configured", () => {
    expect(backgroundFilterStyle(classicPack)).toEqual({});
    expect(backgroundTint(classicPack)).toBeNull();
  });

  it("composes only the provided filter functions (fixed order) + opacity", () => {
    const pack = parseThemePack({
      ...classicPack,
      assets: { bg: { url: "/bg.png" } },
      background: {
        kind: "image",
        assetRef: "bg",
        filter: { blur: 4, brightness: 1.2, opacity: 0.7 },
      },
    });
    const style = backgroundFilterStyle(pack);
    expect(style.filter).toBe("blur(4px) brightness(1.2)");
    expect(style.opacity).toBe(0.7);
  });

  it("emits all five filter functions in a deterministic order", () => {
    const pack = parseThemePack({
      ...classicPack,
      background: {
        kind: "dots",
        filter: {
          blur: 1,
          brightness: 2,
          contrast: 0.5,
          saturate: 1.5,
          grayscale: 1,
        },
      },
    });
    expect(backgroundFilterStyle(pack).filter).toBe(
      "blur(1px) brightness(2) contrast(0.5) saturate(1.5) grayscale(1)",
    );
  });

  it("resolves a tint with a default opacity of 0.3", () => {
    const pack = parseThemePack({
      ...classicPack,
      background: { kind: "dots", filter: { tintColor: "#000000" } },
    });
    expect(backgroundTint(pack)).toEqual({ color: "#000000", opacity: 0.3 });
  });

  it("honors an explicit tint opacity", () => {
    const pack = parseThemePack({
      ...classicPack,
      background: { kind: "dots", filter: { tintColor: "#112233", tintOpacity: 0.6 } },
    });
    expect(backgroundTint(pack)).toEqual({ color: "#112233", opacity: 0.6 });
  });
});

describe("statusAsset", () => {
  it("resolves a per-status overlay sprite, or undefined when absent", () => {
    const pack = parseThemePack({
      ...classicPack,
      assets: { "status-running": { url: "/run.gif" } },
      statuses: {
        ...classicPack.statuses,
        running: { ...classicPack.statuses.running, assetRef: "status-running" },
      },
    });
    expect(statusAsset(pack, "running")?.url).toBe("/run.gif");
    expect(statusAsset(pack, "success")).toBeUndefined();
  });
});
