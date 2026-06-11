import fs from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";

import { resolveIgnorePatterns } from "../utils/glob-utils.js";

export interface TsconfigEntry {
  /** Absolute directory of the tsconfig file. */
  dir: string;
  /** Absolute path of the tsconfig file itself. */
  configPath: string;
  /** Absolute baseUrl, resolved against `dir`. Defaults to `dir` when baseUrl is absent. */
  baseUrl: string;
  /** Path aliases, with values pre-resolved to absolute paths. */
  paths: Record<string, string[]>;
  /** Absolute glob patterns from `include`, or null if not specified. */
  include: string[] | null;
  /** Absolute glob patterns from `exclude`. */
  exclude: string[];
}

/** Strip JSONC comments and trailing commas so JSON.parse can handle tsconfig files. */
function stripJsonc(text: string): string {
  // Remove single-line comments
  let result = text.replace(/\/\/[^\n]*/g, "");
  // Remove multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove trailing commas before } or ]
  result = result.replace(/,(\s*[}\]])/g, "$1");
  return result;
}

function normalize(p: string): string {
  return p.split(path.sep).join("/");
}

export class TsconfigResolver {
  private readonly workspaceRoot: string;

  /** Map from absolute configPath → parsed entry */
  private readonly cache = new Map<string, TsconfigEntry>();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = normalize(workspaceRoot);
  }

  /** Discover all tsconfig*.json files under workspaceRoot (respects WATCH_IGNORES). */
  async discover(): Promise<void> {
    const files = await fg(["**/tsconfig*.json"], {
      cwd: this.workspaceRoot,
      absolute: true,
      onlyFiles: true,
      ignore: resolveIgnorePatterns(),
    });

    for (const file of files) {
      await this.parseAndCache(normalize(file), new Set());
    }
  }

  /** Re-parse a single tsconfig after a file-watcher change. */
  async invalidate(filePath: string): Promise<void> {
    const normalized = normalize(filePath);
    this.cache.delete(normalized);
    await this.parseAndCache(normalized, new Set());
  }

  /**
   * Walk up the directory tree from `filePath` and return the nearest
   * tsconfig whose directory is an ancestor of the file.
   * Prefers the deepest (most specific) match.
   */
  findNearestTsconfig(filePath: string): TsconfigEntry | null {
    const normalized = normalize(filePath);
    const fileDir = normalize(path.dirname(normalized));

    let bestMatch: TsconfigEntry | null = null;
    let bestDepth = -1;

    for (const entry of this.cache.values()) {
      const entryDir = entry.dir;
      // The entry dir must be a prefix of the file's directory
      if (fileDir === entryDir || fileDir.startsWith(entryDir + "/")) {
        const depth = entryDir.split("/").length;
        if (depth > bestDepth) {
          bestDepth = depth;
          bestMatch = entry;
        }
      }
    }

    return bestMatch;
  }

  /**
   * Apply `compilerOptions.paths` from a tsconfig entry to resolve an import alias.
   * Returns the resolved absolute base path (without extension) or null.
   */
  resolveAlias(tsconfig: TsconfigEntry, importValue: string): string | null {
    const { paths, baseUrl } = tsconfig;

    // Sort aliases longest-prefix-first (per TS spec)
    const sortedAliases = Object.keys(paths).sort((a, b) => b.length - a.length);

    for (const pattern of sortedAliases) {
      const mappings = paths[pattern];
      if (!mappings || mappings.length === 0) continue;

      const wildcardIdx = pattern.indexOf("*");

      if (wildcardIdx === -1) {
        // Exact match
        if (importValue === pattern) {
          for (const mapping of mappings) {
            const resolved = normalize(path.resolve(baseUrl, mapping));
            return resolved;
          }
        }
      } else {
        // Wildcard match
        const prefix = pattern.slice(0, wildcardIdx);
        const suffix = pattern.slice(wildcardIdx + 1);

        if (
          importValue.startsWith(prefix) &&
          (suffix === "" || importValue.endsWith(suffix))
        ) {
          const captured = importValue.slice(
            prefix.length,
            suffix.length > 0 ? importValue.length - suffix.length : undefined,
          );

          for (const mapping of mappings) {
            const resolved = mapping.includes("*")
              ? mapping.replace("*", captured)
              : mapping;
            return normalize(path.resolve(baseUrl, resolved));
          }
        }
      }
    }

    return null;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async parseAndCache(configPath: string, visited: Set<string>): Promise<TsconfigEntry | null> {
    if (this.cache.has(configPath)) {
      return this.cache.get(configPath)!;
    }

    if (visited.has(configPath)) {
      console.error(`[tsconfig-resolver] circular extends detected at ${configPath} — skipping`);
      return null;
    }

    let raw: string;
    try {
      raw = await fs.readFile(configPath, "utf8");
    } catch {
      return null;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stripJsonc(raw)) as Record<string, unknown>;
    } catch {
      console.error(`[tsconfig-resolver] failed to parse ${configPath}`);
      return null;
    }

    const dir = normalize(path.dirname(configPath));
    visited.add(configPath);

    // Resolve `extends` chain first (parent values are the base)
    let parentEntry: TsconfigEntry | null = null;
    const extendsValue = parsed["extends"];
    if (typeof extendsValue === "string") {
      const parentPath = normalize(path.resolve(dir, extendsValue.endsWith(".json") ? extendsValue : `${extendsValue}.json`));
      parentEntry = await this.parseAndCache(parentPath, new Set(visited));
    }

    const compilerOptions = (parsed["compilerOptions"] as Record<string, unknown>) ?? {};

    // baseUrl: resolve against dir; fall back to parent's baseUrl or dir itself
    let baseUrl: string;
    if (typeof compilerOptions["baseUrl"] === "string") {
      baseUrl = normalize(path.resolve(dir, compilerOptions["baseUrl"]));
    } else if (parentEntry) {
      baseUrl = parentEntry.baseUrl;
    } else {
      baseUrl = dir;
    }

    // paths: child overrides parent keys; parent fills in missing keys
    const rawPaths = (compilerOptions["paths"] as Record<string, string[]>) ?? {};
    const parentPaths = parentEntry?.paths ?? {};
    const mergedPaths: Record<string, string[]> = { ...parentPaths };

    for (const [key, values] of Object.entries(rawPaths)) {
      mergedPaths[key] = values.map((v) => normalize(path.resolve(baseUrl, v)));
    }

    // include / exclude
    const rawInclude = parsed["include"] as string[] | undefined;
    const include = rawInclude
      ? rawInclude.map((p) => normalize(path.resolve(dir, p)))
      : null;

    const rawExclude = (parsed["exclude"] as string[] | undefined) ?? [];
    const exclude = rawExclude.map((p) => normalize(path.resolve(dir, p)));

    const entry: TsconfigEntry = { dir, configPath, baseUrl, paths: mergedPaths, include, exclude };
    this.cache.set(configPath, entry);
    return entry;
  }
}
