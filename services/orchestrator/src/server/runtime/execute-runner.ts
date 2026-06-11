import { getCliAdapter } from "./cli-adapters/index";
import { checkCliCapability } from "./cli-capabilities";
import { materializeMcpConfig } from "./runtime-mcp-config";
import type { McpServerRef } from "./mcp-config-builder";
import { parseOrchOutput } from "./output-parser";
import { checkPathAllowlist, type PathAllowlistEnforcementMode } from "./path-allowlist";
import { ProcessManager } from "./process-manager";
import { redactJsonValue, redactText } from "./redaction";
import { resolveRuntimeLimits } from "./runtime-limits";
import { sseEventHub } from "./sse-event-hub";
import { buildSubprocessEnv, type CliSecretRefs } from "./subprocess-env";
import type { RunRepository } from "./run-repository";
import type {
  RuntimeEvent,
  RuntimeEventType,
  RuntimeStatus,
  SupportedCli
} from "./types";
import { WorktreeManager } from "./worktree-manager";

export interface ExecuteRunnerInput {
  ownerId?: string;
  runId: string;
  graphId?: string;
  nodeId: string;
  rootRepoPath: string;
  baseRef?: string;
  prompt: string;
  cli: SupportedCli;
  secretRefs?: CliSecretRefs;
  apiKeySecretId?: string;
  trustTools?: string;
  mcpOverrides?: McpServerRef[];
  agent?: string;
  /**
   * MODEL-1: model id resolved by the run-executor (node `data.model` → owner's
   * `defaultModelByNodeType`). Threaded to the CLI adapter's model flag. Omitted →
   * the CLI uses its own configured default.
   */
  model?: string;
  /**
   * MCP-RESILIENCE: how to treat MCP-server startup for this node.
   *   - "best-effort" (default): unreachable default servers are filtered out and
   *     the node never hard-fails on MCP startup.
   *   - "require": keep all servers and force `--require-mcp-startup` so the node
   *     fails fast if a configured server cannot start.
   */
  mcpStartupPolicy?: "best-effort" | "require";
  materializeAgent?: (worktreePath: string) => Promise<unknown>;
  materializeSkills?: (worktreePath: string) => Promise<unknown>;
  allowedPaths?: string[];
  pathPolicyMode?: PathAllowlistEnforcementMode;
  timeoutMs?: number;
}

export interface ExecuteRunnerSummary {
  runId: string;
  nodeId: string;
  status: RuntimeStatus;
  worktreePath: string;
  branchName: string;
  exitCode: number | null;
  output?: unknown;
  patchLength: number;
  failureReason?: string;
}

export class ExecuteRunner {
  constructor(
    private readonly worktreeManager = new WorktreeManager(),
    private readonly processManager = new ProcessManager(),
    private readonly runRepository?: RunRepository
  ) {}

