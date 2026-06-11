/**
 * LOD System Property Tests (Properties 28–31)
 *
 * Validates the `computeLOD` and `computeMultiGlobeLOD` pure functions:
 * - Distance calculation correctness
 * - Level transition boundaries
 * - Transition animation duration constant
 * - Performance warning threshold
 *
 * Feature: 3d-codebase-globe-visualizer
 * Sprint: 5 — Property-Based Testing Batch 3
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { computeLOD, type LODState } from "../../hooks/use-lod";
import { computeMultiGlobeLOD } from "../../hooks/use-multi-globe-lod";
import {
  LOD_TRANSITION_DURATION_MS,
  PERFORMANCE_WARNING_NODE_THRESHOLD,
  shouldShowPerformanceWarning,
} from "../../constants/globe";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Positive finite camera distance ∈ (0, 10000] */
const arbCameraDistance = fc.double({ min: 0.001, max: 10000, noNaN: true });

/** Positive finite globe radius ∈ (0, 1000] */
const arbGlobeRadius = fc.double({ min: 0.001, max: 1000, noNaN: true });

/** 3D position tuple */
const arbPosition: fc.Arbitrary<[number, number, number]> = fc.tuple(
  fc.double({ min: -100, max: 100, noNaN: true }),
  fc.double({ min: -100, max: 100, noNaN: true }),
  fc.double({ min: -100, max: 100, noNaN: true }),
);

/** Array of 1–5 globe positions */
const arbGlobePositions: fc.Arbitrary<[number, number, number][]> = fc.array(
  arbPosition,
  { minLength: 1, maxLength: 5 },
);

/** Node count ∈ [1, 5000] */
const arbNodeCount = fc.integer({ min: 1, max: 5000 });

