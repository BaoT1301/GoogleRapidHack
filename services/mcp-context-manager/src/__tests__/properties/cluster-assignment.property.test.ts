// Feature: 3d-codebase-globe-visualizer, Property 7: Longest Prefix Cluster Assignment
// Feature: 3d-codebase-globe-visualizer, Property 8: Default Cluster Fallback
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ClusterConfigLoader, type Cluster } from "../../cluster/cluster-config-loader.js";

// Arbitrary for a valid path segment (directory name)
const arbPathSegment = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,10}$/);

// Arbitrary for a valid hex color
const arbHexColor = fc
  .stringMatching(/^[0-9A-Fa-f]{6}$/)
  .map((h) => `#${h}`);

// Arbitrary for a valid cluster label
const arbLabel = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 _-]{0,20}$/);

describe("Property 7: Longest Prefix Cluster Assignment", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cluster-assign-"));
    configPath = path.join(tmpDir, "cluster-config.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should assign files to the cluster with the longest matching path prefix", () => {
    // Generate cluster configs with nested paths to test longest-prefix matching
    const arbClusterConfig = fc
      .tuple(
        // Base cluster: e.g., "services/"
        arbPathSegment,
        // Nested cluster: e.g., "services/mcp-context-manager/"
        arbPathSegment,
        // Two hex colors
        arbHexColor,
        arbHexColor,
        // Two labels
        arbLabel,
        arbLabel,
      )
      .map(([baseSeg, nestedSeg, color1, color2, label1, label2]) => ({
        basePath: `${baseSeg}/`,
        nestedPath: `${baseSeg}/${nestedSeg}/`,
        clusters: [
          { id: `cluster-base`, path: `${baseSeg}/`, label: label1, color: color1 },
          { id: `cluster-nested`, path: `${baseSeg}/${nestedSeg}/`, label: label2, color: color2 },
        ],
      }));

    fc.assert(
      fc.property(
        arbClusterConfig,
        arbPathSegment, // filename
        ({ basePath, nestedPath, clusters }, filename) => {
          // Write config
          fs.writeFileSync(configPath, JSON.stringify({ clusters }));
          const loader = new ClusterConfigLoader(configPath);

          // File in the nested path should match the nested cluster (longer prefix)
          const nestedFile = `${nestedPath}src/${filename}.ts`;
          const nestedResult = loader.getClusterForFile(nestedFile);
          expect(nestedResult.id).toBe("cluster-nested");
          expect(nestedResult.path).toBe(nestedPath);

          // File in the base path (but NOT in nested) should match the base cluster
          const baseFile = `${basePath}other/${filename}.ts`;
          const baseResult = loader.getClusterForFile(baseFile);
          expect(baseResult.id).toBe("cluster-base");
          expect(baseResult.path).toBe(basePath);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("should always return the cluster with the longest matching prefix among all clusters", () => {
    // Generate 2-5 clusters with varying path depths
    const arbMultiClusterConfig = fc
      .tuple(
        arbPathSegment,
        fc.array(arbPathSegment, { minLength: 1, maxLength: 3 }),
        fc.array(arbHexColor, { minLength: 4, maxLength: 4 }),
        fc.array(arbLabel, { minLength: 4, maxLength: 4 }),
      )
      .map(([root, segments, colors, labels]) => {
        // Build progressively deeper paths: root/, root/a/, root/a/b/, root/a/b/c/
        const paths: string[] = [];
        let current = `${root}/`;
        paths.push(current);
        for (const seg of segments) {
          current = `${current}${seg}/`;
          paths.push(current);
        }

        const clusters = paths.map((p, i) => ({
          id: `cluster-${i}`,
          path: p,
          label: labels[i] ?? `Cluster ${i}`,
          color: colors[i] ?? "#AAAAAA",
        }));

        return { clusters, paths };
      });

    fc.assert(
      fc.property(
        arbMultiClusterConfig,
        arbPathSegment,
        ({ clusters, paths }, filename) => {
          fs.writeFileSync(configPath, JSON.stringify({ clusters }));
          const loader = new ClusterConfigLoader(configPath);

          // For a file in the deepest path, the deepest cluster should match
          const deepestPath = paths[paths.length - 1];
          const deepFile = `${deepestPath}${filename}.py`;
          const result = loader.getClusterForFile(deepFile);

          // The result should be the cluster with the longest matching prefix
          const matchingClusters = clusters.filter(
            (c) => c.path && deepFile.startsWith(c.path),
          );
          const expectedCluster = matchingClusters.reduce((best, c) =>
            c.path.length > best.path.length ? c : best,
          );

          expect(result.id).toBe(expectedCluster.id);
          expect(result.path).toBe(expectedCluster.path);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property 8: Default Cluster Fallback", () => {
  let tmpDir: string;
  let configPath: string;

  const DEFAULT_CLUSTER: Cluster = {
    id: "root",
    path: "",
    label: "Root",
    color: "#4A90E2",
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cluster-fallback-"));
    configPath = path.join(tmpDir, "cluster-config.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return the default cluster for files that do not match any cluster prefix", () => {
    // Generate a config with specific cluster paths, then generate file paths
    // that are guaranteed NOT to match any of them
    const arbNonMatchingScenario = fc
      .tuple(
        // Cluster path segments (the clusters we define)
        fc.uniqueArray(arbPathSegment, { minLength: 1, maxLength: 3, comparator: (a, b) => a === b }),
        // Non-matching path segment (guaranteed different from all cluster segments)
        arbPathSegment,
        arbPathSegment, // filename
        fc.array(arbHexColor, { minLength: 3, maxLength: 3 }),
        fc.array(arbLabel, { minLength: 3, maxLength: 3 }),
      )
      .filter(([clusterSegs, nonMatchSeg]) => {
        // Ensure the non-matching segment doesn't start with any cluster segment
        return !clusterSegs.some(
          (seg) => nonMatchSeg.startsWith(seg) || seg.startsWith(nonMatchSeg),
        );
      })
      .map(([clusterSegs, nonMatchSeg, filename, colors, labels]) => {
        const clusters = clusterSegs.map((seg, i) => ({
          id: `cluster-${seg}`,
          path: `${seg}/`,
          label: labels[i] ?? `Cluster ${seg}`,
          color: colors[i] ?? "#BBBBBB",
        }));
        // File path that doesn't match any cluster
        const unmatchedFilePath = `${nonMatchSeg}/subdir/${filename}.py`;
        return { clusters, unmatchedFilePath };
      });

    fc.assert(
      fc.property(arbNonMatchingScenario, ({ clusters, unmatchedFilePath }) => {
        fs.writeFileSync(configPath, JSON.stringify({ clusters }));
        const loader = new ClusterConfigLoader(configPath);

        const result = loader.getClusterForFile(unmatchedFilePath);

        expect(result.id).toBe(DEFAULT_CLUSTER.id);
        expect(result.path).toBe(DEFAULT_CLUSTER.path);
        expect(result.label).toBe(DEFAULT_CLUSTER.label);
        expect(result.color).toBe(DEFAULT_CLUSTER.color);
      }),
      { numRuns: 100 },
    );
  });

  it("should return the default cluster for root-level files when all clusters have non-empty paths", () => {
    const arbRootFileScenario = fc
      .tuple(
        fc.uniqueArray(arbPathSegment, { minLength: 1, maxLength: 3, comparator: (a, b) => a === b }),
        arbPathSegment, // filename at root
        fc.array(arbHexColor, { minLength: 3, maxLength: 3 }),
        fc.array(arbLabel, { minLength: 3, maxLength: 3 }),
      )
      .map(([clusterSegs, filename, colors, labels]) => {
        const clusters = clusterSegs.map((seg, i) => ({
          id: `cluster-${seg}`,
          path: `${seg}/`,
          label: labels[i] ?? `Cluster ${seg}`,
          color: colors[i] ?? "#CCCCCC",
        }));
        // Root-level file — no directory prefix
        const rootFilePath = `${filename}.ts`;
        return { clusters, rootFilePath };
      });

    fc.assert(
      fc.property(arbRootFileScenario, ({ clusters, rootFilePath }) => {
        fs.writeFileSync(configPath, JSON.stringify({ clusters }));
        const loader = new ClusterConfigLoader(configPath);

        const result = loader.getClusterForFile(rootFilePath);

        expect(result.id).toBe(DEFAULT_CLUSTER.id);
        expect(result.path).toBe(DEFAULT_CLUSTER.path);
        expect(result.label).toBe(DEFAULT_CLUSTER.label);
        expect(result.color).toBe(DEFAULT_CLUSTER.color);
      }),
      { numRuns: 100 },
    );
  });
});
