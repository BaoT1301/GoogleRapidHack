/**
 * Globe Interactions Property Tests (Properties 35–38)
 *
 * Validates globe drag position updates, collision prevention,
 * cross-globe arc real-time updates (latLngToWorld), and globe
 * position persistence to localStorage.
 *
 * Feature: 3d-codebase-globe-visualizer
 * Sprint: 6 — Property-Based Testing Batch 4
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import {
  applyDragDelta,
  detectCollision,
  latLngToWorld,
  savePositions,
  loadPersistedPositions,
  GLOBE_RADIUS,
  STORAGE_KEY,
} from "../../components/mcp/globe-physics-utils";
import type { GlobePosition } from "../../types/globe-r3f";

// ---------------------------------------------------------------------------
// Shared Arbitraries
// ---------------------------------------------------------------------------

/** Generates a non-empty lowercase identifier for cluster IDs. */
const arbClusterId = fc.stringMatching(/^[a-z][a-z0-9\-]{0,19}$/);

/** Generates a valid GlobePosition with arbitrary coordinates. */
const arbGlobePosition: fc.Arbitrary<GlobePosition> = fc.record({
  clusterId: arbClusterId,
  x: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
  y: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
  z: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
});

/** Generates an array of 1–5 GlobePositions with unique cluster IDs. */
const arbPositionsArray: fc.Arbitrary<GlobePosition[]> = fc
  .array(arbGlobePosition, { minLength: 1, maxLength: 5 })
  .map((positions) => {
    // Ensure unique cluster IDs
    const seen = new Set<string>();
    return positions
      .filter((p) => {
        if (seen.has(p.clusterId)) return false;
        seen.add(p.clusterId);
        return true;
      });
  })
  .filter((positions) => positions.length >= 1);

