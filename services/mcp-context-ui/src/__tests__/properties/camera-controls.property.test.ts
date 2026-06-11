/**
 * Property-Based Tests: Camera Controls (Properties 54–55)
 *
 * Validates camera minimum distance and zoom range constraints for the
 * 3D Globe Visualizer's OrbitControls configuration.
 *
 * These tests validate the `clampCameraDistance` utility and the
 * `OrbitControls` configuration constants (CAMERA_MIN_DISTANCE=3,
 * CAMERA_MAX_DISTANCE=50).
 *
 * Relationship to Property 40 (Sprint 6):
 * Property 40 in `multi-globe-rendering.property.test.ts` already validates
 * basic clamping behavior (below-min → min, above-max → max, within-range → unchanged)
 * and idempotency. Properties 54–55 are specified separately in the design doc with
 * a different framing:
 *   - Property 54 focuses on the constraint that camera cannot be at origin (min > 0)
 *     and validates the minimum distance boundary specifically.
 *   - Property 55 focuses on monotonicity (a mathematical property not tested in P40),
 *     the relationship between GLOBE_RADIUS and the constants, and the full zoom range.
 *
 * Design Spec Discrepancy:
 * The design spec defines camera constraints as 0.5R and 10R per-globe, where R is
 * GLOBE_RADIUS=2. This would yield minDistance=1 and maxDistance=20. However, the
 * production code uses scene-level constants: CAMERA_MIN_DISTANCE=3, CAMERA_MAX_DISTANCE=50.
 * These scene-level values are intentionally larger because the camera orbits the entire
 * multi-globe scene (not a single globe). The property tests validate the ACTUAL
 * production constants, not the per-globe spec values.
 *
 * Feature: 3d-codebase-globe-visualizer, Property 54: Camera Minimum Distance Constraint
 * Feature: 3d-codebase-globe-visualizer, Property 55: Camera Zoom Range Constraint
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  CAMERA_MIN_DISTANCE,
  CAMERA_MAX_DISTANCE,
  clampCameraDistance,
} from "../../constants/globe";
import { GLOBE_RADIUS } from "../../components/mcp/globe-physics-utils";

// ---------------------------------------------------------------------------
// Property 54: Camera Minimum Distance Constraint
// ---------------------------------------------------------------------------
describe("Property 54: Camera Minimum Distance Constraint", () => {
  // Feature: 3d-codebase-globe-visualizer, Property 54: Camera Minimum Distance Constraint

  it("CAMERA_MIN_DISTANCE must be > 0 (camera cannot be at origin)", () => {
    // This is a fundamental invariant: a camera at the origin would be inside
    // all globes and produce no meaningful rendering.
    expect(CAMERA_MIN_DISTANCE).toBeGreaterThan(0);
  });

  it("CAMERA_MIN_DISTANCE must be > GLOBE_RADIUS (camera cannot be inside a globe)", () => {
    // The camera must always be outside the nearest globe surface.
    // With GLOBE_RADIUS=2 and CAMERA_MIN_DISTANCE=3, the camera is always
    // at least 1 unit outside the globe surface at the scene origin.
    expect(CAMERA_MIN_DISTANCE).toBeGreaterThan(GLOBE_RADIUS);
  });

  it("for any distance < CAMERA_MIN_DISTANCE, clampCameraDistance returns exactly CAMERA_MIN_DISTANCE", () => {
    fc.assert(
      fc.property(
        // Generate distances in (0, CAMERA_MIN_DISTANCE) exclusive
        fc.double({ min: Number.EPSILON, max: CAMERA_MIN_DISTANCE - Number.EPSILON, noNaN: true }),
        (distance) => {
          const result = clampCameraDistance(distance);
          expect(result).toBe(CAMERA_MIN_DISTANCE);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("for any negative distance, clampCameraDistance returns CAMERA_MIN_DISTANCE", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: -Number.EPSILON, noNaN: true }),
        (distance) => {
          const result = clampCameraDistance(distance);
          expect(result).toBe(CAMERA_MIN_DISTANCE);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("distance exactly at CAMERA_MIN_DISTANCE is preserved (boundary)", () => {
    const result = clampCameraDistance(CAMERA_MIN_DISTANCE);
    expect(result).toBe(CAMERA_MIN_DISTANCE);
  });
});

// ---------------------------------------------------------------------------
// Property 55: Camera Zoom Range Constraint
// ---------------------------------------------------------------------------
describe("Property 55: Camera Zoom Range Constraint", () => {
  // Feature: 3d-codebase-globe-visualizer, Property 55: Camera Zoom Range Constraint

  it("for any distance, clampCameraDistance returns a value within [CAMERA_MIN_DISTANCE, CAMERA_MAX_DISTANCE]", () => {
    fc.assert(
      fc.property(
        // Generate distances across a wide range (0, 1000)
        fc.double({ min: 0, max: 1000, noNaN: true }),
        (distance) => {
          const result = clampCameraDistance(distance);
          expect(result).toBeGreaterThanOrEqual(CAMERA_MIN_DISTANCE);
          expect(result).toBeLessThanOrEqual(CAMERA_MAX_DISTANCE);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("clampCameraDistance is monotonically non-decreasing: if a < b then clamp(a) <= clamp(b)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 1000, noNaN: true }),
        fc.double({ min: -100, max: 1000, noNaN: true }),
        (a, b) => {
          // Ensure a < b for the monotonicity check
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const clampLo = clampCameraDistance(lo);
          const clampHi = clampCameraDistance(hi);
          expect(clampLo).toBeLessThanOrEqual(clampHi);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("clampCameraDistance is idempotent: clamp(clamp(x)) === clamp(x)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 1000, noNaN: true }),
        (distance) => {
          const once = clampCameraDistance(distance);
          const twice = clampCameraDistance(once);
          expect(twice).toBe(once);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("CAMERA_MAX_DISTANCE > CAMERA_MIN_DISTANCE (valid zoom range exists)", () => {
    expect(CAMERA_MAX_DISTANCE).toBeGreaterThan(CAMERA_MIN_DISTANCE);
  });

  it("distance exactly at CAMERA_MAX_DISTANCE is preserved (boundary)", () => {
    const result = clampCameraDistance(CAMERA_MAX_DISTANCE);
    expect(result).toBe(CAMERA_MAX_DISTANCE);
  });

  it("distances within [MIN, MAX] are preserved unchanged (identity in valid range)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: CAMERA_MIN_DISTANCE, max: CAMERA_MAX_DISTANCE, noNaN: true }),
        (distance) => {
          const result = clampCameraDistance(distance);
          expect(result).toBe(distance);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Design Spec Relationship:
   * The design spec says minDistance = 0.5 * GLOBE_RADIUS and maxDistance = 10 * GLOBE_RADIUS.
   * With GLOBE_RADIUS=2, that would be min=1, max=20.
   * Production uses min=3, max=50 because OrbitControls operates at the scene level
   * (multi-globe solar system), not per-globe. The scene-level values ensure the camera
   * can zoom out far enough to see all globes and stays outside the nearest globe.
   */
  it("documents the relationship between GLOBE_RADIUS and production constants", () => {
    const specMin = 0.5 * GLOBE_RADIUS; // Design spec: 1
    const specMax = 10 * GLOBE_RADIUS;  // Design spec: 20

    // Production constants are larger than per-globe spec values
    // because they apply to the entire scene, not a single globe.
    expect(CAMERA_MIN_DISTANCE).toBeGreaterThan(specMin);
    expect(CAMERA_MAX_DISTANCE).toBeGreaterThan(specMax);

    // But the production min still prevents camera from entering any globe
    expect(CAMERA_MIN_DISTANCE).toBeGreaterThan(GLOBE_RADIUS);
  });
});
