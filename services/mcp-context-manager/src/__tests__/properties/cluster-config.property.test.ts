// Feature: 3d-codebase-globe-visualizer, Property 1: Cluster Configuration Round-Trip
// Feature: 3d-codebase-globe-visualizer, Property 2: Cluster Configuration Reload Responsiveness
// Feature: 3d-codebase-globe-visualizer, Property 3: Cluster API Consistency
// Feature: 3d-codebase-globe-visualizer, Property 4: Relative Path Validation

import { describe, it, expect, afterEach } from "vitest";
import fc from "fast-check";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ClusterConfigLoader } from "../../cluster/cluster-config-loader.js";
import type { Cluster } from "../../cluster/cluster-config-loader.js";

// ─── Shared Helpers ───────────────────────────────────────────────────────────

/** Create a temp directory for each test run and track for cleanup. */
const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prop-cluster-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * Generates a valid relative path segment: non-empty, no leading slash,
 * no backslash prefixes, only safe filesystem characters.
 */
const arbRelativePath = fc
  .array(
    fc.stringMatching(/^[a-zA-Z0-9_-]{1,12}$/),
    { minLength: 1, maxLength: 3 },
  )
  .map((segments) => segments.join("/") + "/");

/**
 * Generates a valid hex color string matching #RRGGBB.
 */
const arbHexColor = fc
  .stringMatching(/^[0-9A-Fa-f]{6}$/)
  .map((h) => "#" + h);

/**
 * Generates a valid cluster object with relative path.
 */
const arbCluster: fc.Arbitrary<Cluster> = fc.record({
  id: fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,15}$/),
  path: arbRelativePath,
  label: fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 _-]{0,20}$/),
  color: arbHexColor,
});

/**
 * Generates an array of 1–5 valid clusters with unique IDs.
 */
const arbClusterArray = fc
  .array(arbCluster, { minLength: 1, maxLength: 5 })
  .filter((clusters) => {
    const ids = clusters.map((c) => c.id);
    return new Set(ids).size === ids.length; // unique IDs
  });

// ─── Property 1: Cluster Configuration Round-Trip ─────────────────────────────