  async run(input: ExecuteRunnerInput): Promise<ExecuteRunnerSummary> {
    let worktreePath = "";
    let branchName = "";
    let resolvedBaseRef = input.baseRef ?? "HEAD";
    let exitCode: number | null = null;
    let output: unknown;
    let patchLength = 0;
    let stderrText = "";
    let processStartError: unknown;
    let patchError: unknown;
    let pathPolicyViolation = false;
    let timedOut = false;
    let outputLimitExceeded = false;
    let outputLimitReason: string | undefined;
    let cancelled = false;
    let mcpConfigPath: string | undefined;
    let redactionValues: string[] = [];
    let envFromRuntime: Record<string, string> = {};
    const limits = resolveRuntimeLimits({ timeoutMs: input.timeoutMs });
    const eventBatcher = new NodeEventBatcher(this.runRepository, input.ownerId);
    const publish = (event: RuntimeEvent) => {
      const redacted = redactRuntimeEvent(event, redactionValues);
      const capped = capRuntimeEvent(redacted, limits.maxEventPayloadBytes);
      sseEventHub.publish(capped.runId, capped);
      eventBatcher.enqueue(capped);
    };
    const finish = async (summary: ExecuteRunnerSummary): Promise<ExecuteRunnerSummary> => {
      await eventBatcher.flushAll();
      return this.persistSummary(summary, input.ownerId);
    };

    publish(createEvent("node.starting", input.runId, input.nodeId, {
      cli: input.cli,
      baseRef: resolvedBaseRef
    }));

    const capability = await checkCliCapability(input.cli);
    if (!capability.available) {
      publish(createEvent("node.failed", input.runId, input.nodeId, {
        cli: input.cli,
        command: capability.command,
        reason:
          input.cli === "codex" && capability.note === "Codex CLI not found"
            ? "Codex CLI not found"
            : capability.note ?? "CLI not available",
        suggestedFix:
          capability.suggestedFix ?? `Install ${input.cli} CLI or switch this node to fake`
      }));

      return finish({
        runId: input.runId,
        nodeId: input.nodeId,
        status: "failed",
        worktreePath,
        branchName,
        exitCode,
        patchLength,
        failureReason: "cli-unavailable"
      });
    }

    try {
      const worktree = await this.worktreeManager.createWorktree({
        rootRepoPath: input.rootRepoPath,
        runId: input.runId,
        nodeId: input.nodeId,
        baseRef: input.baseRef
      });

      worktreePath = worktree.worktreePath;
      branchName = worktree.branchName;
      resolvedBaseRef = worktree.baseRef;

      publish(createEvent("node.worktree.created", input.runId, input.nodeId, {
        worktreePath,
        branchName,
        baseRef: resolvedBaseRef
      }));
    } catch (error) {
      publish(createEvent("node.failed", input.runId, input.nodeId, {
        stage: "worktree",
        error: errorMessage(error)
      }));

      return finish({
        runId: input.runId,
        nodeId: input.nodeId,
        status: "failed",
        worktreePath,
        branchName,
        exitCode,
        patchLength,
        failureReason: "worktree"
      });
    }

    try {
      const mcpConfig = await materializeMcpConfig({
        runId: input.runId,
        nodeId: input.nodeId,
        worktreePath,
        cli: input.cli,
        overrides: input.mcpOverrides,
        // MCP-RESILIENCE: under best-effort (default) drop unreachable servers so
        // the node never hard-fails on MCP startup. Under "require" keep them all
        // and let the CLI fail fast if a configured server cannot start.
        filterUnreachable: (input.mcpStartupPolicy ?? "best-effort") !== "require"
      });

      mcpConfigPath = mcpConfig.mcpConfigPath;

      publish(createEvent("node.mcp_config.created", input.runId, input.nodeId, {
        mcpConfigPath,
        servers: mcpConfig.servers,
        skipped: mcpConfig.skipped,
        notes: mcpConfig.notes
      }));
    } catch (error) {
      publish(createEvent("node.failed", input.runId, input.nodeId, {
        stage: "mcp-config",
        error: errorMessage(error)
      }));

      return finish({
        runId: input.runId,
        nodeId: input.nodeId,
        status: "failed",
        worktreePath,
        branchName,
        exitCode,
        patchLength,
        failureReason: "mcp-config"
      });
    }

    if (input.materializeAgent) {
      try {
        await input.materializeAgent(worktreePath);
      } catch {
        // Best-effort: agent materialization never aborts the run.
      }
    }

    if (input.materializeSkills) {
      try {
        await input.materializeSkills(worktreePath);
      } catch {
        // Best-effort: skill materialization never aborts the run.
      }
    }

    try {
      const subprocessEnv = input.ownerId
        ? await buildSubprocessEnv({
            ownerId: input.ownerId,
            runId: input.runId,
            nodeId: input.nodeId,
            graphId: input.graphId,
            cli: input.cli,
            secretRefs: resolveSecretRefs(input)
          })
        : { env: {}, redactionValues: [] };
      redactionValues = subprocessEnv.redactionValues;
      envFromRuntime = subprocessEnv.env;
    } catch (error) {
      publish(createEvent("node.failed", input.runId, input.nodeId, {
        stage: "subprocess-env",
        reason: "Failed to build subprocess environment",
        error: redactText(errorMessage(error), redactionValues)
      }));

      return finish({
        runId: input.runId,
        nodeId: input.nodeId,
        status: "failed",
        worktreePath,
        branchName,
        exitCode,
        patchLength,
        failureReason: "subprocess-env"
      });
    }

    const adapter = getCliAdapter(input.cli);
    const command = adapter.buildCommand({
      prompt: input.prompt,
      nodeId: input.nodeId,
      worktreePath,
      mcpConfigPath,
      allowedPaths: input.allowedPaths,
      pathPolicyMode: input.pathPolicyMode,
      trustTools: input.trustTools,
      agent: input.agent,
      model: input.model,
      // MCP-RESILIENCE: only force `--require-mcp-startup` under the explicit
      // "require" policy; best-effort runs never hard-fail on MCP startup.
      requireMcpStartup: (input.mcpStartupPolicy ?? "best-effort") === "require"
    });

    let stdoutText = "";

    try {
      const processResult = await this.processManager.startProcess({
        runId: input.runId,
        nodeId: input.nodeId,
        command: command.command,
        args: command.args,
        cwd: worktreePath,
        env: mergeProcessEnv(envFromRuntime, command.env),
        cli: input.cli,
        limits,
        onEvent: publish
      });

      exitCode = processResult.exitCode;
      stdoutText = processResult.stdoutText;
      stderrText = processResult.stderrText;
      cancelled = processResult.cancelled;
      timedOut = processResult.timedOut;
      outputLimitExceeded = processResult.outputLimitExceeded;
      outputLimitReason = processResult.outputLimitReason;
    } catch (error) {
      processStartError = error;
    }

    try {
      const patch = await this.worktreeManager.getDiff({
        worktreePath,
        baseRef: resolvedBaseRef
      });
      const changedFiles = await this.worktreeManager.getChangedFiles({
        worktreePath,
        baseRef: resolvedBaseRef
      });

      patchLength = patch.length;

      publish(createEvent("node.patch", input.runId, input.nodeId, {
        patchLength,
        patchPreview: truncateUtf8(patch, limits.maxPatchPreviewBytes).text,
        changedFiles,
        maxPatchPreviewBytes: limits.maxPatchPreviewBytes
      }));

      const allowlist = checkPathAllowlist({
        rootRepoPath: input.rootRepoPath,
        worktreePath,
        changedFiles,
        allowedPaths: input.allowedPaths,
        enforcementMode: input.pathPolicyMode
      });

      if (allowlist.violatingFiles.length > 0 || allowlist.warnings.length > 0) {
        publish(createEvent("node.rule.warning", input.runId, input.nodeId, {
          rule: "allowedPaths",
          mode: allowlist.mode,
          allowedPaths: allowlist.allowedPrefixes,
          violatingFiles: allowlist.violatingFiles,
          warnings: allowlist.warnings
        }));
      }

      pathPolicyViolation = allowlist.violatingFiles.length > 0 && allowlist.mode === "fail";
    } catch (error) {
      patchError = error;
    }

    const parsed = parseOrchOutput(`${stdoutText}\n${stderrText}`);

    if (parsed.ok) {
      output = redactJsonValue(parsed.output, redactionValues);
      publish(createEvent("node.output", input.runId, input.nodeId, {
        output
      }));
    } else {
      publish(createEvent("node.output_parse_failed", input.runId, input.nodeId, {
        error: parsed.error
      }));
    }

    const outputLimitFailure = outputLimitExceeded && limits.outputLimitMode === "fail";

    if (timedOut) {
      publish(createEvent("node.failed", input.runId, input.nodeId, {
        cli: input.cli,
        exitCode,
        stage: "timeout",
        reason: "timeout",
        timeoutMs: limits.timeoutMs
      }));
    } else if (outputLimitFailure) {
      publish(createEvent("node.failed", input.runId, input.nodeId, {
        cli: input.cli,
        exitCode,
        reason: "output_limit_exceeded",
        outputLimitReason,
        limits: {
          maxStdoutBytes: limits.maxStdoutBytes,
          maxStderrBytes: limits.maxStderrBytes,
          maxCombinedOutputBytes: limits.maxCombinedOutputBytes
        }
      }));
    } else if (cancelled) {
      publish(createEvent("node.cancelled", input.runId, input.nodeId, {
        exitCode
      }));
    } else if (processStartError) {
      publish(createEvent(
        "node.failed",
        input.runId,
        input.nodeId,
        buildProcessStartFailurePayload(command.command, input.cli, processStartError)
      ));
    } else if (patchError) {
      publish(createEvent("node.failed", input.runId, input.nodeId, {
        cli: input.cli,
        exitCode,
        stage: "patch",
        reason: "Patch capture failed",
        error: errorMessage(patchError)
      }));
    } else if (pathPolicyViolation) {
      publish(createEvent("node.failed", input.runId, input.nodeId, {
        cli: input.cli,
        exitCode,
        reason: "path_policy_violation",
        message: "Node changed files outside allowedPaths and path policy mode is fail",
        allowedPaths: input.allowedPaths ?? []
      }));
    } else if (exitCode === 0) {
      publish(createEvent("node.completed", input.runId, input.nodeId, {
        cli: input.cli,
        exitCode
      }));
    } else {
      publish(createEvent("node.failed", input.runId, input.nodeId, {
        cli: input.cli,
        exitCode,
        stderrPreview: stderrText.slice(0, 1000)
      }));
    }

    const finalStatus: RuntimeStatus =
      timedOut || outputLimitFailure || pathPolicyViolation
        ? "failed"
        : cancelled
          ? "cancelled"
          : exitCode === 0
            ? "success"
            : "failed";

    return finish({
      runId: input.runId,
      nodeId: input.nodeId,
      status: finalStatus,
      worktreePath,
      branchName,
      exitCode,
      output,
      patchLength,
      failureReason: failureReasonFor({
        finalStatus,
        timedOut,
        outputLimitFailure,
        pathPolicyViolation,
        processStartError,
        patchError,
        exitCode
      })
    });
  }

