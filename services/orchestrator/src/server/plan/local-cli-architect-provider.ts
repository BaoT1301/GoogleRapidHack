import { TRPCError } from "@trpc/server";
import { ulid } from "ulid";
import { kiroAdapter } from "../runtime/cli-adapters/kiro";
import { checkCliCapability, type CliCapability } from "../runtime/cli-capabilities";
import { materializePlannerMcpConfig } from "../runtime/runtime-mcp-config";
import { materializePlannerAgent, PLANNER_AGENT_NAME } from "../runtime/planner-agent";
import { ProcessManager } from "../runtime/process-manager";
import { parsePlanResult } from "./schemas";
import {
  buildPlannerPrompt,
  buildRetryReminder,
  extractPlanJson,
} from "./planner-prompt";
import type {
  PlanGenerateInput,
  PlanProvider,
  PlannerSpawn,
} from "./types";

/**
 * Read-only tool set for the local planner. The planner READS code (and the
 * read-only `mcp-context-manager` analysis tools, auto-started via
 * `--require-mcp-startup`) but must NEVER write — write tools are an execute-node
 * concern (Track 4). `fs_read` is kiro-cli's built-in read tool; this mirrors the
 * Sprint-1-verified read-only run configuration. Extend (verified tokens only)
 * via `ORCH_PLAN_READONLY_TOOLS`.
 */
export const PLANNER_READONLY_TOOLS =
  process.env.ORCH_PLAN_READONLY_TOOLS ?? "fs_read";

/** Result of materializing the planner's MCP config (best-effort). */
export interface PlannerMcp {
  mcpConfigPath?: string;
  servers: string[];
  notes: string[];
}

/** Result of materializing the read-only `orch-planner` agent (best-effort). */
export interface PlannerAgent {
  agentName: string;
  agentConfigPath?: string;
  notes: string[];
}

export interface LocalProviderDeps {
  /** Spawn the planner CLI once. Defaults to a ProcessManager-backed runner. */
  spawn?: PlannerSpawn;
  /** Probe kiro availability/auth. Defaults to `checkCliCapability("kiro")`. */
  checkCapability?: () => Promise<CliCapability>;
  /** Working dir for the planner (repo root). MCP + agent configs are written here. */
  resolveCwd?: () => string;
  /** Materialize the codebase-aware MCP config at the cwd. Best-effort. */
  materializeMcp?: (cwd: string) => Promise<PlannerMcp>;
  /** Materialize the read-only `orch-planner` agent config at the cwd. Best-effort. */
  materializeAgent?: (cwd: string) => Promise<PlannerAgent>;
  /** Trust-tools override (read-only). */
  trustTools?: string;
}

export interface LocalHealth {
  provider: "local";
  available: boolean;
  authMode?: CliCapability["authMode"];
  status: "ready" | "not_signed_in" | "not_installed";
  note?: string;
  suggestedFix?: string;
}

const defaultSpawn: PlannerSpawn = (cmd) => {
  // One-shot: a fresh ProcessManager with a synthetic run/node id. The planner is
  // not a graph run, so it does not use the shared run ProcessManager or SSE.
  const pm = new ProcessManager();
  return pm.startProcess({
    runId: `plan-${ulid()}`,
    nodeId: "architect",
    command: cmd.command,
    args: cmd.args,
    cwd: cmd.cwd,
    env: cmd.env,
    cli: "kiro",
    onEvent: () => {},
  });
};

