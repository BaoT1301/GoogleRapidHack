/**
 * SEC-3 — Write-scope enforcement (pure, generalized from RUN-5's doc guard).
 *
 * Given a list of repo-relative changed paths and a declared allowlist, returns
 * the paths OUTSIDE the allowlist. The run path enforces this at the merge/patch
 * boundary so an out-of-scope agent edit is never merged. It also provides a
 * FAIL-CLOSED `checkWriteScope` that treats an indeterminate path listing (the
 * lister threw) as a violation — never "merge on unknown".
 *
 * RESIDUAL LIMITATION (documented SEC-3 risk): the orchestrator cannot intercept
 * kiro's in-process fs writes — a true kernel-level path allowlist (blocking at
 * the tool boundary) is out of reach. This is the strongest reachable enforcement
 * (post-run, at the patch/merge boundary) and supersedes the old soft guard.
 *
 * Pure + defensive: never throws (except the explicitly-async checkWriteScope,
 * which converts a thrown lister into a fail-closed verdict).
 */

export interface WriteScopeAllow {
  /** Repo-relative path prefixes always in scope (e.g. ".claude/"). */
  prefixes?: string[];
  /** Exact repo-relative paths always in scope (e.g. ".claude"). */
  exact?: string[];
  /** File extensions (lowercased, leading dot) always in scope (e.g. ".md"). */
  extensions?: string[];
  /**
   * NEUTRAL prefixes — orchestrator-materialized plumbing that is never an
   * agent/user write (`.kiro/`, `.orchestrator/`); always treated in-scope.
   */
  neutralPrefixes?: string[];
  /** NEUTRAL exact paths (`.kiro`, `.orchestrator`). */
  neutralExact?: string[];
}

/** The documentation write-scope: `.claude/**` + `*.md`; `.kiro/`+`.orchestrator/` neutral. */
export const DOC_WRITE_SCOPE: WriteScopeAllow = {
  prefixes: [".claude/"],
  exact: [".claude"],
  extensions: [".md"],
  neutralPrefixes: [".kiro/", ".orchestrator/"],
  neutralExact: [".kiro", ".orchestrator"],
};

/**
 * The review READ-ONLY scope: NOTHING is writable except the orchestrator's own
 * materialized plumbing (`.kiro/`, `.orchestrator/`), which is never an agent
 * write. Any real changed path ⇒ a read-only violation. SEC-3 uses this to assert
 * a `review` node produced no substantive patch (a real reviewer runs `fs_read`
 * only; this makes the contract explicit + fail-closed).
 */
export const REVIEW_READONLY_SCOPE: WriteScopeAllow = {
  neutralPrefixes: [".kiro/", ".orchestrator/"],
  neutralExact: [".kiro", ".orchestrator"],
};

/** True when `filePath` is within the declared write-scope `allow`. */
export function isPathInScope(filePath: string, allow: WriteScopeAllow): boolean {
  if (typeof filePath !== "string") return false;
  const p = filePath.trim().replace(/^\.\//, "");
  if (!p || p === "dev/null") return true; // /dev/null side of an add/delete — ignore

  for (const ex of allow.neutralExact ?? []) if (p === ex) return true;
  for (const pre of allow.neutralPrefixes ?? []) {
    if (p === pre.replace(/\/+$/, "") || p.startsWith(pre)) return true;
  }
  for (const ext of allow.extensions ?? []) {
    if (p.toLowerCase().endsWith(ext.toLowerCase())) return true;
  }
  for (const ex of allow.exact ?? []) if (p === ex) return true;
  for (const pre of allow.prefixes ?? []) {
    if (p === pre.replace(/\/+$/, "") || p.startsWith(pre)) return true;
  }
  return false;
}

/**
 * Enforce a write-scope: return the changed paths OUTSIDE `allow`. Empty result
 * ⇒ every change is in scope (the node may pass).
 */
export function enforceWriteScope(input: {
  changedPaths: string[];
  allow: WriteScopeAllow;
}): string[] {
  if (!input || !Array.isArray(input.changedPaths)) return [];
  return input.changedPaths.filter(
    (p) => typeof p === "string" && !isPathInScope(p, input.allow),
  );
}

export type WriteScopeVerdict =
  | { ok: true }
  | { ok: false; reason: "out-of-scope"; outOfScope: string[] }
  | { ok: false; reason: "indeterminate"; error: string };

/**
 * FAIL-CLOSED scope check. Calls `listChangedPaths` (which may THROW on an
 * indeterminate git state) and returns a verdict:
 *   • lister throws            ⇒ `{ ok:false, reason:"indeterminate" }` (never merge);
 *   • any out-of-scope path    ⇒ `{ ok:false, reason:"out-of-scope", outOfScope }`;
 *   • all paths in scope       ⇒ `{ ok:true }`.
 * The run path FAILS the node on any non-ok verdict.
 */
export async function checkWriteScope(input: {
  listChangedPaths: () => Promise<string[]>;
  allow: WriteScopeAllow;
}): Promise<WriteScopeVerdict> {
  let changed: string[];
  try {
    changed = await input.listChangedPaths();
  } catch (error) {
    return {
      ok: false,
      reason: "indeterminate",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const outOfScope = enforceWriteScope({ changedPaths: changed, allow: input.allow });
  if (outOfScope.length > 0) return { ok: false, reason: "out-of-scope", outOfScope };
  return { ok: true };
}

/** Strip a leading `a/` or `b/` git path prefix. */
function stripGitPrefix(p: string): string {
  if (p.startsWith("a/") || p.startsWith("b/")) return p.slice(2);
  return p;
}

/**
 * Extract every changed file path referenced by a unified git patch. Reads the
 * `diff --git a/X b/Y`, `--- a/X`, `+++ b/Y`, and `rename from/to` headers.
 * (Generalized from the RUN-5 doc guard; retained for callers that only have the
 * patch text — the run path prefers the clean git-sourced `listChangedPaths`.)
 */
export function extractChangedPaths(patch: string): string[] {
  if (!patch || typeof patch !== "string") return [];
  const paths = new Set<string>();

  for (const rawLine of patch.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    const gitHeader = line.match(/^diff --git (\S+) (\S+)$/);
    if (gitHeader) {
      paths.add(stripGitPrefix(gitHeader[1]));
      paths.add(stripGitPrefix(gitHeader[2]));
      continue;
    }

    const minus = line.match(/^--- (\S+)/);
    if (minus && minus[1] !== "/dev/null") {
      paths.add(stripGitPrefix(minus[1]));
      continue;
    }

    const plus = line.match(/^\+\+\+ (\S+)/);
    if (plus && plus[1] !== "/dev/null") {
      paths.add(stripGitPrefix(plus[1]));
      continue;
    }

    const renameFrom = line.match(/^rename from (.+)$/);
    if (renameFrom) {
      paths.add(renameFrom[1]);
      continue;
    }
    const renameTo = line.match(/^rename to (.+)$/);
    if (renameTo) {
      paths.add(renameTo[1]);
      continue;
    }
  }

  paths.delete("dev/null");
  paths.delete("/dev/null");
  return [...paths];
}
