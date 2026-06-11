/**
 * Globe R3F Type Validation Tests
 *
 * Validates GlobePosition, GlobeLayoutState Zod schemas for runtime validation.
 */

import { describe, it, expect } from "vitest";
import { GlobePositionSchema, GlobeLayoutStateSchema } from "../types/globe-r3f";

describe("GlobePositionSchema", () => {
  it("accepts a valid globe position", () => {
    const result = GlobePositionSchema.parse({
      clusterId: "backend",
      x: 5.0,
      y: 0,
      z: -3.2,
    });
    expect(result.clusterId).toBe("backend");
    expect(result.x).toBe(5.0);
    expect(result.y).toBe(0);
    expect(result.z).toBe(-3.2);
  });

  it("rejects missing clusterId", () => {
    expect(() =>
      GlobePositionSchema.parse({ x: 1, y: 2, z: 3 }),
    ).toThrow();
  });

  it("rejects non-numeric coordinates", () => {
    expect(() =>
      GlobePositionSchema.parse({ clusterId: "a", x: "bad", y: 0, z: 0 }),
    ).toThrow();
  });

  it("accepts negative coordinates", () => {
    const result = GlobePositionSchema.parse({
      clusterId: "frontend",
      x: -10,
      y: -5,
      z: -1,
    });
    expect(result.x).toBe(-10);
  });

  it("accepts zero coordinates", () => {
    const result = GlobePositionSchema.parse({
      clusterId: "root",
      x: 0,
      y: 0,
      z: 0,
    });
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.z).toBe(0);
  });
});

describe("GlobeLayoutStateSchema", () => {
  it("accepts a valid layout state", () => {
    const result = GlobeLayoutStateSchema.parse({
      positions: [
        { clusterId: "backend", x: 5, y: 0, z: 0 },
        { clusterId: "frontend", x: -5, y: 0, z: 0 },
      ],
      savedAt: 1714500000000,
    });
    expect(result.positions).toHaveLength(2);
    expect(result.savedAt).toBe(1714500000000);
  });

  it("accepts empty positions array", () => {
    const result = GlobeLayoutStateSchema.parse({
      positions: [],
      savedAt: Date.now(),
    });
    expect(result.positions).toHaveLength(0);
  });

  it("rejects missing savedAt", () => {
    expect(() =>
      GlobeLayoutStateSchema.parse({
        positions: [{ clusterId: "a", x: 0, y: 0, z: 0 }],
      }),
    ).toThrow();
  });

  it("rejects invalid position in array", () => {
    expect(() =>
      GlobeLayoutStateSchema.parse({
        positions: [{ clusterId: "a", x: 0, y: 0 }], // missing z
        savedAt: 123,
      }),
    ).toThrow();
  });

  it("rejects non-array positions", () => {
    expect(() =>
      GlobeLayoutStateSchema.parse({
        positions: "not-an-array",
        savedAt: 123,
      }),
    ).toThrow();
  });
});
