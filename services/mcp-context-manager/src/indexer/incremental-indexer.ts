import fs from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";

import { GraphStore } from "../graph/graph-store.js";
import { parsePythonFile } from "../parsers/python-parser.js";
import { parseTypeScriptFile } from "../parsers/typescript-parser.js";
import { detectLanguage } from "../parsers/common.js";
import type { FileParseResult, ImportResolution, UnresolvedImportEntry } from "../types/schema.js";
import { splitCsvRespectingBraces, resolveIgnorePatterns } from "../utils/glob-utils.js";
import { TsconfigResolver } from "./tsconfig-resolver.js";

export { splitCsvRespectingBraces, resolveIgnorePatterns };

const DEFAULT_PYTHON_PATTERNS = ["**/*.py"];
const DEFAULT_TS_PATTERNS = ["**/*.{ts,tsx,js,jsx}"];

export function resolveGlobPatterns(): { pythonPatterns: string[]; tsPatterns: string[] } {
  const pythonEnv = process.env.PYTHON_WATCH_GLOBS;
  const tsEnv = process.env.TS_WATCH_GLOBS;
  const pythonPatterns = pythonEnv?.trim()
    ? splitCsvRespectingBraces(pythonEnv)
    : DEFAULT_PYTHON_PATTERNS;
  const tsPatterns = tsEnv?.trim()
    ? splitCsvRespectingBraces(tsEnv)
    : DEFAULT_TS_PATTERNS;
  return { pythonPatterns, tsPatterns };
}

const TS_IMPORT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".d.ts"];

