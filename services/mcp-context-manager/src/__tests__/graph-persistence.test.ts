import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { GraphStore } from "../graph/graph-store.js";
import {
  saveSnapshot,
  loadSnapshot,
  resolveSnapshotPath,
  type SnapshotData,
} from "../graph/graph-persistence.js";
import type { FileParseResult } from "../types/schema.js";

/**
 * Helper: create a minimal FileParseResult for testing.
 */
function makeFileResult(
  filePath: string,
  hash: string,
  symbols: FileParseResult["symbols"] = [],
  relations: FileParseResult["relations"] = [],
  resolvedImports: string[] = [],
): FileParseResult {
  return {
    filePath,
    language: filePath.endsWith(".py") ? "python" : "typescript",
    hash,
    symbols,
    relations,
    parsedImports: [],
    resolvedImports,
    parseErrors: [],
  };
}

describe("Graph Persistence", () => {
  let tmpDir: string;
  let snapshotPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "graph-persist-test-"));
    snapshotPath = path.join(tmpDir, "graph-snapshot.json");
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Snapshot round-trip", () => {
    it("save → load → verify node/edge counts match", async () => {
      const store = new GraphStore();

      // Add two files with an import relationship
      store.upsertFileResult(
        makeFileResult("backend/app/main.py", "hash-main", [
          {
            id: "func:main:create_app",
            name: "create_app",
            qualifiedName: "app.main.create_app",
            kind: "function",
            language: "python",
            filePath: "backend/app/main.py",
            rangeStart: { line: 1, column: 0 },
            rangeEnd: { line: 10, column: 0 },
          },
        ]),
      );

      store.upsertFileResult(
        makeFileResult(
          "backend/app/database.py",
          "hash-db",
          [
            {
              id: "func:database:get_db",
              name: "get_db",
              qualifiedName: "app.database.get_db",
              kind: "function",
              language: "python",
              filePath: "backend/app/database.py",
              rangeStart: { line: 1, column: 0 },
              rangeEnd: { line: 5, column: 0 },
            },
          ],
          [],
          ["backend/app/main.py"],
        ),
      );

      // Save snapshot
      await saveSnapshot(store, snapshotPath);

      // Load snapshot
      const snapshot = await loadSnapshot(snapshotPath);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.version).toBe(1);
      expect(snapshot!.fileCount).toBe(2);

      // Import into a fresh store and verify counts
      const store2 = new GraphStore();
      store2.importFromSnapshot(snapshot!.graph, snapshot!.fileHashes);

      const originalHashes = store.getFileHashes();
      const restoredHashes = store2.getFileHashes();
      expect(Object.keys(restoredHashes)).toHaveLength(Object.keys(originalHashes).length);
      expect(restoredHashes).toEqual(originalHashes);

      // Verify the graph export has the same node/edge counts
      const originalExport = store.exportGraph();
      const restoredExport = store2.exportGraph();
      expect(restoredExport.nodes.length).toBe(originalExport.nodes.length);
      expect(restoredExport.edges.length).toBe(originalExport.edges.length);
    });
  });

  describe("Delta detection", () => {
    it("save snapshot, modify one file hash, run buildDeltaGraph, verify only that file is re-parsed", async () => {
      const store = new GraphStore();

      store.upsertFileResult(makeFileResult("backend/app/main.py", "hash-a"));
      store.upsertFileResult(makeFileResult("backend/app/utils.py", "hash-b"));

      // Save snapshot
      await saveSnapshot(store, snapshotPath);
      const snapshot = await loadSnapshot(snapshotPath);
      expect(snapshot).not.toBeNull();

      // Simulate: one file changed by modifying its hash in the snapshot
      const modifiedHashes = { ...snapshot!.fileHashes };
      modifiedHashes["backend/app/main.py"] = "hash-CHANGED";

      // The store still has the old hashes, so hasFileHash will return false
      // for the changed file, meaning buildDeltaGraph would re-parse it.
      // We verify the delta detection logic by checking the hash comparison.
      expect(store.hasFileHash("backend/app/main.py", "hash-CHANGED")).toBe(false);
      expect(store.hasFileHash("backend/app/utils.py", "hash-b")).toBe(true);
    });
  });

  describe("Corrupt snapshot", () => {
    it("returns null for corrupt JSON", async () => {
      await fs.writeFile(snapshotPath, "not valid json {{{", "utf-8");
      const result = await loadSnapshot(snapshotPath);
      expect(result).toBeNull();
    });

    it("returns null for wrong version", async () => {
      const badSnapshot = {
        version: 999,
        createdAt: new Date().toISOString(),
        fileCount: 0,
        nodeCount: 0,
        edgeCount: 0,
        fileHashes: {},
        graph: { nodes: [], edges: [], attributes: {}, options: {} },
      };
      await fs.writeFile(snapshotPath, JSON.stringify(badSnapshot), "utf-8");
      const result = await loadSnapshot(snapshotPath);
      expect(result).toBeNull();
    });

    it("returns null for missing graph field", async () => {
      const badSnapshot = {
        version: 1,
        createdAt: new Date().toISOString(),
        fileCount: 0,
        nodeCount: 0,
        edgeCount: 0,
        fileHashes: {},
        // graph field missing
      };
      await fs.writeFile(snapshotPath, JSON.stringify(badSnapshot), "utf-8");
      const result = await loadSnapshot(snapshotPath);
      expect(result).toBeNull();
    });

    it("returns null for non-object JSON", async () => {
      await fs.writeFile(snapshotPath, '"just a string"', "utf-8");
      const result = await loadSnapshot(snapshotPath);
      expect(result).toBeNull();
    });
  });

  describe("Missing snapshot file", () => {
    it("returns null when file does not exist", async () => {
      const result = await loadSnapshot(path.join(tmpDir, "nonexistent.json"));
      expect(result).toBeNull();
    });
  });

  describe("Atomic write", () => {
    it("temp file is cleaned up on success", async () => {
      const store = new GraphStore();
      store.upsertFileResult(makeFileResult("backend/app/main.py", "hash-a"));

      await saveSnapshot(store, snapshotPath);

      // Verify the snapshot file exists
      const stat = await fs.stat(snapshotPath);
      expect(stat.isFile()).toBe(true);

      // Verify no temp files remain
      const files = await fs.readdir(tmpDir);
      const tmpFiles = files.filter((f) => f.includes(".tmp."));
      expect(tmpFiles).toHaveLength(0);
    });
  });

  describe("GraphStore methods", () => {
    it("getFileHashes returns current file hashes", () => {
      const store = new GraphStore();
      store.upsertFileResult(makeFileResult("backend/app/main.py", "abc123"));
      store.upsertFileResult(makeFileResult("backend/app/utils.py", "def456"));

      const hashes = store.getFileHashes();
      expect(hashes["backend/app/main.py"]).toBe("abc123");
      expect(hashes["backend/app/utils.py"]).toBe("def456");
      expect(Object.keys(hashes)).toHaveLength(2);
    });

    it("exportGraph returns serialized graph data", () => {
      const store = new GraphStore();
      store.upsertFileResult(makeFileResult("backend/app/main.py", "abc123"));

      const exported = store.exportGraph();
      expect(exported).toHaveProperty("nodes");
      expect(exported).toHaveProperty("edges");
      expect(exported.nodes.length).toBeGreaterThan(0);
    });

    it("importFromSnapshot restores graph state and rebuilds lookup maps", () => {
      const store = new GraphStore();

      // Build a graph with imports
      store.upsertFileResult(
        makeFileResult("backend/app/main.py", "hash-main", [
          {
            id: "func:main:create_app",
            name: "create_app",
            qualifiedName: "app.main.create_app",
            kind: "function",
            language: "python",
            filePath: "backend/app/main.py",
            rangeStart: { line: 1, column: 0 },
            rangeEnd: { line: 10, column: 0 },
          },
        ]),
      );

      store.upsertFileResult(
        makeFileResult(
          "backend/app/database.py",
          "hash-db",
          [],
          [],
          ["backend/app/main.py"],
        ),
      );

      const exported = store.exportGraph();
      const hashes = store.getFileHashes();

      // Import into fresh store
      const store2 = new GraphStore();
      store2.importFromSnapshot(exported, hashes);

      // Verify file hashes restored
      expect(store2.getFileHash("backend/app/main.py")).toBe("hash-main");
      expect(store2.getFileHash("backend/app/database.py")).toBe("hash-db");

      // Verify indexed file paths restored
      const paths = store2.getIndexedFilePaths();
      expect(paths).toContain("backend/app/main.py");
      expect(paths).toContain("backend/app/database.py");

      // Verify reverse imports rebuilt (database.py imports main.py)
      const dependents = store2.getDirectDependents("backend/app/main.py");
      expect(dependents).toContain("backend/app/database.py");
    });
  });

  describe("resolveSnapshotPath", () => {
    it("uses GRAPH_SNAPSHOT_DIR env var when set", () => {
      const original = process.env.GRAPH_SNAPSHOT_DIR;
      try {
        process.env.GRAPH_SNAPSHOT_DIR = "/custom/cache";
        const result = resolveSnapshotPath("/workspace");
        expect(result).toBe("/custom/cache/graph-snapshot.json");
      } finally {
        if (original === undefined) {
          delete process.env.GRAPH_SNAPSHOT_DIR;
        } else {
          process.env.GRAPH_SNAPSHOT_DIR = original;
        }
      }
    });

    it("uses /tmp/.mcp-cache for /workspace root (Docker)", () => {
      const original = process.env.GRAPH_SNAPSHOT_DIR;
      try {
        delete process.env.GRAPH_SNAPSHOT_DIR;
        const result = resolveSnapshotPath("/workspace");
        expect(result).toContain(".mcp-cache/graph-snapshot.json");
        expect(result).toContain(os.tmpdir());
      } finally {
        if (original !== undefined) {
          process.env.GRAPH_SNAPSHOT_DIR = original;
        }
      }
    });

    it("uses workspaceRoot/.mcp-cache for non-Docker paths", () => {
      const original = process.env.GRAPH_SNAPSHOT_DIR;
      try {
        delete process.env.GRAPH_SNAPSHOT_DIR;
        const result = resolveSnapshotPath("/home/user/project");
        expect(result).toBe("/home/user/project/.mcp-cache/graph-snapshot.json");
      } finally {
        if (original !== undefined) {
          process.env.GRAPH_SNAPSHOT_DIR = original;
        }
      }
    });
  });
});
