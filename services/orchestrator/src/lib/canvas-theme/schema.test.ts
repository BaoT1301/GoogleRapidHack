import { describe, it, expect } from "vitest";
import {
  themePackSchema,
  parseThemePack,
  safeParseThemePack,
  VISUAL_STATUSES,
  ICON_NAMES,
  type ThemePack,
} from "./schema";
import { NODE_KINDS, EDGE_KINDS } from "@/lib/graph-constants";

// A minimal-but-complete valid pack built programmatically so the test can't
// drift from the const key lists.
function makeValidPack(): ThemePack {
  const kinds = Object.fromEntries(
    NODE_KINDS.map((k) => [k, { label: k, color: "#ffffff", icon: "cube" }]),
  );
  const statuses = Object.fromEntries(
    VISUAL_STATUSES.map((s) => [s, { color: "#646b7a" }]),
  );
  const edges = Object.fromEntries(
    EDGE_KINDS.map((e) => [e, { label: e, color: "#8b7cff" }]),
  );
  return themePackSchema.parse({
    id: "test",
    name: "Test Pack",
    renderMode: "vector",
    kinds,
    statuses,
    edges,
    background: { kind: "dots", color: "rgba(255,255,255,0.06)", gap: 22 },
    motion: { enabled: true },
  });
}

describe("themePackSchema", () => {
  it("parses a complete, valid pack and defaults assets to {}", () => {
    const pack = makeValidPack();
    expect(pack.id).toBe("test");
    expect(pack.assets).toEqual({});
    expect(Object.keys(pack.kinds).sort()).toEqual([...NODE_KINDS].sort());
    expect(Object.keys(pack.statuses).sort()).toEqual(
      [...VISUAL_STATUSES].sort(),
    );
    expect(Object.keys(pack.edges).sort()).toEqual([...EDGE_KINDS].sort());
  });

  it("rejects a pack missing a NodeKind", () => {
    const pack = makeValidPack();
    const broken = structuredClone(pack) as Record<string, unknown>;
    delete (broken.kinds as Record<string, unknown>)[NODE_KINDS[0]];
    const res = safeParseThemePack(broken);
    expect(res.success).toBe(false);
  });

  it("rejects a pack missing a VisualStatus (e.g. stale)", () => {
    const pack = makeValidPack();
    const broken = structuredClone(pack) as Record<string, unknown>;
    delete (broken.statuses as Record<string, unknown>).stale;
    const res = safeParseThemePack(broken);
    expect(res.success).toBe(false);
  });

  it("rejects a pack missing an EdgeKind", () => {
    const pack = makeValidPack();
    const broken = structuredClone(pack) as Record<string, unknown>;
    delete (broken.edges as Record<string, unknown>)[EDGE_KINDS[0]];
    expect(safeParseThemePack(broken).success).toBe(false);
  });

  it("rejects an unknown icon name", () => {
    const pack = makeValidPack();
    const broken = structuredClone(pack) as Record<string, unknown>;
    (broken.kinds as Record<string, { icon: string }>)[NODE_KINDS[0]].icon =
      "not-a-real-icon";
    expect(safeParseThemePack(broken).success).toBe(false);
  });

  it("rejects an invalid renderMode", () => {
    const pack = makeValidPack();
    const broken = { ...pack, renderMode: "3d" };
    expect(safeParseThemePack(broken).success).toBe(false);
  });

  it("rejects unknown top-level keys (strict)", () => {
    const pack = makeValidPack();
    const broken = { ...pack, somethingExtra: true };
    expect(safeParseThemePack(broken).success).toBe(false);
  });

  it("accepts a pixel renderMode with pixelated assets and assetRefs", () => {
    const pack = makeValidPack();
    const pixel = {
      ...pack,
      renderMode: "pixel" as const,
      assets: { "node-plan": { url: "/x.png", pixelated: true } },
      kinds: {
        ...pack.kinds,
        [NODE_KINDS[0]]: {
          ...pack.kinds[NODE_KINDS[0]],
          assetRef: "node-plan",
        },
      },
    };
    expect(() => parseThemePack(pixel)).not.toThrow();
  });

  it("validates motion variants (continuous perStatus animation)", () => {
    const pack = makeValidPack();
    const withMotion = {
      ...pack,
      motion: {
        enabled: true,
        entrance: {
          initial: { opacity: 0, scale: 0.92 },
          animate: { opacity: 1, scale: 1 },
          transition: { duration: 0.25 },
        },
        hover: { y: -1 },
        perStatus: {
          pulse: {
            animate: { opacity: [1, 0.6, 1] },
            transition: { duration: 1.2, repeat: Number.POSITIVE_INFINITY },
          },
        },
      },
    };
    expect(() => parseThemePack(withMotion)).not.toThrow();
  });

  it("exposes the expected icon-name vocabulary", () => {
    expect(ICON_NAMES).toContain("note-pencil");
    expect(ICON_NAMES).toContain("lightning");
  });

  it("accepts an image background with filters + tint", () => {
    const pack = makeValidPack();
    const filtered = {
      ...pack,
      assets: { bg: { url: "/bg.png" } },
      background: {
        kind: "image" as const,
        assetRef: "bg",
        filter: {
          blur: 4,
          brightness: 1.1,
          contrast: 0.9,
          saturate: 1.2,
          grayscale: 0.5,
          opacity: 0.8,
          tintColor: "#000000",
          tintOpacity: 0.4,
        },
      },
    };
    expect(() => parseThemePack(filtered)).not.toThrow();
  });

  it("rejects an out-of-range background filter value", () => {
    const pack = makeValidPack();
    const broken = {
      ...pack,
      background: { kind: "dots" as const, filter: { blur: 999 } },
    };
    expect(safeParseThemePack(broken).success).toBe(false);
  });

  it("accepts a per-status overlay sprite (assetRef)", () => {
    const pack = makeValidPack();
    const sprited = {
      ...pack,
      assets: { "status-running": { url: "/run.gif" } },
      statuses: {
        ...pack.statuses,
        running: { ...pack.statuses.running, assetRef: "status-running" },
      },
    };
    expect(() => parseThemePack(sprited)).not.toThrow();
  });
});
