import type { SkillFile } from "./skill-hash";

/**
 * SKILL-INSTALL — pluggable skill-source layer. A `SkillSourceProvider` knows how
 * to (a) recognize a raw source ref, (b) RESOLVE it to an immutable pinned ref
 * (e.g. a git commit SHA), and (c) FETCH the skill directory's files. New source
 * types (github now; arbitrary URL / local path later) drop in by registering a
 * provider — the installer, router, and UI never need to change.
 *
 * Security note: providers fetch UNTRUSTED remote content. They MUST enforce
 * resource limits and reject path traversal / absolute / symlink-escaping entries
 * (the installer also re-validates ids before any disk write).
 */

/** A source-layer failure with a stable, client-safe `code`. */
export type SkillSourceErrorCode =
  | "no-provider" // no registered provider recognized the ref
  | "invalid-ref" // the provider recognized but could not parse the ref
  | "not-found" // the source/ref/path does not exist
  | "too-large" // the skill tree exceeded a size / file-count limit
  | "unsafe-entry" // a fetched entry escaped the skill dir (traversal/symlink/abs)
  | "auth" // authentication required / failed
  | "network"; // transport/transient failure

export class SkillSourceError extends Error {
  readonly code: SkillSourceErrorCode;
  constructor(code: SkillSourceErrorCode, message: string) {
    super(message);
    this.name = "SkillSourceError";
    this.code = code;
  }
}

/** An immutable, pinned reference to a skill directory at a source. */
export interface ResolvedSkillRef {
  /** Provider type that produced this ref, e.g. `"github"`. */
  sourceType: string;
  /** Canonical source identifier (e.g. `"owner/repo"`). */
  source: string;
  /** Immutable pinned version — a commit SHA for git-backed sources. */
  commit: string;
  /** POSIX path within the source to the skill directory. */
  skillPath: string;
  /** The human ref the user requested (branch/tag/sha) before pinning, if any. */
  ref?: string;
}

/** The fetched skill: its pinned ref, a suggested id, and every file in the dir. */
export interface SkillBundle {
  ref: ResolvedSkillRef;
  /** Suggested skill id derived from the source (single safe path segment). */
  suggestedId: string;
  files: SkillFile[];
}

export interface SkillSourceProvider {
  readonly type: string;
  /** True iff this provider recognizes `raw`. Cheap + synchronous. */
  canHandle(raw: string): boolean;
  /** Parse + resolve `raw` to an immutable pinned ref (network for real providers). */
  resolve(raw: string): Promise<ResolvedSkillRef>;
  /** Fetch the skill directory's files at the resolved ref. */
  fetch(ref: ResolvedSkillRef): Promise<SkillBundle>;
}

/**
 * Ordered registry of providers. `resolveProvider` returns the first provider
 * whose `canHandle` matches, or throws `SkillSourceError("no-provider")`.
 */
export class SkillSourceRegistry {
  private readonly providers: SkillSourceProvider[] = [];

  register(provider: SkillSourceProvider): this {
    this.providers.push(provider);
    return this;
  }

  /** First provider that recognizes `raw`. */
  resolveProvider(raw: string): SkillSourceProvider {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (trimmed.length === 0) {
      throw new SkillSourceError("invalid-ref", "Empty skill source reference.");
    }
    const provider = this.providers.find((p) => p.canHandle(trimmed));
    if (!provider) {
      throw new SkillSourceError(
        "no-provider",
        `No installed provider can handle source: ${trimmed}`,
      );
    }
    return provider;
  }

  list(): readonly SkillSourceProvider[] {
    return this.providers;
  }
}
