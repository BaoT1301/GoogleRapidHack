/**
 * RUN-5 — Doc-runner scope guard.
 *
 * SEC-3 (Sprint 8) generalized the doc-only logic into the reusable
 * `write-scope-guard.ts` (`enforceWriteScope` / `checkWriteScope` for any
 * persona-scoped writer). This file is now a THIN PRESET over that module —
 * the documentation write-scope (`.claude/**` + `*.md`; `.kiro/`/`.orchestrator/`
 * neutral) — kept so the existing `run-executor` call sites and tests are
 * unchanged (Do-Not-Invent).
 *
 * Pure + defensive: never throws, tolerant of empty/garbage input.
 */
import {
  DOC_WRITE_SCOPE,
  enforceWriteScope,
  extractChangedPaths,
  isPathInScope,
} from "./write-scope-guard";

// Re-export the generalized patch parser unchanged.
export { extractChangedPaths } from "./write-scope-guard";

/** True when a repo-relative path is within the doc write-scope. */
export function isDocScopedPath(filePath: string): boolean {
  return isPathInScope(filePath, DOC_WRITE_SCOPE);
}

/**
 * Filter an already-clean list of repo-relative changed paths down to the ones
 * OUTSIDE the doc write-scope. The run path uses this (via the fail-closed
 * `checkWriteScope`) with `WorktreeManager.listChangedPaths` (reliable
 * git-sourced names).
 */
export function findOutOfScopePaths(paths: string[]): string[] {
  return enforceWriteScope({ changedPaths: paths, allow: DOC_WRITE_SCOPE });
}

/**
 * Return the changed paths in `patch` that are OUTSIDE the doc write-scope.
 * Empty array ⇒ the patch is docs-only (the `doc` node may pass).
 */
export function findOutOfScopeDocPaths(patch: string): string[] {
  return findOutOfScopePaths(extractChangedPaths(patch));
}
