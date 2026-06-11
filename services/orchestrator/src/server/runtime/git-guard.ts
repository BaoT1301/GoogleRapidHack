/**
 * SEC-6 — Destructive-git guard (pure).
 *
 * A central, conservative DENYLIST that rejects the destructive git invocations
 * the orchestrator's own plumbing must never issue, while passing through every
 * known-safe op it DOES use (ff-only merge, `update-ref` with a backup,
 * `worktree add/remove/prune`, `checkout --force` of a fresh worktree, deleting
 * its OWN `agent/`/`integration/`/`merge/` branches). Wrapping the coordinators'
 * `runGit` helpers through `assertSafeGitArgs` turns "we use safe flags by
 * convention" into an ENFORCED invariant — a future regression that introduces a
 * destructive op fails loudly.
 *
 * Rejected:
 *   • `push --force` / `-f` / `--force-with-lease`
 *   • `reset --hard`
 *   • `clean -f[d][x]` / `--force`
 *   • `branch -D` / `-d` of a NON-orchestrator branch
 *   • `git rm` with `-r` / `-f`
 *
 * RESIDUAL RISK (documented): agent-issued shell git (via the opt-in
 * `execute_bash` trust tool) runs in the agent's own process and is bounded but
 * NOT fully preventable from the host — this guard covers the orchestrator's own
 * plumbing only.
 *
 * Pure + defensive: `isDestructiveGitCommand` NEVER throws (returns a verdict);
 * `assertSafeGitArgs` throws a clear error only on a destructive op.
 */

/** Branch-name prefixes the orchestrator creates and may safely delete. */
export const ORCHESTRATOR_BRANCH_PREFIXES = [
  "agent/",
  "integration/",
  "merge/",
  "orch/",
];

export interface GitGuardVerdict {
  destructive: boolean;
  reason?: string;
}

/**
 * Find the git subcommand, skipping leading global options (`-C <path>`,
 * `-c <cfg>`, `--git-dir=…`, other `--global` flags). Returns the subcommand and
 * the remaining args after it.
 */
function findSubcommand(args: string[]): { sub?: string; rest: string[] } {
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    // Global options that consume a following value.
    if (a === "-C" || a === "-c" || a === "--git-dir" || a === "--work-tree" || a === "--namespace") {
      i += 2;
      continue;
    }
    if (a.startsWith("-")) {
      // Other global flag/`--opt=value` form — single token.
      i += 1;
      continue;
    }
    return { sub: a, rest: args.slice(i + 1) };
  }
  return { rest: [] };
}

const isDeleteFlag = (token: string): boolean =>
  token === "-D" || token === "-d" || token === "--delete" || /^-[A-Za-z]*[Dd]$/.test(token);

const isForceCleanFlag = (token: string): boolean =>
  token === "--force" || /^-[a-z]*f/.test(token); // -f, -fd, -fdx, -xf, …

const isRecursiveOrForceRm = (token: string): boolean =>
  token === "--force" || /^-[a-z]*[rf]/.test(token); // -r, -f, -rf, -fr, …

/**
 * Classify a git argv (WITHOUT the leading "git"; a leading `-C <cwd>` is
 * tolerated). Returns `{ destructive: true, reason }` for a forbidden op, else
 * `{ destructive: false }`. Default is SAFE — only the explicit dangerous combos
 * are flagged, so existing safe ops pass through unchanged.
 */
export function isDestructiveGitCommand(args: string[]): GitGuardVerdict {
  if (!Array.isArray(args) || args.length === 0) return { destructive: false };
  const { sub, rest } = findSubcommand(args);
  if (!sub) return { destructive: false };

  switch (sub) {
    case "push": {
      if (
        rest.some(
          (r) =>
            r === "--force" ||
            r === "-f" ||
            r === "--force-with-lease" ||
            r.startsWith("--force-with-lease="),
        )
      ) {
        return { destructive: true, reason: "git push --force/--force-with-lease is forbidden" };
      }
      return { destructive: false };
    }
    case "reset": {
      if (rest.includes("--hard")) {
        return { destructive: true, reason: "git reset --hard is forbidden" };
      }
      return { destructive: false };
    }
    case "clean": {
      if (rest.some(isForceCleanFlag)) {
        return { destructive: true, reason: "git clean -f is forbidden" };
      }
      return { destructive: false };
    }
    case "branch": {
      if (rest.some(isDeleteFlag)) {
        const names = rest.filter((r) => !r.startsWith("-"));
        const offending = names.filter(
          (n) => !ORCHESTRATOR_BRANCH_PREFIXES.some((p) => n.startsWith(p)),
        );
        // A delete with no resolvable name, or any non-orchestrator branch → reject.
        if (names.length === 0 || offending.length > 0) {
          return {
            destructive: true,
            reason: `git branch delete of a non-orchestrator branch is forbidden${
              offending.length ? `: ${offending.join(", ")}` : ""
            }`,
          };
        }
      }
      return { destructive: false };
    }
    case "rm": {
      if (rest.some(isRecursiveOrForceRm)) {
        return { destructive: true, reason: "git rm -r/-f is forbidden" };
      }
      return { destructive: false };
    }
    default:
      return { destructive: false };
  }
}

/**
 * Throw a clear error if `args` is a destructive git op; otherwise a pass-through
 * no-op. Wrap a coordinator's `runGit(cwd, args)` with this BEFORE spawning git.
 */
export function assertSafeGitArgs(args: string[]): void {
  const verdict = isDestructiveGitCommand(args);
  if (verdict.destructive) {
    throw new Error(
      `Refusing destructive git command (SEC-6): git ${args.join(" ")} — ${verdict.reason}`,
    );
  }
}
