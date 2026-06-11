/**
 * Canonical kiro-cli tool surface for the web allowed-tools editor (CLI-4).
 *
 * kiro-cli 2.5.1 does not expose a stable machine-readable `tools` listing (same
 * verification posture as MCP-1), so this is the orchestrator's **curated**
 * canonical set with read/write/execute classification. The verified names are
 * `fs_read` / `fs_write` (see `cli-capabilities.ts` + the kiro adapter — the
 * contract's earlier `read,grep` were never valid kiro tool names). Ops can extend
 * the set here as new tools are verified.
 */

export type KiroToolKind = "read" | "write" | "execute";

export interface KiroToolInfo {
  name: string;
  kind: KiroToolKind;
  description: string;
}

export const KIRO_CANONICAL_TOOLS: readonly KiroToolInfo[] = [
  { name: "fs_read", kind: "read", description: "Read files, directories, and images (read-only)." },
  { name: "fs_write", kind: "write", description: "Create and edit files in the worktree." },
  { name: "execute_bash", kind: "execute", description: "Run shell commands in the worktree." },
] as const;

export const KIRO_TOOL_NAMES: readonly string[] = KIRO_CANONICAL_TOOLS.map((t) => t.name);

/** Read-only tools — the planner is locked to these; the safe execute default too. */
export const READ_ONLY_TOOL_NAMES: readonly string[] = KIRO_CANONICAL_TOOLS.filter(
  (t) => t.kind === "read",
).map((t) => t.name);

/** Safe default allowed set when a user has not configured one (read-only). */
export const DEFAULT_ALLOWED_TOOLS: readonly string[] = READ_ONLY_TOOL_NAMES;

/**
 * Normalize a user-supplied allowed-tools list into a safe, canonical set:
 *   - keep only KNOWN canonical tool names (drops unknown/invented tokens),
 *   - drop any wildcard / "trust-all" attempt (never trust everything),
 *   - de-duplicate, preserve canonical order,
 *   - never return empty → falls back to the read-only default.
 */
export function normalizeAllowedTools(input: readonly string[] | undefined): string[] {
  const requested = new Set(
    (input ?? [])
      .map((t) => String(t).trim())
      .filter((t) => t.length > 0 && t !== "*" && t.toLowerCase() !== "all"),
  );
  const allowed = KIRO_CANONICAL_TOOLS.map((t) => t.name).filter((n) => requested.has(n));
  return allowed.length > 0 ? allowed : [...DEFAULT_ALLOWED_TOOLS];
}

/** Join an allowed-tools set into the `--trust-tools=` argument value for kiro. */
export function toTrustToolsArg(tools: readonly string[]): string {
  return normalizeAllowedTools(tools).join(",");
}
