/**
 * Multi-Globe Rendering Property Tests (Properties 39–41)
 *
 * Validates:
 * - Property 39: Sphere count matches cluster count (computeDefaultPositions)
 * - Property 40: Camera constraint enforcement (clampCameraDistance)
 * - Property 41: Cross-globe arc bezier rendering (computeBezierArcPoints)
 *
 * Feature: 3d-codebase-globe-visualizer, Property 39: Sphere Count Matches Cluster Count
 * Feature: 3d-codebase-globe-visualizer, Property 40: Camera Constraint Enforcement
 * Feature: 3d-codebase-globe-visualizer, Property 41: Cross-Globe Arc Bezier Rendering
 *
 * Sprint: 6 — Property-Based Testing Batch 4
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { computeDefaultPositions } from "../../components/mcp/globe-physics-utils";
import {
  CAMERA_MIN_DISTANCE,
  CAMERA_MAX_DISTANCE,
  clampCameraDistance,
} from "../../constants/globe";
import {
  computeBezierArcPoints,
  computeBezierControlPoint,
  isCollinear,
} from "../../components/mcp/globe-arc-utils";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates 1–5 unique cluster IDs */
const arbUniqueClusterIds: fc.Arbitrary<string[]> = fc
  .uniqueArray(fc.stringMatching(/^[a-z][a-z0-9\-]{0,14}$/), {
    minLength: 1,
    maxLength: 5,
  });

/** Camera distance ∈ (0, 100] */
const arbCameraDistance = fc.double({ min: 0.001, max: 100, noNaN: true });

/** 3D position tuple with finite values */
const arbPosition: fc.Arbitrary<[number, number, number]> = fc.tuple(
  fc.double({ min: -50, max: 50, noNaN: true }),
  fc.double({ min: -50, max: 50, noNaN: true }),
  fc.double({ min: -50, max: 50, noNaN: true }),
);

