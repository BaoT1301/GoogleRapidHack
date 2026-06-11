import path from "node:path";

export type PathAllowlistEnforcementMode = "warn" | "fail";

export interface PathAllowlistInput {
  rootRepoPath: string;
  worktreePath: string;
  changedFiles: string[];
  allowedPaths?: string[];
  enforcementMode?: PathAllowlistEnforcementMode;
}

export interface PathAllowlistResult {
  ok: boolean;
  mode: PathAllowlistEnforcementMode;
  allowedPrefixes: string[];
  changedFiles: string[];
  violatingFiles: string[];
  warnings: string[];
}

export function checkPathAllowlist(input: PathAllowlistInput): PathAllowlistResult {
  const mode = input.enforcementMode ?? "warn";
  const warnings: string[] = [];
  const rootRepoPath = path.resolve(input.rootRepoPath);
  const worktreePath = path.resolve(input.worktreePath);
  const allowedPrefixes = normalizeAllowedPaths(input.allowedPaths ?? [], warnings);
  const changedFiles = normalizeChangedFiles(input.changedFiles, rootRepoPath, worktreePath, warnings);

  if (allowedPrefixes.length === 0) {
    return {
      ok: true,
      mode,
      allowedPrefixes,
      changedFiles,
      violatingFiles: [],
      warnings,
    };
  }

  const violatingFiles = changedFiles.filter((file) =>
    !allowedPrefixes.some((prefix) => isWithinAllowedPrefix(file, prefix)),
  );

  return {
    ok: violatingFiles.length === 0 || mode === "warn",
    mode,
    allowedPrefixes,
    changedFiles,
    violatingFiles,
    warnings,
  };
}

function normalizeAllowedPaths(values: string[], warnings: string[]): string[] {
  const normalized = new Set<string>();

  for (const value of values) {
    const candidate = normalizeRepoRelativePath(value);
    if (!candidate) {
      warnings.push(`Ignored unsafe allowedPaths entry: ${value}`);
      continue;
    }
    normalized.add(candidate);
  }

  return [...normalized];
}

function normalizeChangedFiles(
  values: string[],
  rootRepoPath: string,
  worktreePath: string,
  warnings: string[],
): string[] {
  const normalized = new Set<string>();

  for (const value of values) {
    const candidate = normalizeChangedFile(value, rootRepoPath, worktreePath);
    if (!candidate) {
      warnings.push(`Ignored unsafe changed file path: ${value}`);
      continue;
    }
    normalized.add(candidate);
  }

  return [...normalized];
}

function normalizeChangedFile(
  value: string,
  rootRepoPath: string,
  worktreePath: string,
): string | undefined {
  if (path.isAbsolute(value)) {
    const resolved = path.resolve(value);
    const worktreeRelative = safeRelative(worktreePath, resolved);
    if (worktreeRelative) return worktreeRelative;
    return safeRelative(rootRepoPath, resolved);
  }

  return normalizeRepoRelativePath(value);
}

function normalizeRepoRelativePath(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || path.isAbsolute(trimmed)) return undefined;

  const normalized = path.posix.normalize(trimmed.replaceAll(path.win32.sep, path.posix.sep));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return undefined;
  }

  return normalized.replace(/^\.\/+/, "").replace(/\/+$/g, "");
}

function safeRelative(parentPath: string, candidatePath: string): string | undefined {
  const relative = path.relative(parentPath, candidatePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return normalizeRepoRelativePath(relative);
}

function isWithinAllowedPrefix(file: string, prefix: string): boolean {
  return file === prefix || file.startsWith(`${prefix}/`);
}
