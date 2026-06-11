import { authedProcedure, createTRPCRouter } from "../init";
import {
  getAllCliCapabilities,
  SUPPORTED_CLI_ORDER,
  type CliCapability,
} from "../runtime/cli-capabilities";
import {
  KIRO_CANONICAL_TOOLS,
  DEFAULT_ALLOWED_TOOLS,
  READ_ONLY_TOOL_NAMES,
} from "../runtime/kiro-tools";
import { getCliToolCatalogs } from "../runtime/cli-tool-catalogs";
import type { SupportedCli } from "../runtime/types";

/**
 * System / capabilities tRPC surface (CLI-5).
 *
 * Read-only, authed query that surfaces `getAllCliCapabilities()` to the client
 * so the UI can render CLI auth state (RUN-8 `CliAuthBadge`) and planner
 * readiness. This formally reverses locked decision #8 (CLI capabilities are now
 * served from the monolith, not the retired `orchestrator-api` prototype) —
 * recorded with owner sign-off in the Sprint 2 active task.
 *
 * ZERO-SECRET LEAKAGE (AD-8): the response is an EXPLICIT allow-list projection.
 * We never spread the raw `CliCapability` and never echo a key value. Fields that
 * could leak host detail (`executablePath`, `configuredModel`, `useCd`) are
 * intentionally dropped — the UI only needs auth/availability + guidance.
 *
 * Contract: `.claude/docs/core/api-contracts/cli-capabilities-api.md`.
 */

export type CliAuthMode = "host-login" | "api-key" | "unauthenticated";

export interface PublicCliCapability {
  /** Which CLI this entry describes. */
  cli: SupportedCli;
  /** True when the CLI is installed AND usable (for kiro: host-login or API key). */
  available: boolean;
  /** Resolved auth state (kiro today); absent for CLIs without an auth concept. */
  authMode?: CliAuthMode;
  /** First line of `<cli> --version`, when detectable. */
  version?: string;
  /** Adapter is not yet locally verified. */
  experimental?: boolean;
  /** Adapter + headless flow verified locally. */
  verified?: boolean;
  /** A key is only ever a fallback — never strictly required (kiro). */
  requiresApiKey?: boolean;
  /** Codex sandbox posture, when applicable. */
  sandboxMode?: "read-only" | "workspace-write";
  /** Human-readable, UI-renderable status note (never contains a key value). */
  note?: string;
  /** Actionable fix hint shown when the CLI is not ready. */
  suggestedFix?: string;
  /** Non-secret operational warnings (e.g. model-compat advisories). */
  warnings?: string[];
}

/**
 * Project an internal `CliCapability` to its public, secret-free shape. This is
 * an explicit pick (allow-list) rather than a spread so a future field added to
 * `CliCapability` can never silently leak through this boundary.
 */
export function toPublicCapability(
  cli: SupportedCli,
  cap: CliCapability,
): PublicCliCapability {
  const out: PublicCliCapability = {
    cli,
    available: cap.available,
  };
  if (cap.authMode !== undefined) out.authMode = cap.authMode;
  if (cap.version !== undefined) out.version = cap.version;
  if (cap.experimental !== undefined) out.experimental = cap.experimental;
  if (cap.verified !== undefined) out.verified = cap.verified;
  if (cap.requiresApiKey !== undefined) out.requiresApiKey = cap.requiresApiKey;
  if (cap.sandboxMode !== undefined) out.sandboxMode = cap.sandboxMode;
  if (cap.note !== undefined) out.note = cap.note;
  if (cap.suggestedFix !== undefined) out.suggestedFix = cap.suggestedFix;
  if (cap.warnings !== undefined && cap.warnings.length > 0) {
    out.warnings = [...cap.warnings];
  }
  return out;
}

export const systemRouter = createTRPCRouter({
  /**
   * Per-CLI capability + auth snapshot, ordered by `SUPPORTED_CLI_ORDER`.
   * Read-only; never returns a secret/key value (AD-8).
   */
  capabilities: authedProcedure.query(async (): Promise<PublicCliCapability[]> => {
    const all = await getAllCliCapabilities();
    return SUPPORTED_CLI_ORDER.map((cli) => toPublicCapability(cli, all[cli]));
  }),

  /**
   * Canonical kiro tool surface for the allowed-tools editor (CLI-4). Read-only;
   * additive sibling to `capabilities` (its shape is unchanged). The UI renders
   * `tools` as toggles and persists the chosen set via `settings.update`; the
   * planner is always locked to `readOnly`.
   */
  kiroTools: authedProcedure.query(() => ({
    tools: KIRO_CANONICAL_TOOLS.map((t) => ({ ...t })),
    defaultAllowed: [...DEFAULT_ALLOWED_TOOLS],
    readOnly: [...READ_ONLY_TOOL_NAMES],
  })),

  /**
   * Per-CLI tool catalogs for the allowed-tools editor (grouped by CLI). Each
   * catalog carries a `wired` flag — today only kiro is wired into execution;
   * the others are saved as intent but informational until their adapters gate
   * tools per selection. Read-only; never returns a secret value (AD-8).
   */
  cliTools: authedProcedure.query(() => getCliToolCatalogs()),
});