// ---------------------------------------------------------------------------
// Property 39: Sphere Count Matches Cluster Count
// ---------------------------------------------------------------------------
describe("Property 39: Sphere Count Matches Cluster Count", () => {
  // Feature: 3d-codebase-globe-visualizer, Property 39: Sphere Count Matches Cluster Count

  it("computeDefaultPositions returns exactly one position per cluster ID", () => {
    fc.assert(
      fc.property(arbUniqueClusterIds, (clusterIds) => {
        const positions = computeDefaultPositions(clusterIds);
        expect(positions).toHaveLength(clusterIds.length);
      }),
      { numRuns: 100 },
    );
  });

  it("each returned position has a clusterId matching one of the input IDs", () => {
    fc.assert(
      fc.property(arbUniqueClusterIds, (clusterIds) => {
        const positions = computeDefaultPositions(clusterIds);
        const inputIdSet = new Set(clusterIds);

        for (const pos of positions) {
          expect(inputIdSet.has(pos.clusterId)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("returned clusterIds preserve the input order", () => {
    fc.assert(
      fc.property(arbUniqueClusterIds, (clusterIds) => {
        const positions = computeDefaultPositions(clusterIds);

        for (let i = 0; i < clusterIds.length; i++) {
          expect(positions[i].clusterId).toBe(clusterIds[i]);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("all positions have finite numeric x, y, z coordinates", () => {
    fc.assert(
      fc.property(arbUniqueClusterIds, (clusterIds) => {
        const positions = computeDefaultPositions(clusterIds);

        for (const pos of positions) {
          expect(Number.isFinite(pos.x)).toBe(true);
          expect(Number.isFinite(pos.y)).toBe(true);
          expect(Number.isFinite(pos.z)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("single cluster is positioned at origin (0, 0, 0)", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9\-]{0,14}$/),
        (clusterId) => {
          const positions = computeDefaultPositions([clusterId]);
          expect(positions[0].x).toBe(0);
          expect(positions[0].y).toBe(0);
          expect(positions[0].z).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("all positions have y === 0 (arranged in XZ plane)", () => {
    fc.assert(
      fc.property(arbUniqueClusterIds, (clusterIds) => {
        const positions = computeDefaultPositions(clusterIds);

        for (const pos of positions) {
          expect(pos.y).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 40: Camera Constraint Enforcement
// ---------------------------------------------------------------------------
describe("Property 40: Camera Constraint Enforcement", () => {
  // Feature: 3d-codebase-globe-visualizer, Property 40: Camera Constraint Enforcement

  it("camera constants match the OrbitControls configuration (min=3, max=50)", () => {
    expect(CAMERA_MIN_DISTANCE).toBe(3);
    expect(CAMERA_MAX_DISTANCE).toBe(50);
  });

  it("distances below MIN_DISTANCE are clamped to MIN_DISTANCE", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: CAMERA_MIN_DISTANCE - 0.001, noNaN: true }),
        (distance) => {
          const result = clampCameraDistance(distance);
          expect(result).toBe(CAMERA_MIN_DISTANCE);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("distances above MAX_DISTANCE are clamped to MAX_DISTANCE", () => {
    fc.assert(
      fc.property(
        fc.double({ min: CAMERA_MAX_DISTANCE + 0.001, max: 100, noNaN: true }),
        (distance) => {
          const result = clampCameraDistance(distance);
          expect(result).toBe(CAMERA_MAX_DISTANCE);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("distances within [MIN_DISTANCE, MAX_DISTANCE] are unchanged", () => {
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

  it("clampCameraDistance always returns a value within [min, max]", () => {
    fc.assert(
      fc.property(arbCameraDistance, (distance) => {
        const result = clampCameraDistance(distance);
        expect(result).toBeGreaterThanOrEqual(CAMERA_MIN_DISTANCE);
        expect(result).toBeLessThanOrEqual(CAMERA_MAX_DISTANCE);
      }),
      { numRuns: 100 },
    );
  });

  it("clampCameraDistance is idempotent: clamping twice gives the same result", () => {
    fc.assert(
      fc.property(arbCameraDistance, (distance) => {
        const once = clampCameraDistance(distance);
        const twice = clampCameraDistance(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 100 },
    );
  });

  it("clampCameraDistance with custom min/max works correctly", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1000, noNaN: true }),
        fc.double({ min: 0.001, max: 500, noNaN: true }),
        fc.double({ min: 500.001, max: 1000, noNaN: true }),
        (distance, min, max) => {
          const result = clampCameraDistance(distance, min, max);
          expect(result).toBeGreaterThanOrEqual(min);
          expect(result).toBeLessThanOrEqual(max);

          if (distance < min) {
            expect(result).toBe(min);
          } else if (distance > max) {
            expect(result).toBe(max);
          } else {
            expect(result).toBe(distance);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 41: Cross-Globe Arc Bezier Rendering
// ---------------------------------------------------------------------------
describe("Property 41: Cross-Globe Arc Bezier Rendering", () => {
  // Feature: 3d-codebase-globe-visualizer, Property 41: Cross-Globe Arc Bezier Rendering
  //
  // NOTE: The current implementation in Globe3DPhase2.tsx uses straight lines
  // (2 points: [srcWorld, tgtWorld]) via <Line points={[srcWorld, tgtWorld]} />.
  // This deviates from the design spec which calls for bezier curves.
  // See Issue #11 in docs/issues/issues.md.
  //
  // These tests validate the INTENDED bezier behavior via the
  // computeBezierArcPoints utility. The tests are NOT skipped because
  // they test the utility function that implements the intended behavior,
  // which will be wired into the component in a future sprint.

  it("computeBezierArcPoints returns exactly 3 control points for any two 3D positions", () => {
    fc.assert(
      fc.property(arbPosition, arbPosition, (source, target) => {
        const points = computeBezierArcPoints(source, target);
        expect(points).toHaveLength(3);
      }),
      { numRuns: 100 },
    );
  });

  it("the first and last control points match the source and target exactly", () => {
    fc.assert(
      fc.property(arbPosition, arbPosition, (source, target) => {
        const points = computeBezierArcPoints(source, target);
        expect(points[0]).toEqual(source);
        expect(points[2]).toEqual(target);
      }),
      { numRuns: 100 },
    );
  });

  it("the bezier control point is NOT collinear with endpoints (arc bows outward) for well-separated points", () => {
    // Generate points that are guaranteed to have non-trivial XZ separation
    // (collinearity can occur when points differ only along Y, since the
    // elevation is also along Y — this is a geometric edge case, not a bug)
    const arbSeparatedPair = fc
      .tuple(arbPosition, arbPosition)
      .filter(([s, t]) => {
        const dxz = Math.sqrt((t[0] - s[0]) ** 2 + (t[2] - s[2]) ** 2);
        return dxz > 0.01; // Require meaningful XZ separation
      });

    fc.assert(
      fc.property(arbSeparatedPair, ([source, target]) => {
        const control = computeBezierControlPoint(source, target);
        const collinear = isCollinear(source, control, target, 1e-6);
        expect(collinear).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("the control point midpoint is elevated above the straight-line path (y-component)", () => {
    fc.assert(
      fc.property(arbPosition, arbPosition, (source, target) => {
        // Skip degenerate case
        const dx = target[0] - source[0];
        const dy = target[1] - source[1];
        const dz = target[2] - source[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (distance < 1e-6) return; // Skip coincident points

        const control = computeBezierControlPoint(source, target);
        const straightMidY = (source[1] + target[1]) / 2;

        // The control point Y should be above the straight-line midpoint Y
        // by exactly 20% of the inter-point distance
        const expectedElevation = distance * 0.2;
        expect(control[1]).toBeCloseTo(straightMidY + expectedElevation, 6);
      }),
      { numRuns: 100 },
    );
  });

  it("the control point X and Z are at the midpoint of source and target", () => {
    fc.assert(
      fc.property(arbPosition, arbPosition, (source, target) => {
        const control = computeBezierControlPoint(source, target);

        const expectedX = (source[0] + target[0]) / 2;
        const expectedZ = (source[2] + target[2]) / 2;

        expect(control[0]).toBeCloseTo(expectedX, 10);
        expect(control[2]).toBeCloseTo(expectedZ, 10);
      }),
      { numRuns: 100 },
    );
  });

  it("elevation scales linearly with distance between source and target", () => {
    fc.assert(
      fc.property(
        arbPosition,
        arbPosition,
        fc.double({ min: 1.001, max: 10, noNaN: true }),
        (source, target, scaleFactor) => {
          // Scale the target to increase distance
          const scaledTarget: [number, number, number] = [
            source[0] + (target[0] - source[0]) * scaleFactor,
            source[1] + (target[1] - source[1]) * scaleFactor,
            source[2] + (target[2] - source[2]) * scaleFactor,
          ];

          const dx1 = target[0] - source[0];
          const dy1 = target[1] - source[1];
          const dz1 = target[2] - source[2];
          const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1 + dz1 * dz1);

          if (dist1 < 1e-6) return; // Skip degenerate

          const dx2 = scaledTarget[0] - source[0];
          const dy2 = scaledTarget[1] - source[1];
          const dz2 = scaledTarget[2] - source[2];
          const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2);

          const control1 = computeBezierControlPoint(source, target);
          const control2 = computeBezierControlPoint(source, scaledTarget);

          const midY1 = (source[1] + target[1]) / 2;
          const midY2 = (source[1] + scaledTarget[1]) / 2;

          const elevation1 = control1[1] - midY1;
          const elevation2 = control2[1] - midY2;

          // Elevation should scale proportionally with distance
          if (elevation1 > 1e-10) {
            expect(elevation2 / elevation1).toBeCloseTo(dist2 / dist1, 4);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
