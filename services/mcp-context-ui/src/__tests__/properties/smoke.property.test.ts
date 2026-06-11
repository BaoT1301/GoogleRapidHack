// Feature: 3d-codebase-globe-visualizer, Property Test Infrastructure Smoke Test
/**
 * Smoke test validating that fast-check integrates correctly with the
 * vitest + jsdom test environment. Generates GlobeNode instances and
 * asserts geographic coordinate invariants.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { arbGlobeNode } from "./_arbitraries";

describe("Property Test Infrastructure — Smoke Test", () => {
  it("generated GlobeNode lat is within [-90, 90] and lng is within [-180, 180]", () => {
    fc.assert(
      fc.property(arbGlobeNode, (node) => {
        expect(node.lat).toBeGreaterThanOrEqual(-90);
        expect(node.lat).toBeLessThanOrEqual(90);
        expect(node.lng).toBeGreaterThanOrEqual(-180);
        expect(node.lng).toBeLessThanOrEqual(180);
      }),
      { numRuns: 100 },
    );
  });
});
