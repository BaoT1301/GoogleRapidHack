import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import type { GraphStore } from "./graph-store.js";

/**
 * Snapshot metadata envelope wrapping the graphology serialized graph.
 */
export interface SnapshotData {
  version: 1;
  createdAt: string;
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  fileHashes: Record<string, string>;
  // Graphology SerializedGraph — typed loosely since it round-trips through JSON
  graph: unknown;
}

const SNAPSHOT_VERSION = 1;

/**
 * Resolve the snapshot directory. Prefers `GRAPH_SNAPSHOT_DIR` env var,
 * then falls back to `{workspaceRoot}/.mcp-cache/`. In Docker (when
 * WORKSPACE_ROOT is `/workspace`), defaults to `/tmp/.mcp-cache/` since
 * source volumes are mounted read-only.
 */
export function resolveSnapshotPath(workspaceRoot: string): string {
  if (process.env.GRAPH_SNAPSHOT_DIR) {
    return path.join(process.env.GRAPH_SNAPSHOT_DIR, "graph-snapshot.json");
  }

  // In Docker the workspace is mounted :ro (typically /workspace or /project).
  // Use /tmp as a writable fallback when the workspace root is not writable.
  const isDockerReadOnly = workspaceRoot === "/workspace" || workspaceRoot === "/project";
  const cacheDir = isDockerReadOnly
    ? path.join(os.tmpdir(), ".mcp-cache")
    : path.join(workspaceRoot, ".mcp-cache");

  return path.join(cacheDir, "graph-snapshot.json");
}

/**
 * Save the current graph state to a JSON snapshot on disk.
 * Uses a temp-file + rename pattern for atomic writes.
 */
export async function saveSnapshot(
  graphStore: GraphStore,
  snapshotPath: string,
): Promise<void> {
  const dir = path.dirname(snapshotPath);
  await fs.mkdir(dir, { recursive: true });

  const serializedGraph = graphStore.exportGraph();
  const fileHashes = graphStore.getFileHashes();

  const snapshot: SnapshotData = {
    version: SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(),
    fileCount: Object.keys(fileHashes).length,
    nodeCount: serializedGraph.nodes.length,
    edgeCount: serializedGraph.edges.length,
    fileHashes,
    graph: serializedGraph,
  };

  const json = JSON.stringify(snapshot);
  const tmpPath = `${snapshotPath}.tmp.${process.pid}`;

  try {
    await fs.writeFile(tmpPath, json, "utf-8");
    await fs.rename(tmpPath, snapshotPath);
  } catch (err) {
    // Clean up temp file on failure
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Load a snapshot from disk. Returns null if the file does not exist,
 * the version does not match, or the data is corrupt.
 * Never throws — always falls back gracefully.
 */
export async function loadSnapshot(
  snapshotPath: string,
): Promise<SnapshotData | null> {
  try {
    const raw = await fs.readFile(snapshotPath, "utf-8");
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      console.error("[graph-persistence] snapshot is not a valid object");
      return null;
    }

    if (parsed.version !== SNAPSHOT_VERSION) {
      console.error(
        `[graph-persistence] snapshot version mismatch: expected ${SNAPSHOT_VERSION}, got ${parsed.version}`,
      );
      return null;
    }

    if (!parsed.graph || !parsed.fileHashes) {
      console.error("[graph-persistence] snapshot missing required fields");
      return null;
    }

    return parsed as SnapshotData;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // File does not exist — not an error, just no snapshot available
      return null;
    }
    console.error("[graph-persistence] failed to load snapshot:", (err as Error).message);
    return null;
  }
}

/**
 * Delete any `.tmp.*` sibling files left over from interrupted atomic writes.
 * Safe to call even if no temp files exist.
 */
export async function cleanupTempSnapshots(snapshotPath: string): Promise<void> {
  const dir = path.dirname(snapshotPath);
  const base = path.basename(snapshotPath);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return; // Directory doesn't exist yet — nothing to clean
  }
  const tmpPattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.tmp\\.`);
  for (const entry of entries) {
    if (tmpPattern.test(entry)) {
      try {
        await fs.unlink(path.join(dir, entry));
        console.error(`[graph-persistence] cleaned up temp file: ${entry}`);
      } catch {
        // Ignore — may have been cleaned up by another process
      }
    }
  }
}

/**
 * Returns true if the snapshot file's mtime is older than maxAgeDays.
 * Returns false if the file does not exist or mtime cannot be read.
 */
export async function isSnapshotStale(snapshotPath: string, maxAgeDays: number): Promise<boolean> {
  try {
    const stat = await fs.stat(snapshotPath);
    const ageMs = Date.now() - stat.mtimeMs;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays > maxAgeDays;
  } catch {
    return false; // No file → not stale (will cold-index)
  }
}

/**
 * Create a debounced save function that ensures at most one save
 * per `intervalMs` milliseconds.
 */
export function createDebouncedSave(
  graphStore: GraphStore,
  snapshotPath: string,
  intervalMs: number = 5000,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;

  return () => {
    if (timer) return;

    timer = setTimeout(async () => {
      timer = null;
      if (saving) return;
      saving = true;
      try {
        await saveSnapshot(graphStore, snapshotPath);
      } catch (err) {
        console.error("[graph-persistence] debounced save failed:", (err as Error).message);
      } finally {
        saving = false;
      }
    }, intervalMs);
  };
}
