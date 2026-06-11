import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { resolveDefaultRepoRoot } from "./default-repo-root";

/** Hard cap so a giant directory can never blow up the payload. */
export const LIST_DIR_MAX_ENTRIES = 500;

export interface DirEntry {
  name: string;
  /** Always true — we only ever return directories (files are filtered out). */
  isDir: true;
  /** True when this directory is itself the top of a git work tree (has `.git`). */
  isGitRepo: boolean;
  /** True for dot-directories (`.git`, `.next`, …) so the UI can de-emphasize them. */
  isHidden: boolean;
}

export interface ListDirResult {
  /** Absolute, resolved path that was listed. */
  path: string;
  /** Parent directory, or `null` at the filesystem root. */
  parent: string | null;
  /** Directory children only, sorted; capped at `LIST_DIR_MAX_ENTRIES`. */
  entries: DirEntry[];
  /** True when the listed path is the top of a git work tree. */
  isGitRepo: boolean;
  /** True when more entries existed than the cap returned. */
  truncated: boolean;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * READ-ONLY server-side directory browser backing the repo-path picker. Returns
 * the immediate CHILD DIRECTORIES of `inputPath` (never file contents, never file
 * names), each flagged with whether it is a git repo, sorted (git repos first,
 * then case-insensitive name), and capped at `LIST_DIR_MAX_ENTRIES`.
 *
 * Fail-soft like the other repo probes: a missing/unreadable/file path degrades
 * to the default repo root's listing rather than throwing, so the browser modal
 * can never crash the form. `parent` is `null` at the filesystem root.
 *
 * SECURITY: this exposes directory NAMES on the host to the authenticated owner.
 * It is intentionally scoped to a local, single-owner tool (the runtime already
 * runs git against local paths). It never reveals file contents and never
 * follows into files.
 */
export async function listDir(input: { path?: string } = {}): Promise<ListDirResult> {
  const requested = input.path?.trim();
  let target = requested ? path.resolve(requested) : (await resolveDefaultRepoRoot()).path;

  // Degrade an unusable target (missing, or a file) to the default repo root.
  let usable = await pathExists(target);
  if (usable) {
    try {
      const st = await stat(target);
      if (!st.isDirectory()) usable = false;
    } catch {
      usable = false;
    }
  }
  if (!usable) {
    target = (await resolveDefaultRepoRoot()).path;
  }

  const parent = path.dirname(target);
  const resolvedParent = parent === target ? null : parent;

  let names: string[] = [];
  try {
    names = await readdir(target);
  } catch {
    names = [];
  }

  const collected: DirEntry[] = [];
  for (const name of names) {
    let isDir = false;
    try {
      const st = await stat(path.join(target, name));
      isDir = st.isDirectory();
    } catch {
      isDir = false; // unreadable/broken symlink — skip
    }
    if (!isDir) continue;
    collected.push({
      name,
      isDir: true,
      isGitRepo: await pathExists(path.join(target, name, ".git")),
      isHidden: name.startsWith("."),
    });
  }

  collected.sort((a, b) => {
    if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  const truncated = collected.length > LIST_DIR_MAX_ENTRIES;

  return {
    path: target,
    parent: resolvedParent,
    entries: collected.slice(0, LIST_DIR_MAX_ENTRIES),
    isGitRepo: await pathExists(path.join(target, ".git")),
    truncated,
  };
}
