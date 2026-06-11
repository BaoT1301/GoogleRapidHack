import { describe, it, expect } from "vitest";
import { mapFileToCoordinates } from "../geographic-mapper.js";

describe("mapFileToCoordinates", () => {
  const sampleFiles = [
    "backend/app/main.py",
    "backend/app/config.py",
    "backend/app/auth.py",
    "backend/app/models/user.py",
    "backend/app/models/job.py",
    "backend/app/routers/auth.py",
    "backend/app/routers/jobs.py",
    "backend/tests/test_main.py",
    "backend/tests/test_auth.py",
  ];

  // Property 9: Coordinate bounds — lat ∈ [-90, 90] and lng ∈ [-180, 180]
  describe("Property 9: coordinate bounds", () => {
    it("should produce lat within [-90, 90] for all files", () => {
      for (const file of sampleFiles) {
        const coords = mapFileToCoordinates(file, "backend/", sampleFiles);
        expect(coords.lat).toBeGreaterThanOrEqual(-90);
        expect(coords.lat).toBeLessThanOrEqual(90);
      }
    });

    it("should produce lng within [-180, 180] for all files", () => {
      for (const file of sampleFiles) {
        const coords = mapFileToCoordinates(file, "backend/", sampleFiles);
        expect(coords.lng).toBeGreaterThanOrEqual(-180);
        expect(coords.lng).toBeLessThanOrEqual(180);
      }
    });

    it("should handle edge case: single file", () => {
      const coords = mapFileToCoordinates("backend/solo.py", "backend/", ["backend/solo.py"]);
      expect(coords.lat).toBeGreaterThanOrEqual(-90);
      expect(coords.lat).toBeLessThanOrEqual(90);
      expect(coords.lng).toBeGreaterThanOrEqual(-180);
      expect(coords.lng).toBeLessThanOrEqual(180);
    });

    it("should handle edge case: deeply nested file", () => {
      const deepFile = "backend/a/b/c/d/e/f/g/h/deep.py";
      const files = [deepFile, "backend/a/b/c/other.py"];
      const coords = mapFileToCoordinates(deepFile, "backend/", files);
      expect(coords.lat).toBeGreaterThanOrEqual(-90);
      expect(coords.lat).toBeLessThanOrEqual(90);
      expect(coords.lng).toBeGreaterThanOrEqual(-180);
      expect(coords.lng).toBeLessThanOrEqual(180);
    });

    it("should handle edge case: empty cluster path", () => {
      const coords = mapFileToCoordinates("main.py", "", ["main.py", "config.py"]);
      expect(coords.lat).toBeGreaterThanOrEqual(-90);
      expect(coords.lat).toBeLessThanOrEqual(90);
      expect(coords.lng).toBeGreaterThanOrEqual(-180);
      expect(coords.lng).toBeLessThanOrEqual(180);
    });
  });

  // Property 12: Deterministic mapping — same input → same output
  describe("Property 12: deterministic mapping", () => {
    it("should return identical coordinates for the same file path", () => {
      const file = "backend/app/main.py";
      const coords1 = mapFileToCoordinates(file, "backend/", sampleFiles);
      const coords2 = mapFileToCoordinates(file, "backend/", sampleFiles);
      expect(coords1.lat).toBe(coords2.lat);
      expect(coords1.lng).toBe(coords2.lng);
    });

    it("should return identical coordinates across 100 calls", () => {
      const file = "backend/app/models/user.py";
      const first = mapFileToCoordinates(file, "backend/", sampleFiles);
      for (let i = 0; i < 100; i++) {
        const coords = mapFileToCoordinates(file, "backend/", sampleFiles);
        expect(coords.lat).toBe(first.lat);
        expect(coords.lng).toBe(first.lng);
      }
    });
  });

  // Property 10: Hierarchical clustering — files in same folder are closer
  describe("Property 10: hierarchical clustering", () => {
    it("should place files in the same folder closer than files in different folders", () => {
      const mainCoords = mapFileToCoordinates("backend/app/main.py", "backend/", sampleFiles);
      const configCoords = mapFileToCoordinates("backend/app/config.py", "backend/", sampleFiles);
      const testMainCoords = mapFileToCoordinates("backend/tests/test_main.py", "backend/", sampleFiles);

      // Distance between files in same folder (app/)
      const sameFolderDist = Math.sqrt(
        (mainCoords.lat - configCoords.lat) ** 2 + (mainCoords.lng - configCoords.lng) ** 2,
      );

      // Distance between files in different folders (app/ vs tests/)
      const diffFolderDist = Math.sqrt(
        (mainCoords.lat - testMainCoords.lat) ** 2 + (mainCoords.lng - testMainCoords.lng) ** 2,
      );

      expect(sameFolderDist).toBeLessThan(diffFolderDist);
    });

    it("should place sibling files in the same subfolder closer than files in different subfolders", () => {
      const userCoords = mapFileToCoordinates("backend/app/models/user.py", "backend/", sampleFiles);
      const jobCoords = mapFileToCoordinates("backend/app/models/job.py", "backend/", sampleFiles);
      const routerAuthCoords = mapFileToCoordinates("backend/app/routers/auth.py", "backend/", sampleFiles);

      // Distance between files in same subfolder (models/)
      const sameSubDist = Math.sqrt(
        (userCoords.lat - jobCoords.lat) ** 2 + (userCoords.lng - jobCoords.lng) ** 2,
      );

      // Distance between files in different subfolders (models/ vs routers/)
      const diffSubDist = Math.sqrt(
        (userCoords.lat - routerAuthCoords.lat) ** 2 + (userCoords.lng - routerAuthCoords.lng) ** 2,
      );

      expect(sameSubDist).toBeLessThan(diffSubDist);
    });
  });

  // Additional: different files get different coordinates
  describe("uniqueness", () => {
    it("should produce different coordinates for different files", () => {
      const coords = sampleFiles.map((f) => mapFileToCoordinates(f, "backend/", sampleFiles));
      const coordStrings = coords.map((c) => `${c.lat},${c.lng}`);
      const unique = new Set(coordStrings);
      expect(unique.size).toBe(sampleFiles.length);
    });
  });
});