describe("Property 1: Cluster Configuration Round-Trip", () => {
  // Feature: 3d-codebase-globe-visualizer, Property 1: Cluster Configuration Round-Trip
  it("should round-trip: write config → load → getClusters() deeply equals input", () => {
    fc.assert(
      fc.property(arbClusterArray, (clusters) => {
        const tmpDir = makeTmpDir();
        const configPath = path.join(tmpDir, "cluster-config.json");
        const config = { clusters };

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        const loader = new ClusterConfigLoader(configPath);
        const loaded = loader.getClusters();

        expect(loaded).toEqual(clusters);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 2: Cluster Configuration Reload Responsiveness ──────────────────

describe("Property 2: Cluster Configuration Reload Responsiveness", () => {
  // Feature: 3d-codebase-globe-visualizer, Property 2: Cluster Configuration Reload Responsiveness
  it("should reload config within 500ms after file change", () => {
    fc.assert(
      fc.asyncProperty(arbClusterArray, arbClusterArray, async (initial, updated) => {
        // Skip if initial and updated are identical — nothing to detect
        if (JSON.stringify(initial) === JSON.stringify(updated)) return;

        const tmpDir = makeTmpDir();
        const configPath = path.join(tmpDir, "cluster-config.json");

        // Write initial config and create loader
        fs.writeFileSync(configPath, JSON.stringify({ clusters: initial }, null, 2));
        const loader = new ClusterConfigLoader(configPath);
        expect(loader.getClusters()).toEqual(initial);

        // Start watching
        await loader.startWatching();

        try {
          // Overwrite with updated config
          fs.writeFileSync(configPath, JSON.stringify({ clusters: updated }, null, 2));

          // Poll for up to 500ms (50ms intervals, max 10 iterations)
          let reloaded = false;
          for (let i = 0; i < 10; i++) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            const current = loader.getClusters();
            if (JSON.stringify(current) === JSON.stringify(updated)) {
              reloaded = true;
              break;
            }
          }

          expect(reloaded).toBe(true);
        } finally {
          await loader.stopWatching();
        }
      }),
      { numRuns: 10 }, // Timing-sensitive: fewer runs to avoid flakiness
    );
  });
});

// ─── Property 3: Cluster API Consistency ──────────────────────────────────────

describe("Property 3: Cluster API Consistency", () => {
  // Feature: 3d-codebase-globe-visualizer, Property 3: Cluster API Consistency
  it("should return clusters matching the API contract shape { id, path, label, color }", () => {
    fc.assert(
      fc.property(arbClusterArray, (clusters) => {
        const tmpDir = makeTmpDir();
        const configPath = path.join(tmpDir, "cluster-config.json");

        fs.writeFileSync(configPath, JSON.stringify({ clusters }, null, 2));
        const loader = new ClusterConfigLoader(configPath);

        // Simulate what handleGetClusters() does: getClusters() → map to { id, path, label, color }
        const apiOutput = loader.getClusters().map((c) => ({
          id: c.id,
          path: c.path,
          label: c.label,
          color: c.color,
        }));

        expect(apiOutput).toEqual(clusters);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4: Relative Path Validation ─────────────────────────────────────

describe("Property 4: Relative Path Validation", () => {
  // Feature: 3d-codebase-globe-visualizer, Property 4: Relative Path Validation

  const DEFAULT_CLUSTER: Cluster = {
    id: "root",
    path: "",
    label: "Root",
    color: "#4A90E2",
  };

  it("should load configs with all relative paths successfully", () => {
    fc.assert(
      fc.property(arbClusterArray, (clusters) => {
        const tmpDir = makeTmpDir();
        const configPath = path.join(tmpDir, "cluster-config.json");

        // All paths from arbClusterArray are relative (no leading /)
        fs.writeFileSync(configPath, JSON.stringify({ clusters }, null, 2));
        const loader = new ClusterConfigLoader(configPath);
        const loaded = loader.getClusters();

        // Should load successfully — not fall back to default
        expect(loaded).toEqual(clusters);
      }),
      { numRuns: 100 },
    );
  });

  it("should fall back to default when any path starts with /", () => {
    // Generate clusters where at least one has an absolute path starting with /
    const arbAbsolutePathCluster = fc.record({
      id: fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,15}$/),
      path: fc
        .stringMatching(/^[a-zA-Z0-9_/-]{1,20}$/)
        .map((p) => "/" + p + "/"),
      label: fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 _-]{0,20}$/),
      color: arbHexColor,
    });

    fc.assert(
      fc.property(arbAbsolutePathCluster, (badCluster) => {
        const tmpDir = makeTmpDir();
        const configPath = path.join(tmpDir, "cluster-config.json");

        const config = { clusters: [badCluster] };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        const loader = new ClusterConfigLoader(configPath);
        const loaded = loader.getClusters();

        // Should fall back to default
        expect(loaded).toEqual([DEFAULT_CLUSTER]);
      }),
      { numRuns: 100 },
    );
  });

  it("should fall back to default when config mixes relative and absolute paths", () => {
    fc.assert(
      fc.property(arbCluster, (validCluster) => {
        const tmpDir = makeTmpDir();
        const configPath = path.join(tmpDir, "cluster-config.json");

        // Create a config with one valid relative cluster and one absolute
        const absoluteCluster: Cluster = {
          id: validCluster.id + "_abs",
          path: "/absolute/" + validCluster.path,
          label: validCluster.label + " Abs",
          color: validCluster.color,
        };

        const config = { clusters: [validCluster, absoluteCluster] };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        const loader = new ClusterConfigLoader(configPath);
        const loaded = loader.getClusters();

        // Should fall back to default because one path is absolute
        expect(loaded).toEqual([DEFAULT_CLUSTER]);
      }),
      { numRuns: 100 },
    );
  });
});
