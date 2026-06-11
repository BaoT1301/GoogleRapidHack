import type { SupportedCli } from "../types";

export interface CliAdapterInput {
  prompt: string;
  nodeId: string;
  worktreePath: string;
  mcpConfigPath?: string;
  instructionFilePath?: string;
  allowedPaths?: string[];
  pathPolicyMode?: "warn" | "fail";
  /**
   * Explicit allowed-tools set for CLIs that support a trust-tools flag (kiro).
   * When provided it takes precedence over env defaults — the read-only planner
   * passes a read-only set; execute nodes pass the UI-configured set (Track 4).
   */
  trustTools?: string;
  /**
   * Named agent config to run under (kiro `--agent <name>`). The Local planner
   * (PLANFIX-2) passes `orch-planner` so the persona + output contract live in
   * the agent's trusted system prompt (defeats the prompt-injection refusal).
   * Optional + additive — execute nodes omit it and run the default agent.
   */
  agent?: string;
  /**
   * MODEL-1: explicit model id for CLIs that support a model flag (kiro
   * `--model`, codex `-m`, claude `--model`, gemini `-m`; `fake` forwards it via
   * the `FAKE_AGENT_MODEL` env var). Resolved per node by the run-executor
   * (node `data.model` → owner's `defaultModelByNodeType` → CLI default). Optional
   * + additive — when omitted each adapter emits its exact prior args and the CLI
   * uses its own configured default model.
   */
  model?: string;
  /**
   * MCP-RESILIENCE: explicit control over whether the spawned CLI must hard-fail
   * when an MCP server cannot start (kiro `--require-mcp-startup`). Resolved by
   * the run-executor from the owner's `mcpStartupPolicy` (+ per-node/graph
   * override) and whether any MCP servers remained after the reachability filter.
   * When `undefined`, adapters preserve their prior env-driven behavior for
   * backward compatibility.
   */
  requireMcpStartup?: boolean;
}

/**
 * Validate a model id before it is interpolated into a CLI argument. Keeps the
 * surface deliberately narrow (alphanumerics + `._:-/`) so a model value can
 * never smuggle a flag or shell metacharacter into the spawned command. Returns
 * the trimmed id, or `undefined` for blank/absent input (CLI uses its default).
 */
export function normalizeModelId(model: string | undefined): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed) return undefined;
  if (!/^[a-zA-Z0-9._:/-]+$/.test(trimmed)) {
    throw new Error(`Invalid model id: ${model}`);
  }
  return trimmed;
}

export interface CliCommand {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
}

export interface CliAdapter {
  name: SupportedCli;
  experimental?: boolean;
  buildCommand(input: CliAdapterInput): CliCommand;
}