// ---------------------------------------------------------------------------
// Property 28: LOD Distance Calculation
// ---------------------------------------------------------------------------
describe("Property 28: LOD Distance Calculation", () => {
  it("computeLOD returns a valid LODState with level ∈ {far, medium, close} for ANY positive camera distance and globe radius", () => {
    fc.assert(
      fc.property(arbCameraDistance, arbGlobeRadius, (cameraDistance, globeRadius) => {
        const result: LODState = computeLOD(cameraDistance, globeRadius);

        // Level must be one of the three valid values
        expect(["far", "medium", "close"]).toContain(result.level);

        // Boolean fields must be actual booleans
        expect(typeof result.showFunctionLabels).toBe("boolean");
        expect(typeof result.showDirectedArcs).toBe("boolean");
        expect(typeof result.showFunctionBadges).toBe("boolean");
      }),
      { numRuns: 100 },
    );
  });

  it("computeMultiGlobeLOD returns exactly one GlobeLODState per globe for ANY array of 1–5 globe positions", () => {
    fc.assert(
      fc.property(
        arbGlobePositions,
        arbPosition,
        arbGlobeRadius,
        (globePositions, cameraPosition, globeRadius) => {
          const clusterIds = globePositions.map((_, i) => `globe-${i}`);
          const result = computeMultiGlobeLOD(
            globePositions,
            cameraPosition,
            globeRadius,
            clusterIds,
          );

          // Must return exactly one state per globe
          expect(result).toHaveLength(globePositions.length);

          // Each state must have a valid level and positive distance
          for (let i = 0; i < result.length; i++) {
            expect(["far", "medium", "close"]).toContain(result[i].level);
            expect(result[i].clusterId).toBe(clusterIds[i]);
            expect(result[i].cameraDistance).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(result[i].cameraDistance)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 29: LOD Level Transitions
// ---------------------------------------------------------------------------
describe("Property 29: LOD Level Transitions", () => {
  it("ratio > 3 MUST map to 'far'", () => {
    fc.assert(
      fc.property(
        // Generate ratio in (3.001, 100) range
        fc.double({ min: 3.001, max: 100, noNaN: true }),
        arbGlobeRadius,
        (ratio, globeRadius) => {
          const cameraDistance = ratio * globeRadius;
          const result = computeLOD(cameraDistance, globeRadius);
          expect(result.level).toBe("far");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("1.5 ≤ ratio ≤ 3 MUST map to 'medium'", () => {
    fc.assert(
      fc.property(
        // Generate ratio in [1.5, 3.0] range
        fc.double({ min: 1.5, max: 3.0, noNaN: true }),
        arbGlobeRadius,
        (ratio, globeRadius) => {
          const cameraDistance = ratio * globeRadius;
          const result = computeLOD(cameraDistance, globeRadius);
          expect(result.level).toBe("medium");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("ratio < 1.5 MUST map to 'close'", () => {
    fc.assert(
      fc.property(
        // Generate ratio in (0.001, 1.499) range
        fc.double({ min: 0.001, max: 1.499, noNaN: true }),
        arbGlobeRadius,
        (ratio, globeRadius) => {
          const cameraDistance = ratio * globeRadius;
          const result = computeLOD(cameraDistance, globeRadius);
          expect(result.level).toBe("close");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("boundary: ratio === 3.0 MUST be 'medium' (>= 1.5 condition)", () => {
    // Use globe radii that are exact in IEEE 754 to avoid floating-point
    // round-trip errors when computing (3.0 * r) / r.
    // Powers of 2 and simple fractions guarantee exact representation.
    const exactRadii = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 0.5, 0.25, 0.125, 0.0625];
    for (const globeRadius of exactRadii) {
      const cameraDistance = 3.0 * globeRadius;
      const result = computeLOD(cameraDistance, globeRadius);
      expect(result.level).toBe("medium");
    }
    // Additionally verify the logic directly: ratio === 3.0 is NOT > 3,
    // so it falls through to the >= 1.5 check which is true → "medium"
    // This confirms the production code's boundary semantics.
    fc.assert(
      fc.property(arbGlobeRadius, (globeRadius) => {
        // Compute the actual ratio the production code would see
        const cameraDistance = 3.0 * globeRadius;
        const ratio = cameraDistance / globeRadius;
        const result = computeLOD(cameraDistance, globeRadius);
        // If floating-point gives us exactly 3.0, it must be "medium"
        // If floating-point gives us slightly > 3.0, "far" is also correct behavior
        if (ratio <= 3) {
          expect(result.level).toBe("medium");
        } else {
          // Floating-point drift pushed ratio above 3.0 — "far" is correct
          expect(result.level).toBe("far");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("boundary: ratio === 1.5 MUST be 'medium' (>= 1.5 condition)", () => {
    // Use globe radii that are exact in IEEE 754 to avoid floating-point
    // round-trip errors when computing (1.5 * r) / r.
    const exactRadii = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 0.5, 0.25, 0.125, 0.0625];
    for (const globeRadius of exactRadii) {
      const cameraDistance = 1.5 * globeRadius;
      const result = computeLOD(cameraDistance, globeRadius);
      expect(result.level).toBe("medium");
    }
    // Property-based verification accounting for floating-point semantics
    fc.assert(
      fc.property(arbGlobeRadius, (globeRadius) => {
        const cameraDistance = 1.5 * globeRadius;
        const ratio = cameraDistance / globeRadius;
        const result = computeLOD(cameraDistance, globeRadius);
        // If floating-point gives us exactly >= 1.5, it must be "medium"
        // If floating-point gives us slightly < 1.5, "close" is also correct behavior
        if (ratio >= 1.5) {
          expect(result.level).toBe("medium");
        } else {
          // Floating-point drift pushed ratio below 1.5 — "close" is correct
          expect(result.level).toBe("close");
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 30: LOD Transition Animation Duration
// ---------------------------------------------------------------------------
describe("Property 30: LOD Transition Animation Duration", () => {
  it("the LOD transition animation duration constant is exactly 200ms", () => {
    // Validate the constant value
    expect(LOD_TRANSITION_DURATION_MS).toBe(200);
  });

  it("for ANY pair of different LOD levels, the same 200ms transition duration applies", () => {
    fc.assert(
      fc.property(
        // Generate two (cameraDistance, globeRadius) pairs that produce different LOD levels
        fc.tuple(arbCameraDistance, arbGlobeRadius),
        fc.tuple(arbCameraDistance, arbGlobeRadius),
        ([dist1, rad1], [dist2, rad2]) => {
          const lod1 = computeLOD(dist1, rad1);
          const lod2 = computeLOD(dist2, rad2);

          // Only assert when levels differ (transition occurs)
          if (lod1.level !== lod2.level) {
            // The transition duration is always the same constant
            expect(LOD_TRANSITION_DURATION_MS).toBe(200);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 31: Performance Warning Threshold
// ---------------------------------------------------------------------------
describe("Property 31: Performance Warning Threshold", () => {
  it("for ANY node count > threshold, the performance warning MUST be triggered", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: PERFORMANCE_WARNING_NODE_THRESHOLD + 1, max: 5000 }),
        (nodeCount) => {
          expect(shouldShowPerformanceWarning(nodeCount)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("for ANY node count ≤ threshold, no performance warning", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: PERFORMANCE_WARNING_NODE_THRESHOLD }),
        (nodeCount) => {
          expect(shouldShowPerformanceWarning(nodeCount)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("shouldShowPerformanceWarning(nodeCount) === (nodeCount > threshold) for ANY node count ∈ [1, 5000]", () => {
    fc.assert(
      fc.property(arbNodeCount, (nodeCount) => {
        expect(shouldShowPerformanceWarning(nodeCount)).toBe(
          nodeCount > PERFORMANCE_WARNING_NODE_THRESHOLD,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("boundary: exactly threshold nodes does NOT trigger warning", () => {
    expect(shouldShowPerformanceWarning(PERFORMANCE_WARNING_NODE_THRESHOLD)).toBe(false);
  });

  it("boundary: exactly threshold+1 nodes DOES trigger warning", () => {
    expect(shouldShowPerformanceWarning(PERFORMANCE_WARNING_NODE_THRESHOLD + 1)).toBe(true);
  });
});
