import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { GraphStore } from "./graph/graph-store.js";
import { IncrementalIndexer, resolveGlobPatterns } from "./indexer/incremental-indexer.js";
import { registerContextTools } from "./tools/context-tools.js";
import { LiveFileWatcher } from "./watcher/file-watcher.js";
import { HttpApiServer } from "./api.js";
import { ClusterConfigLoader } from "./cluster/cluster-config-loader.js";
import {
  resolveSnapshotPath,
  saveSnapshot,
  loadSnapshot,
  createDebouncedSave,
  cleanupTempSnapshots,
  isSnapshotStale,
} from "./graph/graph-persistence.js";
import { resolveIgnorePatterns } from "./utils/glob-utils.js";

function resolveWorkspaceRoot(): string {
  if (process.env.WORKSPACE_ROOT) {
    return path.resolve(process.env.WORKSPACE_ROOT);
  }
  return process.cwd();
}

/**
 * Parse CLI flags from process.argv.
 * Returns a set of recognized flags.
 */
export function parseCliFlags(argv: string[]): { stdioOnly: boolean } {
  return {
    stdioOnly: argv.includes("--stdio-only"),
  };
}

async function bootstrap(): Promise<void> {
  const flags = parseCliFlags(process.argv);
  const mode = flags.stdioOnly ? "stdio-only" : "full (http+stdio)";
  console.error(`[live-context-manager] mode=${mode}`);

  const workspaceRoot = resolveWorkspaceRoot();

  const graphStore = new GraphStore();
  const indexer = new IncrementalIndexer(workspaceRoot, graphStore);
  const snapshotPath = resolveSnapshotPath(workspaceRoot);

  // Load cluster configuration
  const clusterConfigPath = path.join(workspaceRoot, "cluster-config.json");
  const clusterConfig = new ClusterConfigLoader(clusterConfigPath);
  await clusterConfig.startWatching();

  // Start HTTP API server only in full mode
  let httpApi: HttpApiServer | null = null;
  if (!flags.stdioOnly) {
    const httpPort = parseInt(process.env.HTTP_PORT || "3001", 10);
    httpApi = new HttpApiServer(graphStore, clusterConfig, httpPort);
    httpApi.setWorkspaceRoot(workspaceRoot);
    httpApi.setReady(false);
    await httpApi.start();
  }

  // Attempt to load from snapshot for faster startup
  await cleanupTempSnapshots(snapshotPath);
  const maxAgeDays = parseInt(process.env.GRAPH_SNAPSHOT_MAX_AGE ?? "7", 10);
  const stale = await isSnapshotStale(snapshotPath, maxAgeDays);
  if (stale) {
    console.error(`[live-context-manager] snapshot is older than ${maxAgeDays} days — discarding for full re-index`);
  }
  const snapshot = stale ? null : await loadSnapshot(snapshotPath);
  let initial: { indexedFiles: number };

  if (snapshot) {
    const snapshotSizeKb = Math.round(JSON.stringify(snapshot).length / 1024);
    const snapshotAgeSec = (Date.now() - new Date(snapshot.createdAt).getTime()) / 1000;
    const snapshotAgeMin = Math.round(snapshotAgeSec / 60);
    console.error(`[live-context-manager] loading snapshot (${snapshot.fileCount} files, ${snapshot.nodeCount} nodes)`);
    graphStore.importFromSnapshot(snapshot.graph, snapshot.fileHashes);
    const delta = await indexer.buildDeltaGraph(snapshot.fileHashes);
    console.error(
      `[live-context-manager] delta: reused=${delta.reused} reparsed=${delta.reparsed} deleted=${delta.deleted}`,
    );
    console.error(
      `[graph-store] loaded snapshot: ${snapshot.nodeCount} nodes, ${snapshot.edgeCount} edges, ${snapshotSizeKb} KB, age ${snapshotAgeMin} min`,
    );
    initial = { indexedFiles: delta.reused + delta.reparsed };
  } else {
    // No snapshot — full initial index with progress reporting
    initial = await indexer.buildInitialGraph((current, total) => {
      console.error(`[live-context-manager] indexing ${current}/${total}`);
      if (httpApi) {
        httpApi.broadcastSSE("indexing-progress", {
          current,
          total,
          timestamp: Date.now(),
        });
      }
    });
  }

  console.error(`[live-context-manager] indexed ${initial.indexedFiles} files`);
  if (httpApi) {
    httpApi.setReady(true);
    httpApi.broadcastSSE("indexing-complete", {
      indexedFiles: initial.indexedFiles,
      timestamp: Date.now(),
    });
    httpApi.markIndexingComplete(initial.indexedFiles);

    // Set degraded state when 0 files indexed
    const degraded = initial.indexedFiles === 0;
    const reasons = degraded ? ["indexed 0 files"] : [];
    httpApi.setDegradedState(degraded, reasons);

    // Startup banner
    const { pythonPatterns, tsPatterns } = resolveGlobPatterns();
    const ignores = resolveIgnorePatterns();
    const clusters = clusterConfig.getClusters();
    console.error(
      `[MCP] workspace=${workspaceRoot} globs=[${[...pythonPatterns, ...tsPatterns].join(", ")}] ignores=${ignores.length} patterns indexed=${initial.indexedFiles} files across ${clusters.length} clusters`,
    );
    if (degraded) {
      console.error("[MCP] WARN: indexed 0 files — run ./mcp.sh doctor");
    }
  }

  // Save snapshot after initial indexing
  try {
    await saveSnapshot(graphStore, snapshotPath);
    console.error("[live-context-manager] snapshot saved");
  } catch (err) {
    console.error("[live-context-manager] failed to save snapshot:", (err as Error).message);
  }

  // Create debounced save for file watcher updates
  const debouncedSave = createDebouncedSave(graphStore, snapshotPath, 5000);

  const watcher = new LiveFileWatcher({
    workspaceRoot,
    indexer,
    graphStore,
    onUpdate: (stats) => {
      console.error(
        `[live-context-manager] update files=${stats.files} reparsed=${stats.reparsed} dependents=${stats.dependents}`,
      );

      // Trigger debounced snapshot save after file changes
      debouncedSave();

      // Emit SSE events only in full mode
      if (httpApi) {
        // Emit file-created event for new files
        if (stats.newFiles.length > 0) {
          const createdClusterIds = stats.newFiles.map((f) => clusterConfig.getClusterForFile(f)?.id).filter(Boolean);
          httpApi.broadcastSSE("file-change", {
            type: "file-created",
            filePaths: stats.newFiles,
            clusterIds: [...new Set(createdClusterIds)],
            timestamp: Date.now(),
          });
        }

        // Emit file-updated event for existing (non-new) files
        const updatedFiles = stats.filePaths.filter((f) => !stats.newFiles.includes(f));
        if (updatedFiles.length > 0) {
          const updatedClusterIds = updatedFiles.map((f) => clusterConfig.getClusterForFile(f)?.id).filter(Boolean);
          httpApi.broadcastSSE("file-change", {
            type: "file-updated",
            filePaths: updatedFiles,
            clusterIds: [...new Set(updatedClusterIds)],
            timestamp: Date.now(),
          });
        }
      }
    },
    onDelete: (filePath) => {
      console.error(`[live-context-manager] deleted ${filePath}`);
      if (httpApi) {
        httpApi.broadcastSSE("file-change", {
          type: "file-deleted",
          filePath,
          clusterId: clusterConfig.getClusterForFile(filePath)?.id,
          timestamp: Date.now(),
        });
      }
    },
  });
  await watcher.start();

  // Watch tsconfig*.json files for alias invalidation
  const chokidar = await import("chokidar");
  const tsconfigWatcher = chokidar.watch("**/tsconfig*.json", {
    cwd: workspaceRoot,
    ignoreInitial: true,
    ignored: resolveIgnorePatterns(),
  });
  tsconfigWatcher.on("add", (relPath: string) => {
    const abs = path.join(workspaceRoot, relPath);
    indexer.tsconfigResolver.invalidate(abs).catch(() => {});
  });
  tsconfigWatcher.on("change", (relPath: string) => {
    const abs = path.join(workspaceRoot, relPath);
    indexer.tsconfigResolver.invalidate(abs).catch(() => {});
  });

  const server = new McpServer({
    name: "live-context-manager",
    version: "0.1.0",
  });

  registerContextTools(server as any, graphStore);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    if (httpApi) {
      await httpApi.stop();
    }
    await tsconfigWatcher.close();
    await watcher.stop();
    await clusterConfig.stopWatching();
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((error) => {
  console.error("[live-context-manager] fatal error", error);
  process.exit(1);
});
