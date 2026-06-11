/**
 * Per-CLI tool catalogs for the allowed-tools editor.
 *
 * Each supported coding CLI gets a curated catalog of tools the orchestrator
 * MAY grant an EXECUTE node, classified read/write/execute. Today only **kiro**
 * is actually wired into execution (its set maps to `--trust-tools`); the other
 * CLIs are listed so users can pre-configure intent, but their selections are
 * informational until those adapters support per-tool gating (`wired: false`).
 *
 * kiro reuses the canonical set from `kiro-tools.ts` (single source of truth) so
 * `system.kiroTools` and this catalog can never drift.
 */
import {
  KIRO_CANONICAL_TOOLS,
  DEFAULT_ALLOWED_TOOLS as KIRO_DEFAULT_ALLOWED,
  READ_ONLY_TOOL_NAMES as KIRO_READ_ONLY,
  normalizeAllowedTools as normalizeKiroTools,
} from "./kiro-tools";

export type CliToolKind = "read" | "write" | "execute";

export interface CliToolInfo {
  name: string;
  kind: CliToolKind;
  description: string;
}

export interface CliToolCatalog {
  cli: string;
  /** True when the orchestrator wires this CLI's selection into execution. */
  wired: boolean;
  tools: CliToolInfo[];
  /** Safe default set when the user has not configured one (read-only). */
  defaultAllowed: string[];
  /** Read-only tool names — always safe; the planner is locked to these. */
  readOnly: string[];
  /** UI-renderable note (never contains a secret). */
  note?: string;
}

/** CLIs that get an allowed-tools section, in display order (excludes `fake`). */
export const CLI_TOOL_CATALOG_ORDER = ["kiro", "codex", "gemini", "claude"] as const;
export type CatalogCli = (typeof CLI_TOOL_CATALOG_ORDER)[number];

const CODEX_TOOLS: CliToolInfo[] = [
  { name: "read_files", kind: "read", description: "Read files in the sandboxed worktree (read-only sandbox)." },
  { name: "edit_files", kind: "write", description: "Create and edit files (requires workspace-write sandbox)." },
  { name: "run_commands", kind: "execute", description: "Run shell commands inside the workspace-write sandbox." },
];

const GEMINI_TOOLS: CliToolInfo[] = [
  { name: "read_files", kind: "read", description: "Read files in the worktree (read-only)." },
  { name: "edit_files", kind: "write", description: "Create and edit files in the worktree." },
  { name: "run_commands", kind: "execute", description: "Run shell commands in the worktree." },
];

const CLAUDE_TOOLS: CliToolInfo[] = [
  { name: "read_files", kind: "read", description: "Read files in the worktree (read-only)." },
  { name: "edit_files", kind: "write", description: "Create and edit files in the worktree." },
  { name: "run_commands", kind: "execute", description: "Run shell commands in the worktree." },
];

function readOnlyNames(tools: CliToolInfo[]): string[] {
  return tools.filter((t) => t.kind === "read").map((t) => t.name);
}

/** Build a catalog for a non-wired CLI (default + read-only derived from kind). */
function informationalCatalog(
  cli: CatalogCli,
  tools: CliToolInfo[],
  note: string,
): CliToolCatalog {
  const readOnly = readOnlyNames(tools);
  return {
    cli,
    wired: false,
    tools: tools.map((t) => ({ ...t })),
    defaultAllowed: [...readOnly],
    readOnly,
    note,
  };
}

const NOT_WIRED_NOTE =
  "Informational for now — selections are saved but this CLI's adapter does not yet gate tools per selection.";

/** All catalogs, keyed by CLI. */
export const CLI_TOOL_CATALOGS: Record<CatalogCli, CliToolCatalog> = {
  kiro: {
    cli: "kiro",
    wired: true,
    tools: KIRO_CANONICAL_TOOLS.map((t) => ({ ...t })),
    defaultAllowed: [...KIRO_DEFAULT_ALLOWED],
    readOnly: [...KIRO_READ_ONLY],
    note: "Applied to EXECUTE nodes via kiro `--trust-tools`. Writes are opt-in; the planner is always read-only.",
  },
  codex: informationalCatalog("codex", CODEX_TOOLS, NOT_WIRED_NOTE),
  gemini: informationalCatalog("gemini", GEMINI_TOOLS, NOT_WIRED_NOTE),
  claude: informationalCatalog("claude", CLAUDE_TOOLS, NOT_WIRED_NOTE),
};

/** Ordered list of catalogs for the UI. */
export function getCliToolCatalogs(): CliToolCatalog[] {
  return CLI_TOOL_CATALOG_ORDER.map((cli) => CLI_TOOL_CATALOGS[cli]);
}

/** True when `cli` has a known catalog. */
export function isCatalogCli(cli: string): cli is CatalogCli {
  return (CLI_TOOL_CATALOG_ORDER as readonly string[]).includes(cli);
}

/**
 * Normalize a user-supplied allowed-tools list for a specific CLI:
 *   - keep only names KNOWN to that CLI's catalog (drops unknown/invented),
 *   - drop wildcard / "trust-all" attempts,
 *   - de-duplicate, preserve catalog order,
 *   - never return empty → falls back to the CLI's read-only default.
 *
 * kiro delegates to the canonical `normalizeAllowedTools` so its exact (tested)
 * semantics are preserved.
 */
export function normalizeToolsForCli(
  cli: string,
  input: readonly string[] | undefined,
): string[] {
  if (cli === "kiro") return normalizeKiroTools(input);
  if (!isCatalogCli(cli)) return [];
  const catalog = CLI_TOOL_CATALOGS[cli];
  const requested = new Set(
    (input ?? [])
      .map((t) => String(t).trim())
      .filter((t) => t.length > 0 && t !== "*" && t.toLowerCase() !== "all"),
  );
  const allowed = catalog.tools.map((t) => t.name).filter((n) => requested.has(n));
  return allowed.length > 0 ? allowed : [...catalog.defaultAllowed];
}
