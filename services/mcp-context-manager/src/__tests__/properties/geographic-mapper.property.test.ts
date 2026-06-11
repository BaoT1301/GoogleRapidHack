// Feature: 3d-codebase-globe-visualizer, Property 9: Geographic Coordinate Bounds
// Feature: 3d-codebase-globe-visualizer, Property 10: Hierarchical Clustering
// Feature: 3d-codebase-globe-visualizer, Property 11: Sibling Folder Distribution
// Feature: 3d-codebase-globe-visualizer, Property 12: Deterministic Mapping

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { mapFileToCoordinates } from "../../geographic-mapper.js";

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * Generates a valid path segment: 1–12 alphanumeric characters (with underscores/hyphens).
 */
const arbSegment = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,11}$/);

/**
 * Generates a file name with extension.
 */
const arbFileName = fc
  .tuple(arbSegment, fc.constantFrom(".ts", ".py", ".js", ".rs", ".go", ".md"))
  .map(([name, ext]) => name + ext);

/**
 * Generates a relative file path with 1–6 segments (folders + file name).
 */
const arbRelativeFilePath = fc
  .tuple(
    fc.array(arbSegment, { minLength: 0, maxLength: 5 }),
    arbFileName,
  )
  .map(([folders, file]) => [...folders, file].join("/"));

/**
 * Generates a cluster path (a prefix ending with "/").
 */
const arbClusterPath = fc
  .array(arbSegment, { minLength: 1, maxLength: 3 })
  .map((segments) => segments.join("/") + "/");

/**
 * Generates a set of 1–50 sibling files sharing the same cluster prefix.
 */