// ---------------------------------------------------------------------------
// Property 35: Globe Drag Position Update
// ---------------------------------------------------------------------------
describe("Property 35: Globe Drag Position Update", () => {
  it("applying drag delta updates only the dragged globe's x and z", () => {
    fc.assert(
      fc.property(
        arbPositionsArray,
        fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
        (positions, dx, dz) => {
          // Pick a random valid drag index
          const dragIndex = positions.length > 1
            ? Math.floor(Math.random() * positions.length)
            : 0;

          const result = applyDragDelta(positions, dragIndex, dx, dz);

          // The dragged globe's x and z are updated correctly
          expect(result[dragIndex].x).toBeCloseTo(positions[dragIndex].x + dx, 10);
          expect(result[dragIndex].z).toBeCloseTo(positions[dragIndex].z + dz, 10);

          // The dragged globe's y and clusterId remain unchanged
          expect(result[dragIndex].y).toBe(positions[dragIndex].y);
          expect(result[dragIndex].clusterId).toBe(positions[dragIndex].clusterId);

          // All other positions remain completely unchanged
          for (let i = 0; i < positions.length; i++) {
            if (i === dragIndex) continue;
            expect(result[i]).toEqual(positions[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("drag delta of zero produces identical positions", () => {
    fc.assert(
      fc.property(arbPositionsArray, (positions) => {
        const dragIndex = 0;
        const result = applyDragDelta(positions, dragIndex, 0, 0);

        // All positions should be value-equal to originals
        // Use toBeCloseTo to handle -0 vs +0 edge case in floating point
        for (let i = 0; i < positions.length; i++) {
          expect(result[i].x).toBeCloseTo(positions[i].x, 10);
          expect(result[i].y).toBeCloseTo(positions[i].y, 10);
          expect(result[i].z).toBeCloseTo(positions[i].z, 10);
          expect(result[i].clusterId).toBe(positions[i].clusterId);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 36: Globe Collision Prevention
// ---------------------------------------------------------------------------
describe("Property 36: Globe Collision Prevention", () => {
  it("detects collision when globes overlap (distance < 2 * GLOBE_RADIUS)", () => {
    fc.assert(
      fc.property(
        // Generate 2–5 positions where at least one pair overlaps
        fc.integer({ min: 2, max: 5 }),
        fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
        (count, baseX, baseY, baseZ) => {
          // Create positions where the first two are intentionally overlapping
          const positions: GlobePosition[] = [];
          positions.push({ clusterId: "cluster-0", x: baseX, y: baseY, z: baseZ });
          // Place second globe within collision distance (< 2 * GLOBE_RADIUS = 4)
          const offset = GLOBE_RADIUS * 0.5; // Well within collision range
          positions.push({ clusterId: "cluster-1", x: baseX + offset, y: baseY, z: baseZ });

          // Add remaining globes far away
          for (let i = 2; i < count; i++) {
            positions.push({
              clusterId: `cluster-${i}`,
              x: baseX + 100 * i,
              y: baseY + 100 * i,
              z: baseZ + 100 * i,
            });
          }

          expect(detectCollision(positions, GLOBE_RADIUS)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns false when all globes are sufficiently separated", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        (count) => {
          // Place globes in a line with spacing > 2 * GLOBE_RADIUS
          const spacing = 2 * GLOBE_RADIUS + 1; // Guaranteed no collision
          const positions: GlobePosition[] = [];
          for (let i = 0; i < count; i++) {
            positions.push({
              clusterId: `cluster-${i}`,
              x: i * spacing,
              y: 0,
              z: 0,
            });
          }

          expect(detectCollision(positions, GLOBE_RADIUS)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("single globe never has collision", () => {
    fc.assert(
      fc.property(arbGlobePosition, (pos) => {
        expect(detectCollision([pos], GLOBE_RADIUS)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 37: Cross-Globe Arc Real-Time Update (latLngToWorld)
// ---------------------------------------------------------------------------
describe("Property 37: Cross-Globe Arc Real-Time Update", () => {
  it("returned world position is at exactly `radius` distance from globeCenter", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true }),
        fc.tuple(
          fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
        ),
        (lat, lng, radius, globeCenter) => {
          const [wx, wy, wz] = latLngToWorld(lat, lng, radius, globeCenter);

          // Compute distance from globeCenter to the returned world position
          const distance = Math.sqrt(
            (wx - globeCenter[0]) ** 2 +
            (wy - globeCenter[1]) ** 2 +
            (wz - globeCenter[2]) ** 2,
          );

          // The point should be at exactly `radius` distance from center
          expect(distance).toBeCloseTo(radius, 5);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("lat=0, lng=0 places point at (center.x + radius, center.y, center.z)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true }),
        fc.tuple(
          fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
        ),
        (radius, globeCenter) => {
          const [wx, wy, wz] = latLngToWorld(0, 0, radius, globeCenter);

          // At lat=0, lng=0: cos(0)*cos(0)=1, sin(0)=0, cos(0)*sin(0)=0
          expect(wx).toBeCloseTo(globeCenter[0] + radius, 10);
          expect(wy).toBeCloseTo(globeCenter[1], 10);
          expect(wz).toBeCloseTo(globeCenter[2], 10);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 38: Globe Position Persistence
// ---------------------------------------------------------------------------
describe("Property 38: Globe Position Persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("savePositions/loadPersistedPositions round-trip preserves data", () => {
    fc.assert(
      fc.property(
        // Generate 1–5 positions with unique cluster IDs
        fc.array(
          fc.record({
            clusterId: arbClusterId,
            x: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
            y: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
            z: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
          }),
          { minLength: 1, maxLength: 5 },
        ).map((positions) => {
          const seen = new Set<string>();
          return positions.filter((p) => {
            if (seen.has(p.clusterId)) return false;
            seen.add(p.clusterId);
            return true;
          });
        }).filter((positions) => positions.length >= 1),
        (positions) => {
          const clusterIds = positions.map((p) => p.clusterId);

          // Save
          savePositions(positions);

          // Load
          const loaded = loadPersistedPositions(clusterIds);

          // Should deep-equal the saved positions
          expect(loaded).not.toBeNull();
          expect(loaded).toHaveLength(positions.length);
          for (let i = 0; i < positions.length; i++) {
            expect(loaded![i].clusterId).toBe(positions[i].clusterId);
            expect(loaded![i].x).toBeCloseTo(positions[i].x, 10);
            expect(loaded![i].y).toBeCloseTo(positions[i].y, 10);
            expect(loaded![i].z).toBeCloseTo(positions[i].z, 10);
          }

          // Clean up for next iteration
          localStorage.clear();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns null when localStorage contains invalid JSON", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => {
          try { JSON.parse(s); return false; } catch { return true; }
        }),
        fc.array(arbClusterId, { minLength: 1, maxLength: 5 }),
        (invalidJson, clusterIds) => {
          localStorage.setItem(STORAGE_KEY, invalidJson);
          const result = loadPersistedPositions(clusterIds);
          expect(result).toBeNull();
          localStorage.clear();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns null when localStorage is empty", () => {
    fc.assert(
      fc.property(
        fc.array(arbClusterId, { minLength: 1, maxLength: 5 }),
        (clusterIds) => {
          localStorage.clear();
          const result = loadPersistedPositions(clusterIds);
          expect(result).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns null when persisted cluster IDs don't match requested IDs", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            clusterId: arbClusterId,
            x: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
            y: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
            z: fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
          }),
          { minLength: 1, maxLength: 3 },
        ).map((positions) => {
          const seen = new Set<string>();
          return positions.filter((p) => {
            if (seen.has(p.clusterId)) return false;
            seen.add(p.clusterId);
            return true;
          });
        }).filter((positions) => positions.length >= 1),
        (positions) => {
          // Save positions
          savePositions(positions);

          // Try to load with different cluster IDs
          const differentIds = positions.map((p) => `different-${p.clusterId}`);
          const result = loadPersistedPositions(differentIds);
          expect(result).toBeNull();

          localStorage.clear();
        },
      ),
      { numRuns: 100 },
    );
  });
});
