import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ClusterConfigLoader } from "../cluster/cluster-config-loader.js";

describe("ClusterConfigLoader", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cluster-test-"));
    configPath = path.join(tmpDir, "cluster-config.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const validConfig = {
    clusters: [
      { id: "backend", path: "backend/", label: "Backend Services", color: "#4A90E2" },
      { id: "frontend", path: "frontend/", label: "Frontend Application", color: "#E24A4A" },
      { id: "mcp-services", path: "services/", label: "MCP Services", color: "#4AE290" },
    ],
  };

  // Property 1: Round-trip — valid config → parse → serialize matches original
  describe("Property 1: round-trip", () => {
    it("should parse and return clusters matching the original config", () => {
      fs.writeFileSync(configPath, JSON.stringify(validConfig, null, 2));
      const loader = new ClusterConfigLoader(configPath);
      const clusters = loader.getClusters();

      expect(clusters).toHaveLength(3);
      expect(clusters[0]).toEqual(validConfig.clusters[0]);
      expect(clusters[1]).toEqual(validConfig.clusters[1]);
      expect(clusters[2]).toEqual(validConfig.clusters[2]);
    });

    it("should serialize back to the same structure", () => {
      fs.writeFileSync(configPath, JSON.stringify(validConfig, null, 2));
      const loader = new ClusterConfigLoader(configPath);
      const clusters = loader.getClusters();
      const roundTripped = { clusters };
      expect(roundTripped).toEqual(validConfig);
    });
  });

  // Property 4: Relative paths — all cluster paths are relative
  describe("Property 4: relative paths", () => {
    it("should reject absolute paths", () => {
      const badConfig = {
        clusters: [
          { id: "bad", path: "/absolute/path/", label: "Bad", color: "#FF0000" },
        ],
      };
      fs.writeFileSync(configPath, JSON.stringify(badConfig));
      const loader = new ClusterConfigLoader(configPath);
      const clusters = loader.getClusters();

      // Should fall back to default since absolute path is rejected
      expect(clusters).toHaveLength(1);
      expect(clusters[0].id).toBe("root");
    });

    it("should accept relative paths", () => {
      fs.writeFileSync(configPath, JSON.stringify(validConfig));
      const loader = new ClusterConfigLoader(configPath);
      const clusters = loader.getClusters();

      for (const cluster of clusters) {
        expect(cluster.path.startsWith("/")).toBe(false);
      }
    });
  });

  // Property 63: Malformed config — invalid JSON returns error, falls back to default
  describe("Property 63: malformed config", () => {
    it("should fall back to default on invalid JSON", () => {
      fs.writeFileSync(configPath, "{ this is not valid json }}}");
      const loader = new ClusterConfigLoader(configPath);
      const clusters = loader.getClusters();

      expect(clusters).toHaveLength(1);
      expect(clusters[0].id).toBe("root");
      expect(clusters[0].path).toBe("");
      expect(clusters[0].label).toBe("Root");
      expect(clusters[0].color).toBe("#4A90E2");
    });

    it("should fall back to default on missing file", () => {
      const loader = new ClusterConfigLoader(path.join(tmpDir, "nonexistent.json"));
      const clusters = loader.getClusters();

      expect(clusters).toHaveLength(1);
      expect(clusters[0].id).toBe("root");
    });

    it("should fall back to default on empty clusters array", () => {
      fs.writeFileSync(configPath, JSON.stringify({ clusters: [] }));
      const loader = new ClusterConfigLoader(configPath);
      const clusters = loader.getClusters();

      expect(clusters).toHaveLength(1);
      expect(clusters[0].id).toBe("root");
    });

    it("should fall back to default on invalid color format", () => {
      const badConfig = {
        clusters: [
          { id: "bad", path: "bad/", label: "Bad", color: "not-a-color" },
        ],
      };
      fs.writeFileSync(configPath, JSON.stringify(badConfig));
      const loader = new ClusterConfigLoader(configPath);
      const clusters = loader.getClusters();

      expect(clusters).toHaveLength(1);
      expect(clusters[0].id).toBe("root");
    });

    it("should fall back to default on missing required fields", () => {
      const badConfig = {
        clusters: [
          { id: "missing-label", path: "test/" },
        ],
      };
      fs.writeFileSync(configPath, JSON.stringify(badConfig));
      const loader = new ClusterConfigLoader(configPath);
      const clusters = loader.getClusters();

      expect(clusters).toHaveLength(1);
      expect(clusters[0].id).toBe("root");
    });
  });

  // Cluster assignment: longest prefix matching
  describe("getClusterForFile", () => {
    it("should assign file to cluster with longest matching path prefix", () => {
      fs.writeFileSync(configPath, JSON.stringify(validConfig));
      const loader = new ClusterConfigLoader(configPath);

      const cluster = loader.getClusterForFile("backend/app/main.py");
      expect(cluster.id).toBe("backend");
    });

    it("should assign services files to mcp-services cluster", () => {
      fs.writeFileSync(configPath, JSON.stringify(validConfig));
      const loader = new ClusterConfigLoader(configPath);

      const cluster = loader.getClusterForFile("services/mcp-context-manager/src/api.ts");
      expect(cluster.id).toBe("mcp-services");
    });

    it("should assign frontend files to frontend cluster", () => {
      fs.writeFileSync(configPath, JSON.stringify(validConfig));
      const loader = new ClusterConfigLoader(configPath);

      const cluster = loader.getClusterForFile("frontend/src/App.tsx");
      expect(cluster.id).toBe("frontend");
    });

    it("should fall back to default cluster for unmatched files", () => {
      fs.writeFileSync(configPath, JSON.stringify(validConfig));
      const loader = new ClusterConfigLoader(configPath);

      const cluster = loader.getClusterForFile("docs/README.md");
      expect(cluster.id).toBe("root");
    });

    it("should handle nested cluster paths with longest prefix match", () => {
      const nestedConfig = {
        clusters: [
          { id: "services", path: "services/", label: "Services", color: "#111111" },
          { id: "mcp-mgr", path: "services/mcp-context-manager/", label: "MCP Manager", color: "#222222" },
        ],
      };
      fs.writeFileSync(configPath, JSON.stringify(nestedConfig));
      const loader = new ClusterConfigLoader(configPath);

      const cluster = loader.getClusterForFile("services/mcp-context-manager/src/api.ts");
      expect(cluster.id).toBe("mcp-mgr");
    });
  });

  // getClusters returns a copy (immutability)
  describe("immutability", () => {
    it("should return a copy of clusters, not the internal array", () => {
      fs.writeFileSync(configPath, JSON.stringify(validConfig));
      const loader = new ClusterConfigLoader(configPath);

      const clusters1 = loader.getClusters();
      const clusters2 = loader.getClusters();
      expect(clusters1).not.toBe(clusters2);
      expect(clusters1).toEqual(clusters2);
    });
  });
});