function normalize(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export class IncrementalIndexer {
  private readonly workspaceRoot: string;

  private readonly graphStore: GraphStore;

  private readonly fileExistsCache = new Map<string, boolean>();

  readonly tsconfigResolver: TsconfigResolver;

  constructor(workspaceRoot: string, graphStore: GraphStore) {
    this.workspaceRoot = normalize(workspaceRoot);
    this.graphStore = graphStore;
    this.tsconfigResolver = new TsconfigResolver(this.workspaceRoot);
  }

  async buildInitialGraph(onProgress?: (current: number, total: number) => void): Promise<{ indexedFiles: number }> {
    await this.tsconfigResolver.discover();
    const { pythonPatterns, tsPatterns } = resolveGlobPatterns();
    const files = await fg([...pythonPatterns, ...tsPatterns], {
      cwd: this.workspaceRoot,
      absolute: true,
      onlyFiles: true,
      ignore: resolveIgnorePatterns(),
    });

    let count = 0;
    for (const filePath of files) {
      const ok = await this.reindexSingleFile(filePath);
      if (ok) {
        count += 1;
      }
      onProgress?.(count, files.length);
    }

    // Structured log: import resolution summary
    const summary = this.graphStore.getUnresolvedSummary();
    const { resolvedEdges, unresolvedSpecifiers, skippedExternals, topUnresolvedReasons } = summary;
    console.error(
      `[live-context-manager] import resolution: ${resolvedEdges} resolved, ${unresolvedSpecifiers} unresolved, ${skippedExternals} externals skipped`,
    );
    if (unresolvedSpecifiers > 0) {
      const reasonStr = Object.entries(topUnresolvedReasons)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ");
      console.error(
        `[live-context-manager] ⚠ ${unresolvedSpecifiers} unresolved imports (${reasonStr}) — run GET /api/v1/mcp/unresolved_imports for details`,
      );
    }

    return { indexedFiles: count };
  }

  async buildDeltaGraph(
    snapshotFileHashes: Record<string, string>,
  ): Promise<{ reused: number; reparsed: number; deleted: number }> {
    const { pythonPatterns, tsPatterns } = resolveGlobPatterns();
    const files = await fg([...pythonPatterns, ...tsPatterns], {
      cwd: this.workspaceRoot,
      absolute: true,
      onlyFiles: true,
      ignore: resolveIgnorePatterns(),
    });

    const currentFiles = new Set(files.map((f) => normalize(f)));
    let reused = 0;
    let reparsed = 0;
    let deleted = 0;

    // Re-parse changed or new files
    for (const filePath of currentFiles) {
      const snapshotHash = snapshotFileHashes[filePath];
      if (snapshotHash && this.graphStore.hasFileHash(filePath, snapshotHash)) {
        // File unchanged since snapshot — reuse
        reused += 1;
        continue;
      }

      // New or changed file — re-index
      const ok = await this.reindexSingleFile(filePath);
      if (ok) {
        reparsed += 1;
      } else {
        // File exists but hash matches (race) or not a supported language
        reused += 1;
      }
    }

    // Remove files that existed in snapshot but no longer exist on disk
    const snapshotFiles = Object.keys(snapshotFileHashes);
    for (const snapshotFile of snapshotFiles) {
      if (!currentFiles.has(snapshotFile)) {
        this.graphStore.removeFile(snapshotFile);
        deleted += 1;
      }
    }

    return { reused, reparsed, deleted };
  }

  async processChanges(changedFiles: string[]): Promise<{ reparsed: number; dependents: number }> {
    const normalized = Array.from(new Set(changedFiles.map((item) => normalize(item))));
    let reparsed = 0;
    const dependentCandidates = new Set<string>();

    for (const filePath of normalized) {
      for (const dependent of this.graphStore.getDirectDependents(filePath)) {
        dependentCandidates.add(dependent);
      }

      const ok = await this.reindexSingleFile(filePath);
      if (ok) {
        reparsed += 1;
      }

      for (const dependent of this.graphStore.getDirectDependents(filePath)) {
        dependentCandidates.add(dependent);
      }
    }

    let dependentCount = 0;
    for (const dependent of dependentCandidates) {
      if (normalized.includes(dependent)) {
        continue;
      }
      const ok = await this.reindexSingleFile(dependent);
      if (ok) {
        dependentCount += 1;
      }
    }

    return { reparsed, dependents: dependentCount };
  }

  async removeFile(filePath: string): Promise<void> {
    this.graphStore.removeFile(normalize(filePath));
  }

  private async reindexSingleFile(filePath: string): Promise<boolean> {
    const normalized = normalize(filePath);
    const language = detectLanguage(normalized);
    if (!language) {
      return false;
    }

    const exists = await this.exists(normalized);
    if (!exists) {
      this.graphStore.removeFile(normalized);
      return false;
    }

    let parseResult: FileParseResult;
    if (language === "python") {
      parseResult = await parsePythonFile(normalized, this.workspaceRoot);
    } else {
      parseResult = await parseTypeScriptFile(normalized, this.workspaceRoot);
    }

    if (this.graphStore.hasFileHash(normalized, parseResult.hash)) {
      return false;
    }

    const { resolved, unresolved } = await this.resolveImportsTagged(normalized, parseResult.parsedImports.map((item) => item.raw), language);
    parseResult.resolvedImports = resolved;
    parseResult.unresolvedImports = unresolved;
    this.graphStore.upsertFileResult(parseResult);
    return true;
  }

  private async resolveImportsTagged(
    currentFile: string,
    imports: string[],
    language: "python" | "typescript",
  ): Promise<{ resolved: string[]; unresolved: UnresolvedImportEntry[] }> {
    const resolved = new Set<string>();
    const unresolved: UnresolvedImportEntry[] = [];

    for (const importValue of imports) {
      if (language === "python") {
        const pythonResolved = await this.resolvePythonModule(importValue);
        if (pythonResolved) {
          resolved.add(pythonResolved);
        }
        // Python unresolved tracking is out of scope for FIX-02 (TS-focused)
      } else {
        const resolution = await this.resolveTypeScriptImportTagged(currentFile, importValue);
        if (resolution.kind === "resolved") {
          resolved.add(resolution.filePath);
        } else if (resolution.kind !== "skipped-external") {
          // Map tagged kind to reason
          let reason: UnresolvedImportEntry["reason"];
          if (resolution.kind === "unresolved-relative") {
            reason = "missing-file";
          } else if (resolution.kind === "unresolved-alias") {
            reason = resolution.tsconfig ? "alias-no-match" : "alias-no-tsconfig";
          } else {
            reason = "other";
          }
          const entry: UnresolvedImportEntry = { specifier: importValue, reason };
          if ("searched" in resolution && resolution.searched.length > 0) {
            entry.searched = resolution.searched;
          }
          unresolved.push(entry);
        }
      }
    }

    return { resolved: [...resolved], unresolved };
  }

  /** @deprecated Use resolveImportsTagged instead. Kept for backwards compat. */
  private async resolveImports(
    currentFile: string,
    imports: string[],
    language: "python" | "typescript",
  ): Promise<string[]> {
    const { resolved } = await this.resolveImportsTagged(currentFile, imports, language);
    return resolved;
  }

  private async resolvePythonModule(moduleName: string): Promise<string | null> {
    if (!moduleName || moduleName.startsWith(".")) {
      return null;
    }

    const modulePath = moduleName.replace(/\./g, "/");
    const candidates = [
      path.join(this.workspaceRoot, `${modulePath}.py`),
      path.join(this.workspaceRoot, modulePath, "__init__.py"),
    ].map((item) => normalize(item));

    for (const candidate of candidates) {
      if (await this.exists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private async resolveTypeScriptImport(currentFile: string, importValue: string): Promise<string | null> {
    const resolution = await this.resolveTypeScriptImportTagged(currentFile, importValue);
    return resolution.kind === "resolved" ? resolution.filePath : null;
  }

  private async resolveTypeScriptImportTagged(currentFile: string, importValue: string): Promise<ImportResolution> {
    if (!importValue) {
      return { kind: "skipped-external", specifier: importValue };
    }

    // Relative imports — resolve against current file's directory
    if (importValue.startsWith(".")) {
      const basePath = path.resolve(path.dirname(currentFile), importValue);
      const candidates = this.buildCandidates(basePath);
      const found = await this.resolveCandidate(basePath);
      if (found) return { kind: "resolved", filePath: found };
      return { kind: "unresolved-relative", specifier: importValue, searched: candidates };
    }

    // Bare specifiers (e.g. "react", "zod", "node:fs") — skip
    if (!/^[@~]/.test(importValue) && !importValue.startsWith("/")) {
      return { kind: "skipped-external", specifier: importValue };
    }

    // Legacy env-var fallback
    if (process.env.TS_LEGACY_FRONTEND_ALIAS === "1" && importValue.startsWith("@/")) {
      const basePath = path.join(this.workspaceRoot, "frontend", "src", importValue.slice(2));
      const found = await this.resolveCandidate(basePath);
      if (found) return { kind: "resolved", filePath: found };
      return { kind: "unresolved-alias", specifier: importValue, tsconfig: null, searched: this.buildCandidates(basePath) };
    }

    // Alias resolution via nearest-ancestor tsconfig paths
    const tsconfig = this.tsconfigResolver.findNearestTsconfig(currentFile);
    if (tsconfig) {
      const aliasResolved = this.tsconfigResolver.resolveAlias(tsconfig, importValue);
      if (aliasResolved) {
        const found = await this.resolveCandidate(aliasResolved);
        if (found) return { kind: "resolved", filePath: found };
        return {
          kind: "unresolved-alias",
          specifier: importValue,
          tsconfig: tsconfig.configPath,
          searched: this.buildCandidates(aliasResolved),
        };
      }
      // tsconfig found but no matching alias pattern
      return { kind: "unresolved-alias", specifier: importValue, tsconfig: tsconfig.configPath, searched: [] };
    }

    // No tsconfig in tree
    return { kind: "unresolved-alias", specifier: importValue, tsconfig: null, searched: [] };
  }

  private buildCandidates(basePath: string): string[] {
    const candidates: string[] = [normalize(basePath)];
    for (const ext of TS_IMPORT_EXTENSIONS) candidates.push(`${normalize(basePath)}${ext}`);
    for (const ext of TS_IMPORT_EXTENSIONS) candidates.push(normalize(path.join(basePath, `index${ext}`)));
    return candidates;
  }

  private async resolveCandidate(basePath: string): Promise<string | null> {
    for (const candidate of this.buildCandidates(basePath)) {
      if (await this.exists(candidate)) return candidate;
    }
    return null;
  }

  private async exists(filePath: string): Promise<boolean> {
    if (this.fileExistsCache.get(filePath) === true) {
      return true;
    }

    try {
      await fs.access(filePath);
      this.fileExistsCache.set(filePath, true);
      return true;
    } catch {
      this.fileExistsCache.delete(filePath);
      return false;
    }
  }
}
