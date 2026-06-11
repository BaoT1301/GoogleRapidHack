/**
 * Multi-Globe LOD Tests
 *
 * Tests the computeMultiGlobeLOD pure function with various camera distances
 * and globe positions.
 */

import { describe, it, expect } from "vitest";
import { computeMultiGlobeLOD } from "../hooks/use-multi-globe-lod";

const GLOBE_RADIUS = 2;

describe("computeMultiGlobeLOD", () => {
  it("returns 'far' when camera is far from all globes", () => {
    const positions: [number, number, number][] = [
      [5, 0, 0],
      [-5, 0, 0],
    ];
    const camera: [number, number, number] = [0, 0, 50]; // very far
    const clusterIds = ["backend", "frontend"];

    const result = computeMultiGlobeLOD(positions, camera, GLOBE_RADIUS, clusterIds);

    expect(result).toHaveLength(2);
    expect(result[0].level).toBe("far");
    expect(result[1].level).toBe("far");
    expect(result[0].clusterId).toBe("backend");
    expect(result[1].clusterId).toBe("frontend");
  });

  it("returns 'close' when camera is very near a globe", () => {
    const positions: [number, number, number][] = [[0, 0, 0]];
    const camera: [number, number, number] = [0, 0, 2]; // distance = 2, ratio = 1.0 < 1.5
    const clusterIds = ["backend"];

    const result = computeMultiGlobeLOD(positions, camera, GLOBE_RADIUS, clusterIds);

    expect(result[0].level).toBe("close");
    expect(result[0].cameraDistance).toBeCloseTo(2);
  });

  it("returns 'medium' when camera is at moderate distance", () => {
    const positions: [number, number, number][] = [[0, 0, 0]];
    // distance = 5, ratio = 5/2 = 2.5 → medium (1.5 ≤ 2.5 ≤ 3)
    const camera: [number, number, number] = [0, 0, 5];
    const clusterIds = ["backend"];

    const result = computeMultiGlobeLOD(positions, camera, GLOBE_RADIUS, clusterIds);

    expect(result[0].level).toBe("medium");
  });

  it("returns different LOD levels for globes at different distances", () => {
    const positions: [number, number, number][] = [
      [0, 0, 0],   // close to camera
      [20, 0, 0],  // far from camera
    ];
    const camera: [number, number, number] = [0, 0, 2]; // near first globe
    const clusterIds = ["near", "far"];

    const result = computeMultiGlobeLOD(positions, camera, GLOBE_RADIUS, clusterIds);

    expect(result[0].level).toBe("close"); // distance ≈ 2, ratio = 1.0
    expect(result[1].level).toBe("far");   // distance ≈ 20.1, ratio ≈ 10
  });

  it("handles zero globe radius gracefully", () => {
    const positions: [number, number, number][] = [[0, 0, 0]];
    const camera: [number, number, number] = [0, 0, 5];
    const clusterIds = ["test"];

    const result = computeMultiGlobeLOD(positions, camera, 0, clusterIds);

    // ratio = Infinity → far
    expect(result[0].level).toBe("far");
  });

  it("handles camera at exact globe center", () => {
    const positions: [number, number, number][] = [[5, 0, 0]];
    const camera: [number, number, number] = [5, 0, 0]; // same position
    const clusterIds = ["center"];

    const result = computeMultiGlobeLOD(positions, camera, GLOBE_RADIUS, clusterIds);

    expect(result[0].level).toBe("close");
    expect(result[0].cameraDistance).toBeCloseTo(0);
  });

  it("returns correct cameraDistance values", () => {
    const positions: [number, number, number][] = [[3, 4, 0]];
    const camera: [number, number, number] = [0, 0, 0];
    const clusterIds = ["test"];

    const result = computeMultiGlobeLOD(positions, camera, GLOBE_RADIUS, clusterIds);

    // distance = sqrt(9 + 16) = 5
    expect(result[0].cameraDistance).toBeCloseTo(5);
  });

  it("handles empty globe positions array", () => {
    const result = computeMultiGlobeLOD([], [0, 0, 15], GLOBE_RADIUS, []);
    expect(result).toHaveLength(0);
  });

  it("boundary: ratio exactly at 3R threshold", () => {
    const positions: [number, number, number][] = [[0, 0, 0]];
    // distance = 6, ratio = 6/2 = 3.0 → medium (>= 1.5 and <= 3)
    const camera: [number, number, number] = [0, 0, 6];
    const clusterIds = ["boundary"];

    const result = computeMultiGlobeLOD(positions, camera, GLOBE_RADIUS, clusterIds);

    expect(result[0].level).toBe("medium");
  });

  it("boundary: ratio just above 3R threshold", () => {
    const positions: [number, number, number][] = [[0, 0, 0]];
    // distance = 6.01, ratio = 6.01/2 = 3.005 → far (> 3)
    const camera: [number, number, number] = [0, 0, 6.01];
    const clusterIds = ["boundary"];

    const result = computeMultiGlobeLOD(positions, camera, GLOBE_RADIUS, clusterIds);

    expect(result[0].level).toBe("far");
  });

  it("boundary: ratio exactly at 1.5R threshold", () => {
    const positions: [number, number, number][] = [[0, 0, 0]];
    // distance = 3, ratio = 3/2 = 1.5 → medium (>= 1.5)
    const camera: [number, number, number] = [0, 0, 3];
    const clusterIds = ["boundary"];

    const result = computeMultiGlobeLOD(positions, camera, GLOBE_RADIUS, clusterIds);

    expect(result[0].level).toBe("medium");
  });

  it("boundary: ratio just below 1.5R threshold", () => {
    const positions: [number, number, number][] = [[0, 0, 0]];
    // distance = 2.99, ratio = 2.99/2 = 1.495 → close (< 1.5)
    const camera: [number, number, number] = [0, 0, 2.99];
    const clusterIds = ["boundary"];

    const result = computeMultiGlobeLOD(positions, camera, GLOBE_RADIUS, clusterIds);

    expect(result[0].level).toBe("close");
  });
});
