/**
 * LOD (Level of Detail) Tests
 *
 * Property 28: ratio = cameraDistance / globeRadius
 * Property 29: correct level for ratios >3, 1.5-3, <1.5
 */

import { describe, it, expect } from "vitest";
import { computeLOD } from "../hooks/use-lod";

describe("computeLOD", () => {
  // ── Property 28: ratio calculation ──────────────────────────────────
  describe("Property 28: ratio = cameraDistance / globeRadius", () => {
    it("computes ratio correctly and maps to the right level", () => {
      // ratio = 400 / 100 = 4.0 → far
      const result = computeLOD(400, 100);
      expect(result.level).toBe("far");
    });

    it("handles zero globe radius gracefully (Infinity ratio → far)", () => {
      const result = computeLOD(100, 0);
      expect(result.level).toBe("far");
    });

    it("handles equal distance and radius (ratio = 1.0 → close)", () => {
      const result = computeLOD(100, 100);
      expect(result.level).toBe("close");
    });
  });

  // ── Property 29: LOD level transitions ──────────────────────────────
  describe("Property 29: correct level for ratio thresholds", () => {
    it("returns 'far' when ratio > 3", () => {
      const result = computeLOD(310, 100);
      expect(result.level).toBe("far");
      expect(result.showFunctionLabels).toBe(false);
      expect(result.showDirectedArcs).toBe(false);
      expect(result.showFunctionBadges).toBe(false);
    });

    it("returns 'far' at ratio = 3.01", () => {
      const result = computeLOD(301, 100);
      expect(result.level).toBe("far");
    });

    it("returns 'medium' at ratio = 3.0 (boundary)", () => {
      const result = computeLOD(300, 100);
      expect(result.level).toBe("medium");
      expect(result.showFunctionLabels).toBe(false);
      expect(result.showDirectedArcs).toBe(false);
      expect(result.showFunctionBadges).toBe(true);
    });

    it("returns 'medium' at ratio = 2.0", () => {
      const result = computeLOD(200, 100);
      expect(result.level).toBe("medium");
    });

    it("returns 'medium' at ratio = 1.5 (boundary)", () => {
      const result = computeLOD(150, 100);
      expect(result.level).toBe("medium");
    });

    it("returns 'close' at ratio = 1.49", () => {
      const result = computeLOD(149, 100);
      expect(result.level).toBe("close");
      expect(result.showFunctionLabels).toBe(true);
      expect(result.showDirectedArcs).toBe(true);
      expect(result.showFunctionBadges).toBe(true);
    });

    it("returns 'close' at ratio = 0.5", () => {
      const result = computeLOD(50, 100);
      expect(result.level).toBe("close");
    });

    it("returns 'close' at ratio = 0 (camera at center)", () => {
      const result = computeLOD(0, 100);
      expect(result.level).toBe("close");
    });

    // Sweep across a range of ratios to verify monotonic transitions
    it("transitions monotonically: close → medium → far as ratio increases", () => {
      const levels: string[] = [];
      for (let ratio = 0; ratio <= 5; ratio += 0.1) {
        const result = computeLOD(ratio * 100, 100);
        levels.push(result.level);
      }

      // Once we leave 'close', we should never go back
      let leftClose = false;
      let leftMedium = false;
      for (const level of levels) {
        if (leftClose && level === "close") {
          throw new Error("Returned to 'close' after leaving it");
        }
        if (leftMedium && level === "medium") {
          throw new Error("Returned to 'medium' after leaving it");
        }
        if (level !== "close") leftClose = true;
        if (leftClose && level !== "medium") leftMedium = true;
      }
    });
  });
});
