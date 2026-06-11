import { describe, it, expect } from "vitest";
import { nodeMotionProps } from "./motion";
import { classicPack } from "./packs/classic";
import { parseThemePack } from "./schema";

describe("nodeMotionProps", () => {
  it("applies the entrance + hover for a status with no variant (pending)", () => {
    const m = nodeMotionProps(classicPack, "pending");
    expect(m.initial).toEqual({ opacity: 0, scale: 0.92 });
    expect(m.animate).toEqual({ opacity: 1, scale: 1 });
    expect(m.whileHover).toEqual({ y: -1 });
  });

  it("applies the pack's running variant (pulse) over the entrance", () => {
    const m = nodeMotionProps(classicPack, "running");
    // opacity keyframes from the pulse variant win; scale stays from entrance.
    expect(m.animate).toMatchObject({ opacity: [1, 0.55, 1], scale: 1 });
    expect(m.transition).toMatchObject({
      repeat: Number.POSITIVE_INFINITY,
    });
  });

  it("applies the failed variant (shake)", () => {
    const m = nodeMotionProps(classicPack, "failed");
    expect(m.animate).toMatchObject({ x: [0, -3, 3, -2, 2, 0] });
  });

  it("applies the stale variant (fade)", () => {
    const m = nodeMotionProps(classicPack, "stale");
    expect(m.animate).toMatchObject({ opacity: [0.72, 0.5, 0.72] });
  });

  it("collapses to static (no animation) when reducedMotion is requested", () => {
    expect(nodeMotionProps(classicPack, "running", { reducedMotion: true })).toEqual(
      {},
    );
    expect(nodeMotionProps(classicPack, "stale", { reducedMotion: true })).toEqual(
      {},
    );
  });

  it("collapses to static when the pack disables motion", () => {
    const noMotion = parseThemePack({
      ...classicPack,
      motion: { enabled: false },
    });
    expect(nodeMotionProps(noMotion, "running")).toEqual({});
  });
});