/** Best-effort: write the codebase-aware MCP config; never fail the plan on FS issues. */
const defaultMaterializeMcp = async (cwd: string): Promise<PlannerMcp> => {
  try {
    return await materializePlannerMcpConfig({ cwd });
  } catch (e) {
    return {
      mcpConfigPath: undefined,
      servers: [],
      notes: [`MCP config not materialized: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
};

/**
 * Best-effort: materialize the read-only `orch-planner` agent config at the cwd
 * so `kiro-cli chat --agent orch-planner` discovers it. Never throws — if the
 * write fails the run still passes `--agent orch-planner` and a failed spawn
 * surfaces as the honest LOCAL error below.
 */
const defaultMaterializeAgent = async (cwd: string): Promise<PlannerAgent> => {
  try {
    const r = await materializePlannerAgent({ cwd });
    return { agentName: r.agentName, agentConfigPath: r.agentConfigPath, notes: r.notes };
  } catch (e) {
    return {
      agentName: PLANNER_AGENT_NAME,
      agentConfigPath: undefined,
      notes: [`planner agent not materialized: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
};

/**
 * Local planner — `kiro-cli` running the dedicated read-only `orch-planner`
 * **agent** (`--agent orch-planner`) on the host. The persona + output contract
 * live in the agent's trusted system prompt (Track 1), so the user message
 * carries only the feature request — this defeats kiro's prompt-injection
 * refusal. Output parsing is **lenient** (sentinel → fenced ```json → bare
 * top-level object); the result is zod-validated against the canonical
 * `ContextRequest | GraphSpec` contract, retried ONCE on failure, then surfaced
 * as a clear, honest LOCAL error (never the Cloud "Architect API" message). The
 * successful response is byte-compatible with the Cloud Architect (canvas /
 * plan-map unchanged).
 */
export class LocalCliArchitectProvider implements PlanProvider {
  readonly name = "local" as const;
  private readonly spawn: PlannerSpawn;
  private readonly checkCapability: () => Promise<CliCapability>;
  private readonly resolveCwd: () => string;
  private readonly materializeMcp: (cwd: string) => Promise<PlannerMcp>;
  private readonly materializeAgent: (cwd: string) => Promise<PlannerAgent>;
  private readonly trustTools: string;

  constructor(deps: LocalProviderDeps = {}) {
    this.spawn = deps.spawn ?? defaultSpawn;
    this.checkCapability = deps.checkCapability ?? (() => checkCliCapability("kiro"));
    this.resolveCwd =
      deps.resolveCwd ?? (() => process.env.ORCH_PLAN_LOCAL_CWD ?? process.cwd());
    this.materializeMcp = deps.materializeMcp ?? defaultMaterializeMcp;
    this.materializeAgent = deps.materializeAgent ?? defaultMaterializeAgent;
    this.trustTools = deps.trustTools ?? PLANNER_READONLY_TOOLS;
  }

  async generate(input: PlanGenerateInput) {
    const capability = await this.checkCapability();
    if (!capability.available) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          capability.suggestedFix
            ? `Local planner unavailable: ${capability.note ?? "kiro-cli not ready"} — ${capability.suggestedFix}`
            : `Local planner unavailable: ${capability.note ?? "kiro-cli not ready"}`,
      });
    }

    const cwd = this.resolveCwd();
    // Materialize the dedicated read-only planner agent (persona + contract in
    // its trusted system prompt) and the codebase-aware MCP config. BOTH are
    // best-effort — a planner must not fail because it could not write a config;
    // a failed kiro run then surfaces as the honest LOCAL error below.
    const [agent, mcp] = await Promise.all([
      this.materializeAgent(cwd),
      this.materializeMcp(cwd),
    ]);
    const basePrompt = buildPlannerPrompt(input);
    let prompt = basePrompt;
    let lastError = "unknown error";

    // One initial attempt + exactly one retry (owner decision).
    for (let attempt = 0; attempt < 2; attempt++) {
      let combined: string;
      try {
        combined = await this.runOnce(prompt, cwd, agent.agentName, mcp.mcpConfigPath);
      } catch (e) {
        lastError = `kiro-cli failed to run: ${e instanceof Error ? e.message : String(e)}`;
        prompt = `${basePrompt}\n\n${buildRetryReminder(lastError)}`;
        continue;
      }

      const json = extractPlanJson(combined);
      if (json === null) {
        lastError = "the local planner produced no JSON object (no sentinel/fenced/bare JSON found)";
      } else {
        const parsed = parsePlanResult(json);
        if (parsed.ok) return parsed.value;
        lastError = `the local planner's JSON ${parsed.error}`;
      }
      prompt = `${basePrompt}\n\n${buildRetryReminder(lastError)}`;
    }

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Local planner (kiro-cli) returned no usable plan after one retry: ${lastError}. Try Cloud, or refine the prompt.`,
    });
  }

  private async runOnce(
    prompt: string,
    cwd: string,
    agent: string,
    mcpConfigPath?: string,
  ): Promise<string> {
    const command = kiroAdapter.buildCommand({
      prompt,
      nodeId: "architect",
      worktreePath: cwd,
      agent, // run under the read-only orch-planner agent (system-prompt persona)
      mcpConfigPath, // present → adapter adds --require-mcp-startup
      trustTools: this.trustTools, // read-only — planner never writes
    });
    const result = await this.spawn({
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      env: command.env as NodeJS.ProcessEnv | undefined,
    });
    return `${result.stdoutText}\n${result.stderrText}`;
  }

  /**
   * Basic Local readiness from the kiro capability. Track 3 (PLAN-8b) enriches
   * this with explicit `kiro-cli whoami`/`status` and folds it into a dual-provider
   * health surface. Never echoes a secret.
   */
  async health(): Promise<LocalHealth> {
    const cap = await this.checkCapability();
    const notInstalled = /not found|not installed/i.test(cap.note ?? "");
    const status: LocalHealth["status"] = cap.available
      ? "ready"
      : notInstalled
        ? "not_installed"
        : "not_signed_in";
    return {
      provider: "local",
      available: cap.available,
      authMode: cap.authMode,
      status,
      note: cap.note,
      suggestedFix: cap.suggestedFix,
    };
  }
}
