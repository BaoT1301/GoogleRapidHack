import fs from "node:fs";
import path from "node:path";

import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import { z } from "zod";

const ClusterSchema = z.object({
  id: z.string().min(1),
  path: z.string(),
  label: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

const ClusterConfigSchema = z.object({
  clusters: z.array(ClusterSchema).min(1),
});

export type Cluster = z.infer<typeof ClusterSchema>;
export type ClusterConfig = z.infer<typeof ClusterConfigSchema>;

const DEFAULT_CLUSTER: Cluster = {
  id: "root",
  path: "",
  label: "Root",
  color: "#4A90E2",
};

export class ClusterConfigLoader {
  private clusters: Cluster[] = [DEFAULT_CLUSTER];
  private readonly configPath: string;
  private watcher: FSWatcher | null = null;

  constructor(configPath: string) {
    this.configPath = path.resolve(configPath);
    this.loadSync();
  }

  getClusters(): Cluster[] {
    return [...this.clusters];
  }

  getClusterForFile(filePath: string): Cluster {
    const normalized = filePath.split(path.sep).join("/");

    let bestMatch: Cluster = DEFAULT_CLUSTER;
    let bestLength = 0;

    for (const cluster of this.clusters) {
      const clusterPath = cluster.path;
      if (clusterPath && normalized.startsWith(clusterPath) && clusterPath.length > bestLength) {
        bestMatch = cluster;
        bestLength = clusterPath.length;
      }
    }

    return bestMatch;
  }

  async startWatching(): Promise<void> {
    this.watcher = chokidar.watch(this.configPath, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 50,
      },
    });

    this.watcher.on("change", () => {
      this.loadSync();
    });
  }

  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private loadSync(): void {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.error(`[cluster-config] config file not found at ${this.configPath}, using default`);
        this.clusters = [DEFAULT_CLUSTER];
        return;
      }

      const raw = fs.readFileSync(this.configPath, "utf-8");
      const parsed = JSON.parse(raw);
      const validated = ClusterConfigSchema.parse(parsed);

      // Validate all paths are relative (no leading /)
      for (const cluster of validated.clusters) {
        if (cluster.path.startsWith("/")) {
          throw new Error(`Cluster path must be relative: ${cluster.path}`);
        }
      }

      this.clusters = validated.clusters;
      console.error(`[cluster-config] loaded ${this.clusters.length} clusters`);
    } catch (error) {
      console.error(`[cluster-config] failed to load config: ${error instanceof Error ? error.message : error}`);
      this.clusters = [DEFAULT_CLUSTER];
    }
  }
}
