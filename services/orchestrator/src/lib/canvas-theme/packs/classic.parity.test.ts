import { describe, it, expect } from "vitest";
import { classicPack } from "./classic";
import { KIND_META, EDGE_META } from "@/lib/graph-constants";
import { STATUS_COLORS } from "@/lib/status";
import { NODE_KINDS, EDGE_KINDS } from "@/lib/graph-constants";

/**
 * Parity guard: the Classic pack must reproduce the canvas's ORIGINAL hardcoded
 * visuals exactly. If anyone edits the pack and drifts from KIND_META /
 * STATUS_COLORS / EDGE_META, this fails — protecting the "zero visual change"
 * promise of Phase 1.
 */
describe("classic pack parity with original constants", () => {
  it("matches KIND_META (label + color) and carries an icon for every kind", () => {
    for (const kind of NODE_KINDS) {
      expect(classicPack.kinds[kind].label).toBe(KIND_META[kind].label);
      expect(classicPack.kinds[kind].color).toBe(KIND_META[kind].color);
      expect(classicPack.kinds[kind].icon).toBeTruthy();
    }
  });

  it("matches STATUS_COLORS for every status present in the original palette", () => {
    for (const [status, color] of Object.entries(STATUS_COLORS)) {
      expect(
        classicPack.statuses[status as keyof typeof classicPack.statuses]?.color,
      ).toBe(color);
    }
  });

  it("matches EDGE_META (label + color) and animates only `flow`", () => {
    for (const kind of EDGE_KINDS) {
      expect(classicPack.edges[kind].label).toBe(EDGE_META[kind].label);
      expect(classicPack.edges[kind].color).toBe(EDGE_META[kind].color);
      expect(classicPack.edges[kind].strokeWidth).toBe(1.5);
      expect(classicPack.edges[kind].animated).toBe(kind === "flow");
    }
  });

  it("reproduces the dot-grid background (color + gap)", () => {
    expect(classicPack.background).toEqual({
      kind: "dots",
      color: "rgba(255,255,255,0.06)",
      gap: 22,
    });
  });

  it("reproduces the node entrance + hover motion", () => {
    expect(classicPack.motion.enabled).toBe(true);
    expect(classicPack.motion.entrance?.initial).toEqual({
      opacity: 0,
      scale: 0.92,
    });
    expect(classicPack.motion.entrance?.animate).toEqual({
      opacity: 1,
      scale: 1,
    });
    expect(classicPack.motion.entrance?.transition).toEqual({
      duration: 0.25,
      ease: [0.16, 1, 0.3, 1],
    });
    expect(classicPack.motion.hover).toEqual({ y: -1 });
  });

  it("adds the new UI-derived `stale` status (not in the original palette)", () => {
    expect(STATUS_COLORS).not.toHaveProperty("stale");
    expect(classicPack.statuses.stale.frame).toBe("dashed");
    expect(classicPack.statuses.stale.opacity).toBeLessThan(1);
  });
});
