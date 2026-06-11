import { createHash } from "node:crypto";

/**
 * SKILL-INSTALL — deterministic integrity hashing for an installed skill's whole
 * directory tree. The hash is computed PURELY from the set of (relative path,
 * content) pairs, independent of:
 *   - file iteration / read order (we sort),
 *   - path separator style (we normalize to POSIX),
 *   - filesystem timestamps / modes (content + path only).
 *
 * This lets the installer record a single `computedHash` in `skills-lock.json`
 * and lets a later verification step (or audit) re-derive it byte-for-byte from
 * the on-disk store. Never throws.
 */

export interface SkillFile {
  /** Relative path within the skill directory (any separator style accepted). */
  path: string;
  /** File contents — bytes or utf8 string. */
  content: Buffer | string;
}

/** sha256 hex of a single file's content. */
export function hashSkillFileContent(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Normalize a relative path to POSIX separators with no leading `./` or slashes. */
function normalizeRelPath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

/**
 * Deterministic sha256 over a skill's file tree. Order-independent: each file
 * contributes a `"<relpath>\0<sha256(content)>"` line; lines are sorted and
 * folded into one digest. Two trees with identical path+content sets hash equal
 * regardless of input ordering or separator style.
 */
export function hashSkillTree(files: SkillFile[]): string {
  const lines = files
    .map((f) => `${normalizeRelPath(f.path)}\u0000${hashSkillFileContent(f.content)}`)
    .sort();
  const h = createHash("sha256");
  for (const line of lines) {
    h.update(line);
    h.update("\n");
  }
  return h.digest("hex");
}

/** True iff `files` reproduce the `expected` tree hash. Never throws. */
export function verifySkillTree(files: SkillFile[], expected: string): boolean {
  if (typeof expected !== "string" || expected.length === 0) return false;
  try {
    return hashSkillTree(files) === expected;
  } catch {
    return false;
  }
}
