import { describe, it, expect } from "vitest";
import { buildCustomPack, DRAFT_PACK_ID } from "./custom";
import { classicPack } from "./packs/classic";

describe("buildCustomPack", () => {
  it("clones the base without mutating it", () => {
    const before = JSON.stringify(classicPack);
    const out = buildCustomPack(classicPack, {
      name: "Mine",
      basePackId: "classic",
      kinds: { plan: { color: "#ff0000" } },
    });
    expect(out.kinds.plan.color).toBe("#ff0000");
    expect(classicPack.kinds.plan.color).not.toBe("#ff0000"); // base untouched
    expect(JSON.stringify(classicPack)).toBe(before);
    expect(out.name).toBe("Mine");
    expect(out.id).toBe(DRAFT_PACK_ID);
  });

  it("wires an imported sprite into assets + the kind assetRef", () => {
    const out = buildCustomPack(classicPack, {
      name: "Sprited",
      basePackId: "classic",
      renderMode: "pixel",
      kinds: {
        execute: { assetUrl: "/api/assets/abc", pixelated: true },
      },
    });
    expect(out.renderMode).toBe("pixel");
    const ref = out.kinds.execute.assetRef as string;
    expect(ref).toBe("kind-execute");
    expect(out.assets[ref]).toEqual({ url: "/api/assets/abc", pixelated: true });
  });

  it("sets an image background with its asset, or clears assetRef otherwise", () => {
    const img = buildCustomPack(classicPack, {
      name: "Bg",
      basePackId: "classic",
      background: { kind: "image", assetUrl: "/api/assets/tile", pixelated: true },
    });
    expect(img.background.kind).toBe("image");
    expect(img.background.assetRef).toBe("bg");
    expect(img.assets.bg).toEqual({ url: "/api/assets/tile", pixelated: true });

    const lines = buildCustomPack(classicPack, {
      name: "Lines",
      basePackId: "classic",
      background: { kind: "lines" },
    });
    expect(lines.background.kind).toBe("lines");
    expect(lines.background.assetRef).toBeUndefined();
  });

  it("clears an existing sprite when assetUrl is null (edit mode)", () => {
    // Start from a pack that already has a sprite on `execute`.
    const sprited = buildCustomPack(classicPack, {
      name: "Sprited",
      basePackId: "classic",
      kinds: { execute: { assetUrl: "/api/assets/abc" } },
    });
    const ref = sprited.kinds.execute.assetRef as string;
    expect(sprited.assets[ref]).toBeDefined();

    // Re-edit it (base = the sprited pack) and clear the sprite explicitly.
    const cleared = buildCustomPack(sprited, {
      name: "Sprited",
      basePackId: sprited.id,
      kinds: { execute: { assetUrl: null } },
    });
    expect(cleared.kinds.execute.assetRef).toBeUndefined();
    expect(cleared.assets[ref]).toBeUndefined();
  });

  it("leaves an existing sprite untouched when assetUrl is undefined (create inherit)", () => {
    const sprited = buildCustomPack(classicPack, {
      name: "Sprited",
      basePackId: "classic",
      kinds: { execute: { assetUrl: "/api/assets/abc" } },
    });
    const inherited = buildCustomPack(sprited, {
      name: "Sprited2",
      basePackId: sprited.id,
      kinds: { execute: { color: "#222222" } }, // no assetUrl key → inherit
    });
    expect(inherited.kinds.execute.assetRef).toBe("kind-execute");
    expect(inherited.assets["kind-execute"]).toBeDefined();
  });

  it("toggles motion off", () => {
    const out = buildCustomPack(classicPack, {
      name: "Still",
      basePackId: "classic",
      motionEnabled: false,
    });
    expect(out.motion.enabled).toBe(false);
  });

  it("produces a pack that re-validates against the schema (all kinds/statuses present)", () => {
    const out = buildCustomPack(classicPack, {
      name: "Valid",
      basePackId: "classic",
      kinds: { doc: { color: "#123456" } },
    });
    // buildCustomPack already parses; assert full coverage carried from base.
    expect(Object.keys(out.kinds).length).toBe(
      Object.keys(classicPack.kinds).length,
    );
    expect(Object.keys(out.statuses).length).toBe(
      Object.keys(classicPack.statuses).length,
    );
  });

  it("rejects an invalid override (bad color → empty string) at validation", () => {
    expect(() =>
      buildCustomPack(classicPack, {
        name: "Bad",
        basePackId: "classic",
        kinds: { plan: { color: "" } },
      }),
    ).toThrow();
  });

  it("wires a per-status sprite + color into assets and the status assetRef", () => {
    const out = buildCustomPack(classicPack, {
      name: "Stateful",
      basePackId: "classic",
      statuses: {
        running: { color: "#ff8800", assetUrl: "/api/assets/run.gif", pixelated: false },
      },
    });
    expect(out.statuses.running.color).toBe("#ff8800");
    expect(out.statuses.running.assetRef).toBe("status-running");
    expect(out.assets["status-running"]).toEqual({
      url: "/api/assets/run.gif",
      pixelated: false,
    });
    // base untouched
    expect(classicPack.statuses.running.assetRef).toBeUndefined();
  });

  it("clears an existing status sprite when assetUrl is null (edit mode)", () => {
    const sprited = buildCustomPack(classicPack, {
      name: "S",
      basePackId: "classic",
      statuses: { failed: { assetUrl: "/api/assets/x" } },
    });
    expect(sprited.statuses.failed.assetRef).toBe("status-failed");

    const cleared = buildCustomPack(sprited, {
      name: "S",
      basePackId: sprited.id,
      statuses: { failed: { assetUrl: null } },
    });
    expect(cleared.statuses.failed.assetRef).toBeUndefined();
    expect(cleared.assets["status-failed"]).toBeUndefined();
  });

  it("applies background image filters + tint", () => {
    const out = buildCustomPack(classicPack, {
      name: "Filtered",
      basePackId: "classic",
      background: {
        kind: "image",
        assetUrl: "/api/assets/photo",
        filter: { blur: 6, brightness: 0.8, tintColor: "#000000", tintOpacity: 0.45 },
      },
    });
    expect(out.background.kind).toBe("image");
    expect(out.background.assetRef).toBe("bg");
    expect(out.background.filter).toEqual({
      blur: 6,
      brightness: 0.8,
      tintColor: "#000000",
      tintOpacity: 0.45,
    });
  });

  it("drops the background filter when none is provided", () => {
    const withFilter = buildCustomPack(classicPack, {
      name: "F",
      basePackId: "classic",
      background: { kind: "dots", filter: { blur: 3 } },
    });
    expect(withFilter.background.filter).toEqual({ blur: 3 });

    const noFilter = buildCustomPack(withFilter, {
      name: "F",
      basePackId: withFilter.id,
      background: { kind: "dots" },
    });
    expect(noFilter.background.filter).toBeUndefined();
  });
});
