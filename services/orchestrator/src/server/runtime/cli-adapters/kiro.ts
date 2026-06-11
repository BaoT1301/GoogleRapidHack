import type { CliAdapter } from "./types";
import { normalizeModelId } from "./types";
import { normalizeAllowedTools } from "../kiro-tools";

// Read-only by default: `fs_read` is Kiro's built-in read tool. Write/edit tools
// (e.g. `fs_write`) are opt-in via KIRO_TRUST_TOOLS so agent file edits are a
// deliberate choice. ("read,grep" were never valid kiro-cli tool names.)
const DEFAULT_TRUST_TOOLS = "fs_read";

export const kiroAdapter: CliAdapter = {
  name: "kiro",
  experimental: true,
  buildCommand(input) {
    if (!input.worktreePath || typeof input.worktreePath !== "string") {
      throw new Error("worktreePath is required and must be a string");
    }
    if (typeof input.prompt !== "string" || !input.prompt.trim()) {
      throw new Error("prompt is required and must be a non-empty string");
    }

    // Kiro headless execution is documented, but remains experimental until it
    // is verified locally. Keep write/edit tools opt-in rather than broadly
    // trusting agent actions by default. An explicit `input.trustTools` (e.g. the
    // read-only planner, or the Track-4 UI-configured execute set) wins over the
    // env default so callers can pin the allowed-tools per spawn.
    const rawTrustTools =
      input.trustTools ?? process.env.KIRO_TRUST_TOOLS ?? DEFAULT_TRUST_TOOLS;
    const toolsList = typeof rawTrustTools === "string" ? rawTrustTools.split(",") : [];
    const trustTools = normalizeAllowedTools(toolsList).join(",");

    const args = [
      "chat",
      "--no-interactive",
      `--trust-tools=${trustTools}`
    ];

    // Run under a named agent config when provided (kiro `--agent <name>`). The
    // Local planner passes `orch-planner` so its persona + output contract live
    // in the agent's TRUSTED system prompt — this is what defeats kiro's
    // prompt-injection refusal (PLANFIX-2). Additive: omitted → default agent.
    if (input.agent) {
      if (!/^[a-zA-Z0-9_-]+$/.test(input.agent)) {
        throw new Error(`Invalid agent name: ${input.agent}`);
      }
      args.push(`--agent=${input.agent}`);
    }

    // MODEL-1: pin the model when the run-executor resolved one for this node
    // (node `data.model` → owner's node-type default). Omitted → kiro uses its
    // own configured default model.
    const model = normalizeModelId(input.model);
    if (model) {
      args.push(`--model=${model}`);
    }

    // kiro-cli has no `--mcp-config` flag: it auto-discovers the per-run config
    // the runtime materialized at `<cwd>/.kiro/settings/mcp.json`. Whether the
    // agent must hard-fail when an MCP server cannot start is decided by the
    // run-executor and passed as `input.requireMcpStartup` (resolved from the
    // owner's mcpStartupPolicy + whether any servers survived the reachability
    // filter). When that explicit value is absent we preserve the prior
    // env-driven behavior: require startup whenever a config was materialized,
    // unless KIRO_REQUIRE_MCP_STARTUP=false.
    if (resolveRequireMcpStartup(input.requireMcpStartup, Boolean(input.mcpConfigPath))) {
      args.push("--require-mcp-startup");
    }

    args.push(input.prompt);

    return {
      command: "kiro-cli",
      args,
      cwd: input.worktreePath
    };
  }
};

/**
 * Decide whether to emit `--require-mcp-startup`. The run-executor's explicit
 * boolean (when provided) is authoritative — `false` never forces startup even
 * if a config exists, and `true` requires it. When the caller passes no explicit
 * value we fall back to the legacy env-driven rule.
 */
function resolveRequireMcpStartup(
  explicit: boolean | undefined,
  hasConfig: boolean,
): boolean {
  if (process.env.KIRO_REQUIRE_MCP_STARTUP === "false") return false;
  if (explicit !== undefined) return explicit;
  return hasConfig || process.env.KIRO_REQUIRE_MCP_STARTUP === "true";
}