  private async persistSummary(
    summary: ExecuteRunnerSummary,
    ownerId?: string
  ): Promise<ExecuteRunnerSummary> {
    await persistBestEffort(
      this.runRepository
        ? () =>
            this.runRepository?.updateNodeRun(summary.runId, summary.nodeId, {
              status: summary.status,
              worktreePath: summary.worktreePath,
              branchName: summary.branchName,
              exitCode: summary.exitCode,
              output: summary.output,
              patchLength: summary.patchLength
            }, ownerId)
        : undefined
    );

    return summary;
  }
}

class NodeEventBatcher {
  private readonly events: RuntimeEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | undefined;

  constructor(
    private readonly runRepository: RunRepository | undefined,
    private readonly ownerId: string | undefined
  ) {}

  enqueue(event: RuntimeEvent): void {
    if (!this.runRepository || !event.nodeId) return;

    this.events.push(event);
    if (this.events.length >= 50) {
      void this.flush();
      return;
    }

    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 250);
  }

  async flushAll(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.flush();
    await this.flushing;
  }

  private async flush(): Promise<void> {
    if (!this.runRepository || this.events.length === 0) {
      return;
    }

    const events = this.events.splice(0, this.events.length);
    this.flushing = persistBestEffort(() =>
      this.runRepository?.appendNodeEventsBatch(events, this.ownerId)
    );
    await this.flushing;
  }
}

