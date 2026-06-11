import path from "node:path";

import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";

import { IncrementalIndexer } from "../indexer/incremental-indexer.js";
import type { GraphStore } from "../graph/graph-store.js";
import { splitCsvRespectingBraces, resolveIgnorePatterns } from "../utils/glob-utils.js";

const DEFAULT_WATCH_DIRS = ["."];

export function resolveWatchPaths(workspaceRoot: string): string[] {
  const pythonEnv = process.env.PYTHON_WATCH_GLOBS;
  const tsEnv = process.env.TS_WATCH_GLOBS;
  const allGlobs: string[] = [];
  if (pythonEnv?.trim()) allGlobs.push(...splitCsvRespectingBraces(pythonEnv));
  if (tsEnv?.trim()) allGlobs.push(...splitCsvRespectingBraces(tsEnv));

  const dirs = allGlobs.length > 0
    ? [...new Set(allGlobs.map((g) => {
        // Extract the literal directory prefix before the first glob wildcard segment
        const parts = g.split("/");
        const wildcardIdx = parts.findIndex((p) => p.includes("*") || p.includes("{") || p.includes("?"));
        return wildcardIdx > 0 ? parts.slice(0, wildcardIdx).join("/") : parts[0];
      }))]
    : DEFAULT_WATCH_DIRS;

  return dirs.map((d) => path.join(workspaceRoot, d));
}

export interface WatcherUpdateStats {
  reparsed: number;
  dependents: number;
  files: number;
  filePaths: string[];
  newFiles: string[];
}

interface WatcherOptions {
  workspaceRoot: string;
  indexer: IncrementalIndexer;
  graphStore: GraphStore;
  onUpdate?: (stats: WatcherUpdateStats) => void;
  onDelete?: (filePath: string) => void;
}

export class LiveFileWatcher {
  private readonly workspaceRoot: string;

  private readonly indexer: IncrementalIndexer;

  private readonly graphStore: GraphStore;

  private readonly onUpdate?: (stats: WatcherUpdateStats) => void;

  private readonly onDelete?: (filePath: string) => void;

  private readonly pendingByFile = new Map<string, NodeJS.Timeout>();

  private readonly pendingSet = new Set<string>();

  private readonly knownFiles = new Set<string>();

  private flushTimer: NodeJS.Timeout | null = null;

  private watcher: FSWatcher | null = null;

  constructor(options: WatcherOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.indexer = options.indexer;
    this.graphStore = options.graphStore;
    this.onUpdate = options.onUpdate;
    this.onDelete = options.onDelete;
  }

  async start(): Promise<void> {
    // Populate knownFiles from the graph store's existing indexed files
    for (const filePath of this.graphStore.getIndexedFilePaths()) {
      this.knownFiles.add(filePath);
    }

    const watchPaths = resolveWatchPaths(this.workspaceRoot);

    this.watcher = chokidar.watch(watchPaths, {
      ignored: resolveIgnorePatterns(),
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 40,
      },
    });

    this.watcher.on("add", (filePath: string) => this.schedule(filePath));
    this.watcher.on("change", (filePath: string) => this.schedule(filePath));
    this.watcher.on("unlink", async (filePath: string) => {
      const normalized = this.normalize(filePath);
      await this.indexer.removeFile(filePath);
      this.pendingSet.delete(normalized);
      this.knownFiles.delete(normalized);
      this.onDelete?.(filePath);
    });
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    for (const timer of this.pendingByFile.values()) {
      clearTimeout(timer);
    }
    this.pendingByFile.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private schedule(filePath: string): void {
    const normalized = this.normalize(filePath);
    const existing = this.pendingByFile.get(normalized);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.pendingByFile.delete(normalized);
      this.pendingSet.add(normalized);
      this.scheduleFlush();
    }, 200);

    this.pendingByFile.set(normalized, timer);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null;
      const files = [...this.pendingSet];
      this.pendingSet.clear();
      if (files.length === 0) {
        return;
      }

      // Detect new files before processing
      const newFiles = files.filter((f) => !this.knownFiles.has(f));

      const stats = await this.indexer.processChanges(files);

      // After processing, add all files to knownFiles
      for (const f of files) {
        this.knownFiles.add(f);
      }

      this.onUpdate?.({
        ...stats,
        files: files.length,
        filePaths: files,
        newFiles,
      });
    }, 500);
  }

  private normalize(filePath: string): string {
    return filePath.split(path.sep).join("/");
  }
}