const arbFileSet = fc
  .tuple(
    arbClusterPath,
    fc.array(arbRelativeFilePath, { minLength: 1, maxLength: 50 }),
  )
  .map(([cluster, relativePaths]) => ({
    clusterPath: cluster,
    filePaths: relativePaths.map((rp) => cluster + rp),
  }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function euclideanDistance(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  return Math.sqrt((a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2);
}

// ─── Property 9: Geographic Coordinate Bounds ─────────────────────────────────

describe("Property 9: Geographic Coordinate Bounds", () => {
  it("should return lat ∈ [-90, 90] and lng ∈ [-180, 180] for ANY generated file path within ANY cluster", () => {
    fc.assert(
      fc.property(arbFileSet, ({ clusterPath, filePaths }) => {
        for (const filePath of filePaths) {
          const coords = mapFileToCoordinates(filePath, clusterPath, filePaths);
          expect(coords.lat).toBeGreaterThanOrEqual(-90);
          expect(coords.lat).toBeLessThanOrEqual(90);
          expect(coords.lng).toBeGreaterThanOrEqual(-180);
          expect(coords.lng).toBeLessThanOrEqual(180);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("should return valid bounds for single-file clusters", () => {
    fc.assert(
      fc.property(arbClusterPath, arbRelativeFilePath, (clusterPath, relativePath) => {
        const filePath = clusterPath + relativePath;
        const coords = mapFileToCoordinates(filePath, clusterPath, [filePath]);
        expect(coords.lat).toBeGreaterThanOrEqual(-90);
        expect(coords.lat).toBeLessThanOrEqual(90);
        expect(coords.lng).toBeGreaterThanOrEqual(-180);
        expect(coords.lng).toBeLessThanOrEqual(180);
      }),
      { numRuns: 100 },
    );
  });

  it("should return valid bounds for deeply nested paths (up to 6 segments)", () => {
    const arbDeepPath = fc
      .array(arbSegment, { minLength: 4, maxLength: 6 })
      .chain((folders) =>
        arbFileName.map((file) => [...folders, file].join("/")),
      );

    fc.assert(
      fc.property(arbClusterPath, arbDeepPath, (clusterPath, deepRelative) => {
        const filePath = clusterPath + deepRelative;
        const coords = mapFileToCoordinates(filePath, clusterPath, [filePath]);
        expect(coords.lat).toBeGreaterThanOrEqual(-90);
        expect(coords.lat).toBeLessThanOrEqual(90);
        expect(coords.lng).toBeGreaterThanOrEqual(-180);
        expect(coords.lng).toBeLessThanOrEqual(180);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 10: Hierarchical Clustering ─────────────────────────────────────

describe("Property 10: Hierarchical Clustering", () => {
  it("should place files in the same folder closer than files in a different sibling folder", () => {
    // The geographic mapper recursively subdivides: lat at even depths, lng at odd.
    // For the Euclidean distance property to hold, same-folder files must share
    // enough hierarchy levels to be subdivided on BOTH axes, making their region
    // smaller than the cross-folder lat/lng gap.
    //
    // Strategy: Generate a structure where:
    //   - sameFolder1 and sameFolder2 share a path like: topFolder/subFolder/file
    //     (subdivided at depth 0 on lat, depth 1 on lng, depth 2 on lat again)
    //   - differentFolder is in a DIFFERENT top-level folder
    //   - There are multiple top-level siblings (so each gets a narrow lat band)
    //   - The shared subfolder has few siblings (so the lng subdivision is narrow)
    //
    // With ≥3 top-level folders and files sharing 2+ levels, the same-folder
    // region is guaranteed smaller than the cross-folder distance.
    const arbHierarchicalCluster = fc
      .tuple(
        arbClusterPath,
        // 3–5 unique top-level folder names (more folders = narrower lat bands)
        fc.array(arbSegment, { minLength: 3, maxLength: 5 }).filter((folders) => {
          return new Set(folders).size === folders.length;
        }),
        // Subfolder name for the "same folder" pair
        arbSegment,
        // 2 unique file names within the subfolder (exactly 2 ensures max within-folder
        // distance is half the folder's lat range, always < inter-folder distance)
        fc.tuple(arbFileName, arbFileName).filter(([a, b]) => a !== b),
        // File for the different folder
        arbFileName,
        // Additional subfolder for the different folder (to match depth)
        arbSegment,
      )
      .map(([clusterPath, folders, subFolder, fileNamePair, diffFile, diffSub]) => {
        const allFiles: string[] = [];
        const [fileName1, fileName2] = fileNamePair;

        // Same-folder files: topFolder/subFolder/file (3 levels deep)
        allFiles.push(clusterPath + folders[0] + "/" + subFolder + "/" + fileName1);
        allFiles.push(clusterPath + folders[0] + "/" + subFolder + "/" + fileName2);

        // Different-folder file: differentTopFolder/diffSub/diffFile (also 3 levels)
        allFiles.push(clusterPath + folders[1] + "/" + diffSub + "/" + diffFile);

        // Additional top-level folders with one file each (for sibling context)
        for (let i = 2; i < folders.length; i++) {
          allFiles.push(clusterPath + folders[i] + "/" + diffSub + "/" + diffFile);
        }

        return {
          clusterPath,
          allFiles,
          sameFolder1: clusterPath + folders[0] + "/" + subFolder + "/" + fileName1,
          sameFolder2: clusterPath + folders[0] + "/" + subFolder + "/" + fileName2,
          differentFolder: clusterPath + folders[1] + "/" + diffSub + "/" + diffFile,
        };
      });

    fc.assert(
      fc.property(arbHierarchicalCluster, ({ clusterPath, allFiles, sameFolder1, sameFolder2, differentFolder }) => {
        const coords1 = mapFileToCoordinates(sameFolder1, clusterPath, allFiles);
        const coords2 = mapFileToCoordinates(sameFolder2, clusterPath, allFiles);
        const coords3 = mapFileToCoordinates(differentFolder, clusterPath, allFiles);

        const sameFolderDist = euclideanDistance(coords1, coords2);
        const diffFolderDist = euclideanDistance(coords1, coords3);

        // Files sharing the same parent folder (subdivided on both axes)
        // should be closer together than files in a different top-level folder.
        expect(sameFolderDist).toBeLessThan(diffFolderDist);
      }),
      { numRuns: 50 }, // Reduced due to setup complexity
    );
  });
});

// ─── Property 11: Sibling Folder Distribution ─────────────────────────────────

describe("Property 11: Sibling Folder Distribution", () => {
  it("should assign non-overlapping coordinate regions to sibling folders", () => {
    // Generate 2–8 sibling folders under a common parent, each with at least 1 file
    const arbSiblingFolders = fc
      .tuple(
        arbClusterPath,
        fc.array(arbSegment, { minLength: 2, maxLength: 8 }).filter((folders) => {
          return new Set(folders).size === folders.length;
        }),
        fc.array(arbFileName, { minLength: 1, maxLength: 4 }),
      )
      .map(([clusterPath, folders, fileNames]) => {
        const allFiles: string[] = [];
        const folderFiles: Map<string, string[]> = new Map();

        for (const folder of folders) {
          const files: string[] = [];
          for (const file of fileNames) {
            const fp = clusterPath + folder + "/" + file;
            files.push(fp);
            allFiles.push(fp);
          }
          folderFiles.set(folder, files);
        }

        return { clusterPath, folders, allFiles, folderFiles };
      });

    fc.assert(
      fc.property(arbSiblingFolders, ({ clusterPath, folders, allFiles, folderFiles }) => {
        // The sibling folders are at depth 0 relative to the cluster,
        // so they split on latitude (even depth = lat split).
        // Compute the lat range for each sibling folder.
        const folderRanges: Array<{ folder: string; latMin: number; latMax: number }> = [];

        for (const folder of folders) {
          const files = folderFiles.get(folder)!;
          let minLat = Infinity;
          let maxLat = -Infinity;

          for (const file of files) {
            const coords = mapFileToCoordinates(file, clusterPath, allFiles);
            minLat = Math.min(minLat, coords.lat);
            maxLat = Math.max(maxLat, coords.lat);
          }

          folderRanges.push({ folder, latMin: minLat, latMax: maxLat });
        }

        // Sort by latMin for overlap checking
        folderRanges.sort((a, b) => a.latMin - b.latMin);

        // Check no overlaps: each folder's latMin should be >= previous folder's latMax
        for (let i = 1; i < folderRanges.length; i++) {
          const prev = folderRanges[i - 1];
          const curr = folderRanges[i];
          // Allow floating point tolerance
          expect(curr.latMin).toBeGreaterThanOrEqual(prev.latMax - 1e-10);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 12: Deterministic Mapping ───────────────────────────────────────

describe("Property 12: Deterministic Mapping", () => {
  it("should return identical coordinates for identical inputs across 5 calls", () => {
    fc.assert(
      fc.property(arbFileSet, ({ clusterPath, filePaths }) => {
        // Pick the first file for determinism testing
        const filePath = filePaths[0];

        const first = mapFileToCoordinates(filePath, clusterPath, filePaths);

        for (let i = 0; i < 4; i++) {
          const result = mapFileToCoordinates(filePath, clusterPath, filePaths);
          expect(result.lat).toBe(first.lat);
          expect(result.lng).toBe(first.lng);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("should be deterministic regardless of which file in the set is queried", () => {
    fc.assert(
      fc.property(arbFileSet, ({ clusterPath, filePaths }) => {
        // Test every file in the set
        for (const filePath of filePaths) {
          const first = mapFileToCoordinates(filePath, clusterPath, filePaths);
          const second = mapFileToCoordinates(filePath, clusterPath, filePaths);
          expect(first.lat).toBe(second.lat);
          expect(first.lng).toBe(second.lng);
        }
      }),
      { numRuns: 100 },
    );
  });
});