async function persistBestEffort(
  operation: (() => Promise<void> | void) | undefined
): Promise<void> {
  try {
    await operation?.();
  } catch {
    // Persistence must not interrupt live subprocess execution.
  }
}

function createEvent(
  type: RuntimeEventType,
  runId: string,
  nodeId: string,
  payload: Record<string, unknown> = {}
): RuntimeEvent {
  return {
    type,
    runId,
    nodeId,
    timestamp: new Date().toISOString(),
    payload
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildProcessStartFailurePayload(
  command: string,
  cli: SupportedCli,
  error: unknown
): Record<string, unknown> {
  const code =
    error instanceof Error && "code" in error
      ? (error as NodeJS.ErrnoException).code
      : undefined;

  if (cli === "codex" && code === "ENOENT") {
    return {
      cli,
      command,
      reason: "Codex CLI not found",
      suggestedFix: "Install Codex CLI or switch this node to fake",
      error: errorMessage(error)
    };
  }

  return {
    cli,
    command,
    reason: code === "ENOENT" ? "Executable not found" : "Process failed to start",
    error: errorMessage(error)
  };
}

function redactRuntimeEvent(
  event: RuntimeEvent,
  redactionValues: readonly string[]
): RuntimeEvent {
  return {
    ...event,
    payload: redactJsonValue(event.payload, redactionValues) as Record<string, unknown>
  };
}

function capRuntimeEvent(event: RuntimeEvent, maxPayloadBytes: number): RuntimeEvent {
  const json = JSON.stringify(event.payload);
  if (Buffer.byteLength(json, "utf8") <= maxPayloadBytes) {
    return event;
  }

  return {
    ...event,
    payload: {
      truncated: true,
      originalPayloadBytes: Buffer.byteLength(json, "utf8"),
      preview: truncateUtf8(json, maxPayloadBytes).text
    }
  };
}

function truncateUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return { text: value, truncated: false };
  }

  return {
    text: buffer.subarray(0, Math.max(0, maxBytes)).toString("utf8"),
    truncated: true
  };
}

function mergeProcessEnv(
  runtimeEnv: Record<string, string>,
  adapterEnv: Record<string, string | undefined> | undefined
): Record<string, string | undefined> {
  const merged: Record<string, string> = { ...runtimeEnv };
  for (const [key, value] of Object.entries(adapterEnv ?? {})) {
    if (typeof value === "string") {
      merged[key] = value;
    }
  }
  return merged;
}

function resolveSecretRefs(input: ExecuteRunnerInput): CliSecretRefs | undefined {
  if (input.secretRefs) return input.secretRefs;
  if (!input.apiKeySecretId) return undefined;
  return { [input.cli]: input.apiKeySecretId };
}

function failureReasonFor(input: {
  finalStatus: RuntimeStatus;
  timedOut: boolean;
  outputLimitFailure: boolean;
  pathPolicyViolation: boolean;
  processStartError: unknown;
  patchError: unknown;
  exitCode: number | null;
}): string | undefined {
  if (input.finalStatus !== "failed") return undefined;
  if (input.timedOut) return "timeout";
  if (input.outputLimitFailure) return "output_limit_exceeded";
  if (input.pathPolicyViolation) return "path_policy_violation";
  if (input.processStartError) return "process-start";
  if (input.patchError) return "patch";
  return `exit:${input.exitCode}`;
}
