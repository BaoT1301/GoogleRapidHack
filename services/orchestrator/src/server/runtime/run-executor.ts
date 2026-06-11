// run-executor — the entry point that drives a run through Stephen's ExecuteRunner.
// Loads the run's immutable graphSnapshot, picks the Execute nodes, and runs them
// (parallel, capped) with the MongoRunRepository so state persists to Mongo and
// events stream via the SSE shim. Called by the `runs.start` tRPC mutation.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { connectDB } from "@/db/client";
import { RunModel, GraphModel, type INodeSpec } from "@/db/models";
import { ulid } from "ulid";
import { ExecuteRunner, type ExecuteRunnerSummary } from "./execute-runner";
import { ProcessManager } from "./process-manager";
import { sharedPtySessionManager } from "./pty-session-manager";
import { mongoRunRepository } from "./mongo-run-repository";
import { sseEventHub } from "./sse-event-hub";
import { createChildGraph } from "../graphs/spawn-child";
import { runSimpleScheduler } from "./simple-scheduler";
import { resolveGate, resolveGateFanInMode, type FanInMode, type GateResolution, type UpstreamStatus } from "./gate-runner";
import { runMergeBack, type MergeBackNode } from "./merge-back-coordinator";
import { syncMainCheckout } from "./sync-main-checkout";
import {
  createIntegrationBranch,
  checkpointWorktree,
  flowParents,
  resolveExecuteAncestors,
  terminalExecuteNodes,
} from "./lineage-coordinator";
import { resolveMergeStrategy } from "../settings/merge-strategy";
import { WorktreeManager } from "./worktree-manager";
import { ensureBaseBranch } from "./ensure-base-branch";
import { toTrustToolsArg } from "./kiro-tools";
import { resolveContextMcpOverrides } from "./context-mcp-overrides";
import { assembleNodePrompt } from "./prompt-assembly";
import { resolvePersona } from "../templates/resolve-template";
import {
  materializeSkills as materializeSkillsInto,
  loadSkillsForPreamble,
  applySkillsPreamble,
  skillDirForCli,
} from "./skill-materializer";
import {
  materializeReviewerAgent,
  REVIEWER_AGENT_NAME,
  REVIEWER_TRUST_TOOLS,
} from "./reviewer-agent";
import { materializeDocAgent, DOC_AGENT_NAME, DOC_TRUST_TOOLS } from "./doc-agent";
import { checkWriteScope, DOC_WRITE_SCOPE, REVIEW_READONLY_SCOPE } from "./write-scope-guard";
import {
  resolveLoopChildGraphId,
  clampMaxIterations,
} from "./loop-runner";
import { runPlanNode } from "./plan-node-runner";
import type { RuntimeEvent } from "./types";
import { CircuitBreaker } from "./circuit-breaker";
import { startRunForGraph } from "../runs/start-run";
import { resolveAllowedTools } from "../settings/allowed-tools";
import { resolveNodeModelDefaults, resolveNodeModelId, resolveNodeMcpStartupPolicy } from "../settings/node-model-defaults";
import type { SupportedCli } from "./types";
import { SUPPORTED_CLIS } from "./types";
import type { CliSecretRefs } from "./subprocess-env";

const MAX_CONCURRENCY = 4;
const VALID_CLIS: readonly SupportedCli[] = SUPPORTED_CLIS;
const execFileAsync = promisify(execFile);

// Shared, HMR-safe ProcessManager so `runs.cancel` can reach a run's live
// processes (each ExecuteRunner would otherwise own a private instance).
const g = globalThis as unknown as { __orchProcessManager?: ProcessManager };
export const sharedProcessManager: ProcessManager =
  g.__orchProcessManager ?? (g.__orchProcessManager = new ProcessManager());

interface SnapshotNode {
  id: string;
  kind?: string;
  data?: {
    cli?: string;
    prompt?: string;
    baseRef?: string;
    apiKeySecretId?: string;
    secretRefs?: unknown;
    allowedPaths?: unknown;
    pathPolicyMode?: unknown;
    timeoutMs?: unknown;
    objective?: string;
    provider?: string;
    model?: string;
    allowDownstreamAfterProposal?: boolean;
    maxIterations?: number;
    breakCondition?: string;
    childGraphId?: string;
    persona?: string;
  };
  label?: string;
}

interface SnapshotEdge {
  source: string;
  target: string;
  kind?: string;
  fanInMode?: FanInMode;
}

// A skipped result for a node with no runner yet (non-`execute` kinds).
function skippedSummary(runId: string, nodeId: string): ExecuteRunnerSummary {
  return {
    runId,
    nodeId,
    status: "skipped",
    worktreePath: "",
    branchName: "",
    exitCode: null,
    patchLength: 0,
  };
}

// RUN-3: a synthetic success result for a `gate` node that passed its fan-in.
// Gates do no git/CLI work — they are pure convergence verdicts — so they carry
// no worktree/branch. Returning `success` lets the scheduler treat the gate as a
// satisfied predecessor so its descendants proceed.
function gateSummary(runId: string, nodeId: string): ExecuteRunnerSummary {
  return {
    runId,
    nodeId,
    status: "success",
    worktreePath: "",
    branchName: "",
    exitCode: null,
    patchLength: 0,
  };
}

function gateOutput(
  resolution: GateResolution,
  status: "passed" | "blocked",
  reason?: string,
): Record<string, unknown> {
  return {
    kind: "gate",
    status,
    fanInMode: resolution.fanInMode,
    upstreamTotal: resolution.upstreamCount,
    upstreamSucceeded: resolution.succeededCount,
    upstreamFailed: resolution.failedCount,
    upstreamSkipped: resolution.skippedCount,
    upstreamBlocked: resolution.blockedCount,
    reason: reason ?? resolution.reason,
    evaluatedAt: new Date().toISOString(),
  };
}

type LoopOutputStatus = "completed" | "failed" | "exhausted" | "cancelled";

function loopOutput(input: {
  status: LoopOutputStatus;
  childGraphId?: string;
  iterations: number;
  maxIterations: number;
  breakCondition?: string;
  breakReason: string;
  childRunIds: string[];
}): Record<string, unknown> {
  return {
    kind: "loop",
    status: input.status,
    childGraphId: input.childGraphId,
    iterations: input.iterations,
    maxIterations: input.maxIterations,
    breakCondition: input.breakCondition,
    breakConditionEvaluated: false,
    breakReason: input.breakReason,
    childRunIds: input.childRunIds,
    finishedAt: new Date().toISOString(),
  };
}

// Lineage: a convergence node whose parent-branch integration conflicted — it is
// `blocked` (not run). The integration branch/worktree are carried so the run can
// reference + preserve them for the auto-spawned reviewer.
function blockedSummary(
  runId: string,
  nodeId: string,
  branchName = "",
  worktreePath = "",
): ExecuteRunnerSummary {
  return {
    runId,
    nodeId,
    status: "blocked",
    worktreePath,
    branchName,
    exitCode: null,
    patchLength: 0,
  };
}

// Lineage: the set of flow-ancestors (transitive) of the given nodes, plus the
// nodes themselves — used to prune only branches whose work has landed on base.
function executeAncestorClosure(
  startIds: string[],
  edges: { source: string; target: string; kind?: string }[],
): Set<string> {
  const closure = new Set<string>(startIds);
  const stack = [...startIds];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const parent of flowParents(id, edges)) {
      if (!closure.has(parent)) {
        closure.add(parent);
        stack.push(parent);
      }
    }
  }
  return closure;
}

interface ConflictedMergeNode {
  nodeId: string;
  branchName: string;
  conflictFiles?: string[];
  mergeWorktreePath?: string;
  diffPreview?: string;
  message?: string;
}

/**
 * GIT-2 + GIT-3: handle a merge conflict on a node's auto-merge-back.
 * - marks the node `blocked` ("merge-blocked") and persists the full conflict
 *   context (`conflictFiles`, `mergeWorktreePath`, `diffPreview`);
 * - auto-spawns an `integration_reviewer` child sub-graph seeded with the
 *   conflict (idempotent — one reviewer per conflicted node);
 * - emits `merge.conflicted` (with `reviewerGraphId` so the UI can open it).
 *
 * The preserved merge worktree is NEVER touched here (the reviewer needs it),
 * and the user's working tree is never auto-aborted.
 */
async function handleMergeConflict(input: {
  runId: string;
  ownerId: string;
  graphId: string;
  baseBranch: string;
  node: ConflictedMergeNode;
}): Promise<void> {
  const { runId, ownerId, graphId, baseBranch, node } = input;

  // Mark merge-blocked + persist the conflict so the UI/reviewer can surface it.
  await mongoRunRepository.updateNodeRun(runId, node.nodeId, {
    status: "blocked",
    output: {
      merge: {
        status: "conflicted",
        sourceBranch: node.branchName,
        baseBranch,
        conflictFiles: node.conflictFiles ?? [],
        mergeWorktreePath: node.mergeWorktreePath,
        diffPreview: node.diffPreview,
      },
    },
  }, input.ownerId);

  // Auto-spawn an integration_reviewer child sub-graph (idempotent, best-effort).
  const reviewerGraphId = await spawnConflictReviewer({
    ownerId,
    graphId,
    parentNodeId: node.nodeId,
    baseBranch,
    node,
  });

  sseEventHub.publish(runId, {
    type: "merge.conflicted",
    runId,
    nodeId: node.nodeId,
    timestamp: new Date().toISOString(),
    payload: {
      branchName: node.branchName,
      conflictFiles: node.conflictFiles ?? [],
      mergeWorktreePath: node.mergeWorktreePath,
      baseBranch,
      ...(reviewerGraphId ? { reviewerGraphId } : {}),
    },
  });
}

/**
 * GIT-3: idempotently spawn an `integration_reviewer` child sub-graph seeded with
 * the conflict context. One reviewer per conflicted node — re-running a conflicted
 * node reuses the existing child (looked up by `parentGraphId` + `parentNodeId`).
 * Best-effort: a spawn failure returns `undefined` and never breaks finalization.
 */
async function spawnConflictReviewer(input: {
  ownerId: string;
  graphId: string;
  parentNodeId: string;
  baseBranch: string;
  node: ConflictedMergeNode;
}): Promise<string | undefined> {
  try {
    await connectDB();
    // Idempotent: reuse an existing reviewer child for this conflicted node.
    const existing = await GraphModel.findOne({
      ownerId: input.ownerId,
      parentGraphId: input.graphId,
      parentNodeId: input.parentNodeId,
    })
      .select("_id")
      .lean();
    if (existing) return String((existing as { _id: unknown })._id);

    const conflictFiles = input.node.conflictFiles ?? [];
    const reviewerNode: INodeSpec = {
      id: ulid(),
      kind: "execute",
      label: "Resolve merge conflict",
      position: { x: 0, y: 0 },
      status: "pending",
      data: {
        persona: "integration_reviewer",
        conflict: {
          sourceBranch: input.node.branchName,
          baseBranch: input.baseBranch,
          conflictFiles,
          mergeWorktreePath: input.node.mergeWorktreePath,
        },
        prompt: [
          `A merge conflict occurred merging ${input.node.branchName} into ${input.baseBranch}.`,
          conflictFiles.length > 0
            ? `Conflicting files: ${conflictFiles.join(", ")}.`
            : "Conflicting files: (none reported).",
          input.node.mergeWorktreePath
            ? `Inspect the preserved merge worktree at ${input.node.mergeWorktreePath} and resolve the conflict.`
            : "Inspect the preserved merge worktree and resolve the conflict.",
          "Do not modify the user's working tree.",
        ].join(" "),
      },
    };

    const child = await createChildGraph({
      ownerId: input.ownerId,
      parentGraphId: input.graphId,
      parentNodeId: input.parentNodeId,
      name: `Conflict review — ${input.parentNodeId}`,
      nodes: [reviewerNode],
    });
    return child ? String((child as { _id: unknown })._id) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * RUN-6: await a (child) run's terminal status by polling its persisted Run doc.
 * Reused by the loop runner, which fires each child iteration through the shared
 * `startRunForGraph` (fire-and-forget) and must know when it settles. Owner-scoped.
 * Resolves to `success | failed | cancelled`, or `failed` on timeout/missing run
 * (a stuck/absent child must not hang the loop forever).
 */
async function awaitRunTerminal(
  childRunId: string,
  ownerId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<"success" | "failed" | "cancelled"> {
  const intervalMs = opts.intervalMs ?? 150;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  const terminal = new Set(["success", "failed", "cancelled"]);
  while (Date.now() < deadline) {
    const run = await RunModel.findOne({ _id: childRunId, ownerId })
      .select("status")
      .lean();
    const status = (run as { status?: string } | null)?.status;
    if (status && terminal.has(status)) return status as "success" | "failed" | "cancelled";
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return "failed";
}

/**
 * Execute all Execute nodes of a run. Fire-and-forget friendly: returns when all
 * nodes settle. Progress streams live over SSE; final state is in Mongo.
 */
export async function executeRun(
  runId: string,
  ownerId: string,
  opts?: { token?: string | null },
): Promise<void> {
  await connectDB();
  const run = await RunModel.findOne({ _id: runId, ownerId }).lean();
  if (!run) throw new Error(`Run not found: ${runId}`);

  const snapshot = run.graphSnapshot as {
    nodes?: SnapshotNode[];
    edges?: SnapshotEdge[];
    rootRepoPath?: string;
    baseBranch?: string;
    cli?: string;
    parentGraphId?: string;
    parentNodeId?: string;
  };
  const rootRepoPath = snapshot.rootRepoPath;
  // RUN-2: walk ALL node kinds (not just `execute`). Kinds without a runner yet
  // are explicitly `skipped` with a reason inside `runNode` — never dropped.
  const nodes = snapshot.nodes ?? [];
  const edges = snapshot.edges ?? [];

  sseEventHub.publish(runId, {
    type: "run.started",
    runId,
    timestamp: new Date().toISOString(),
    payload: { nodeCount: nodes.length },
  });

  // WOW-1: child-run linkage. If this run is for a spawned child sub-graph
  // (its snapshot carries parentGraphId + parentNodeId), emit an additive,
  // run-level linkage event so the parent UI can follow its fixer's run. It is
  // run-level (no envelope nodeId) because parentNodeId belongs to the PARENT
  // graph — see runtime-run-sse-api.md §10. Zero terminal pollution.
  if (snapshot.parentGraphId && snapshot.parentNodeId) {
    sseEventHub.publish(runId, {
      type: "node.child_run.started",
      runId,
      timestamp: new Date().toISOString(),
      payload: {
        childGraphId: String(run.graphId),
        childRunId: runId,
        parentGraphId: snapshot.parentGraphId,
        parentNodeId: snapshot.parentNodeId,
      },
    });
  }

  if (!rootRepoPath) {
    await mongoRunRepository.finishRun(runId, { status: "failed" }, ownerId);
    sseEventHub.publish(runId, {
      type: "run.failed",
      runId,
      timestamp: new Date().toISOString(),
      payload: { reason: "graphSnapshot.rootRepoPath is missing" },
    });
    return;
  }

  const runner = new ExecuteRunner(undefined, sharedProcessManager, mongoRunRepository);

  // CLI-4: resolve the owner's persisted allowed-tools once (read-only default).
  // Applied to kiro EXECUTE nodes as `--trust-tools`; other CLIs ignore it.
  const trustTools = toTrustToolsArg(await resolveAllowedTools(ownerId));

  // Merge model: `base-fanin` (default) or `lineage` (stacked branches). Resolved
  // once per run (env override > owner setting > base-fanin). Pass the start-time
  // token so BFF mode reads the setting from the cloud while the token is still live.
  const mergeStrategy = await resolveMergeStrategy(ownerId, opts);
  const baseBranch = snapshot.baseBranch ?? "main";

  // Base-branch create-at-run-start (picker choice 3=b): the worktree manager
  // branches every agent worktree FROM `baseBranch`, so a user-typed NEW base
  // branch must exist first. Idempotent + non-destructive (creates from HEAD only
  // when absent; never throws). `rootRepoPath` is non-null here (guarded above).
  await ensureBaseBranch({ rootRepoPath, baseBranch });

  // CLI-2: resolve a node's CLI as node `data.cli` → graph-level `snapshot.cli`
  // → "codex". The per-node override stays HIGHEST precedence; the graph-level
  // workflow setting fills in when a node omits it.
  // Always validated against VALID_CLIS.
  const resolveNodeCli = (n: SnapshotNode): SupportedCli => {
    const candidate = (n.data?.cli ?? snapshot.cli ?? "codex") as SupportedCli;
    return normalizeRuntimeCli(candidate);
  };

  // MODEL-1 / MCP-RESILIENCE: resolve the owner's per-node-type default models +
  // default MCP startup policy once per run (read through the settings gateway).
  const modelDefaults = await resolveNodeModelDefaults(ownerId, opts);

  // MODEL-1: resolve a node's model as node `data.model` → owner's per-node-type
  // default for the node's kind → undefined (the CLI uses its own default).
  const resolveNodeModel = (n: SnapshotNode): string | undefined =>
    resolveNodeModelId(n, modelDefaults);

  // MCP-RESILIENCE: resolve a node's MCP startup policy as node
  // `data.mcpStartupPolicy` → owner's default.
  const resolveNodeMcpPolicy = (n: SnapshotNode): "best-effort" | "require" =>
    resolveNodeMcpStartupPolicy(n, modelDefaults);

  // Lineage bookkeeping: a node's agent branch / worktree (for seeding children +
  // end-of-run pruning), the integration branches built for convergence nodes, and
  // the convergence nodes blocked by an integration conflict.
  const branchByNode = new Map<string, string>();
  const worktreeByNode = new Map<string, string>();
  const integrationArtifacts = new Map<string, { branch: string; worktreePath: string }>();
  const blockedNodes = new Set<string>();

  // RUN-3: track per-node outcomes so a `gate` can resolve its fan-in honestly
  // (and report accurate upstream counts in its lifecycle event).
  const nodeOutcomes = new Map<string, UpstreamStatus>();
  // MODEL-2: settled parsed outputs (`ExecuteRunnerSummary.output`) keyed by
  // nodeId — the binding SOURCE for downstream `{{upstream.<id>.<path>}}` data
  // edges. Populated as each node settles (data edges do NOT gate scheduling, so
  // an unsettled upstream simply leaves its bindings unresolved).
  const outputsByNode = new Map<string, unknown>();
  /** Parsed outputs of the nodes feeding `nodeId` via a `data` edge (settled only). */
  const dataUpstreamOutputs = (nodeId: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const e of edges) {
      if (e.kind === "data" && e.target === nodeId && outputsByNode.has(e.source)) {
        out[e.source] = outputsByNode.get(e.source);
      }
    }
    return out;
  };
  const publishAndPersistNodeEvent = async (
    event: RuntimeEvent,
  ): Promise<void> => {
    sseEventHub.publish(runId, event);
    await mongoRunRepository.appendNodeEvent(event, ownerId);
  };
  /** SKILL-1: build a materializeSkills hook for a node that declares `data.skills`. */
  const skillsHookFor = (
    node: SnapshotNode,
  ): ((worktreePath: string) => Promise<unknown>) | undefined => {
    const raw = (node.data as { skills?: unknown } | undefined)?.skills;
    const ids =
      Array.isArray(raw) && raw.every((s) => typeof s === "string")
        ? (raw as string[])
        : undefined;
    if (!ids || ids.length === 0) return undefined;
    // Cross-CLI: place skills where THIS node's CLI discovers them (kiro →
    // .kiro/skills, claude → .claude/skills, others → prompt preamble only).
    const cli = resolveNodeCli(node);
    return (worktreePath: string) =>
      materializeSkillsInto({ worktreePath, skillIds: ids, cli });
  };

  /**
   * SKILL — universal fallback: for a CLI with NO native skills dir (codex/
   * gemini/fake), fold the attached skills' SKILL.md bodies into the prompt so
   * the agent still receives the knowledge. File-placement CLIs (kiro/claude)
   * get the files instead, so we skip the preamble to avoid duplication.
   */
  const withSkillPreamble = async (prompt: string, node: SnapshotNode): Promise<string> => {
    const cli = resolveNodeCli(node);
    if (skillDirForCli(cli) !== undefined) return prompt; // delivered as files
    const raw = (node.data as { skills?: unknown } | undefined)?.skills;
    const ids =
      Array.isArray(raw) && raw.every((s) => typeof s === "string") ? (raw as string[]) : [];
    if (ids.length === 0) return prompt;
    try {
      const items = await loadSkillsForPreamble(ids);
      return applySkillsPreamble(prompt, items);
    } catch {
      // Best-effort: a preamble failure never aborts the run.
      return prompt;
    }
  };

  const incomingFlowPredecessors = (nodeId: string): string[] =>
    edges
      .filter((e) => (e.kind === undefined || e.kind === "flow") && e.target === nodeId)
      .map((e) => e.source);
  const gateUpstreams = (nodeId: string, fallback: UpstreamStatus) =>
    incomingFlowPredecessors(nodeId).map((id) => ({
      nodeId: id,
      status: nodeOutcomes.get(id) ?? fallback,
    }));

  // SEC-4: run-level circuit breaker. Trips after N=3 identical CONSECUTIVE node
  // failures (by {nodeKind, normalizedError}); once tripped, every remaining
  // unstarted node is skipped and the run finalizes `failed` with a clear reason
  // on the EXISTING `run.failed` event (no new event type — frozen SSE contract).
  const breaker = new CircuitBreaker();

  // Drive the run through the DAG scheduler: flow edges gate order, and a failed
  // (or skipped) node's descendants are skipped rather than run.
  const skippedGateEvents: RuntimeEvent[] = [];
  const skippedNodeEvents: RuntimeEvent[] = [];
  const skippedGateOutputs = new Map<string, Record<string, unknown>>();
  const results = await runSimpleScheduler<SnapshotNode, ExecuteRunnerSummary>({
    nodes,
    edges,
    maxConcurrency: MAX_CONCURRENCY,
    isSuccessfulResult: (r) => r.status === "success",
    // RUN-3: a gate honors its incoming flow edges' fanInMode (default all-of);
    // every other kind stays all-of, so execute behaviour is unchanged.
    getFanInMode: (node) =>
      node.kind === "gate" ? resolveGateFanInMode(node.id, edges) : "all-of",
    onNodeSkipped: (node, reason) => {
      nodeOutcomes.set(node.id, "skipped");
      // RUN-3: a skipped gate is "merge-blocked" (fan-in not satisfied), surfaced
      // via the node.skipped envelope with blocked:true + persisted as `blocked`.
      if (node.kind === "gate") {
        const fanInMode = resolveGateFanInMode(node.id, edges);
        const upstreams = gateUpstreams(node.id, "skipped");
        const resolution = resolveGate({ fanInMode, upstreams });
        const blockedOutput = gateOutput(resolution, "blocked", `gate blocked (${fanInMode}): ${reason}`);
        const evaluatingEvent: RuntimeEvent = {
          type: "node.gate.evaluating",
          runId,
          nodeId: node.id,
          timestamp: new Date().toISOString(),
          payload: { kind: "gate", fanInMode, upstreamTotal: upstreams.length },
        };
        const blockedEvent: RuntimeEvent = {
          type: "node.gate.blocked",
          runId,
          nodeId: node.id,
          timestamp: new Date().toISOString(),
          payload: blockedOutput,
        };
        const skippedEvent: RuntimeEvent = {
          type: "node.skipped",
          runId,
          nodeId: node.id,
          timestamp: new Date().toISOString(),
          payload: {
            reason: `gate blocked (${fanInMode}): ${reason}`,
            kind: "gate",
            fanInMode,
            blocked: true,
            upstream: { succeeded: resolution.succeededCount, total: resolution.upstreamCount },
          },
        };
        skippedGateOutputs.set(node.id, blockedOutput);
        skippedGateEvents.push(evaluatingEvent, blockedEvent, skippedEvent);
        sseEventHub.publish(runId, evaluatingEvent);
        sseEventHub.publish(runId, blockedEvent);
        sseEventHub.publish(runId, skippedEvent);
        return;
      }
      const skippedEvent: RuntimeEvent = {
        type: "node.skipped",
        runId,
        nodeId: node.id,
        timestamp: new Date().toISOString(),
        payload: { reason },
      };
      skippedNodeEvents.push(skippedEvent);
      sseEventHub.publish(runId, skippedEvent);
    },
    runNode: async (n) => {
      // SEC-4: the actual per-node work, wrapped below by the circuit breaker.
      const __runBody = async (): Promise<ExecuteRunnerSummary> => {
      // RUN-3: gate runner. The scheduler only invokes this once the gate's
      // fan-in condition is satisfied (ready), so reaching here = the gate passes.
      if (n.kind === "gate") {
        const fanInMode = resolveGateFanInMode(n.id, edges);
        const upstreams = gateUpstreams(n.id, "success");
        const resolution = resolveGate({ fanInMode, upstreams });
        await publishAndPersistNodeEvent({
          type: "node.gate.evaluating",
          runId,
          nodeId: n.id,
          timestamp: new Date().toISOString(),
          payload: { kind: "gate", fanInMode, upstreamTotal: upstreams.length },
        });

        if (resolution.status === "blocked") {
          const output = gateOutput(resolution, "blocked");
          nodeOutcomes.set(n.id, "skipped");
          await mongoRunRepository.updateNodeRun(runId, n.id, {
            status: "blocked",
            output: { gate: output },
          }, ownerId);
          await publishAndPersistNodeEvent({
            type: "node.gate.blocked",
            runId,
            nodeId: n.id,
            timestamp: new Date().toISOString(),
            payload: output,
          });
          await publishAndPersistNodeEvent({
            type: "node.skipped",
            runId,
            nodeId: n.id,
            timestamp: new Date().toISOString(),
            payload: {
              reason: output.reason,
              kind: "gate",
              fanInMode,
              blocked: true,
              upstream: {
                succeeded: resolution.succeededCount,
                total: resolution.upstreamCount,
              },
            },
          });
          return blockedSummary(runId, n.id);
        }

        const output = gateOutput(resolution, "passed");
        nodeOutcomes.set(n.id, "success");
        await mongoRunRepository.updateNodeRun(runId, n.id, {
          status: "success",
          output: { gate: output },
        }, ownerId);
        await publishAndPersistNodeEvent({
          type: "node.gate.passed",
          runId,
          nodeId: n.id,
          timestamp: new Date().toISOString(),
          payload: output,
        });
        await publishAndPersistNodeEvent({
          type: "node.completed",
          runId,
          nodeId: n.id,
          timestamp: new Date().toISOString(),
          payload: {
            kind: "gate",
            fanInMode,
            gate: "passed",
            upstream: { succeeded: resolution.succeededCount, total: resolution.upstreamCount },
          },
        });
        return gateSummary(runId, n.id);
      }

      // Plan runner. A `plan` node calls the shared internal planner service and
      // persists a proposal/context request. It NEVER mutates the graph. By
      // default proposal output blocks downstream flow successors until the user
      // explicitly applies/approves it; advanced nodes may opt in with
      // `data.allowDownstreamAfterProposal === true`.
      if (n.kind === "plan") {
        await mongoRunRepository.updateNodeRun(runId, n.id, { status: "running" }, ownerId);
        await publishAndPersistNodeEvent({
          type: "node.plan.started",
          runId,
          nodeId: n.id,
          timestamp: new Date().toISOString(),
          payload: {
            kind: "plan",
            objective: typeof n.data?.objective === "string" ? n.data.objective : undefined,
            promptLength: typeof n.data?.prompt === "string" ? n.data.prompt.length : 0,
          },
        });

        const planResult = await runPlanNode({
          ownerId,
          runId,
          nodeId: n.id,
          node: n,
          graphSnapshot: snapshot,
          upstreamOutputs: dataUpstreamOutputs(n.id),
        });

        nodeOutcomes.set(
          n.id,
          planResult.status === "success"
            ? "success"
            : planResult.status === "failed"
              ? "failed"
              : "skipped",
        );
        await mongoRunRepository.updateNodeRun(runId, n.id, {
          status: planResult.status,
          output: { plan: planResult.output },
        }, ownerId);
        await publishAndPersistNodeEvent({
          type: planResult.eventType,
          runId,
          nodeId: n.id,
          timestamp: new Date().toISOString(),
          payload: planResult.eventPayload,
        });

        return {
          runId,
          nodeId: n.id,
          status: planResult.status,
          worktreePath: "",
          branchName: "",
          exitCode: null,
          patchLength: 0,
          output: { plan: planResult.output },
          failureReason: planResult.failureReason,
        };
      }

      // RUN-4: review runner. A `review` node is persona-locked to
      // `integration_reviewer` and runs a READ-ONLY audit under the trusted
      // `orch-reviewer` kiro agent (any `data.persona` is ignored). It is a
      // non-`execute` kind, so it is never a merge candidate (can't land a patch).
      if (n.kind === "review") {
        const cli = resolveNodeCli(n);
        const defaultPrompt =
          `Audit the work in this run's worktree for regressions, broken contracts, and out-of-scope edits. ${n.label ?? ""}`.trim();
        const assembled = assembleNodePrompt({
          node: n,
          nodes,
          edges,
          upstreamOutputs: dataUpstreamOutputs(n.id),
          defaultPrompt,
        });
        const prompt = await withSkillPreamble(assembled.prompt, n);
        const result = await runner.run({
          runId,
          nodeId: n.id,
          rootRepoPath,
          baseRef: n.data?.baseRef ?? baseBranch ?? "HEAD",
          prompt,
          cli: VALID_CLIS.includes(cli) ? cli : "fake",
          ownerId,
          apiKeySecretId: n.data?.apiKeySecretId,
          secretRefs: parseSecretRefs(n.data?.secretRefs),
          allowedPaths: parseAllowedPaths(n.data?.allowedPaths),
          pathPolicyMode: parsePathPolicyMode(n.data?.pathPolicyMode),
          timeoutMs: parseTimeoutMs(n.data?.timeoutMs),
          // Persona-lock: ALWAYS read-only + the integration_reviewer agent.
          trustTools: REVIEWER_TRUST_TOOLS,
          agent: REVIEWER_AGENT_NAME,
          model: resolveNodeModel(n),
          mcpStartupPolicy: resolveNodeMcpPolicy(n),
          materializeAgent: (wt) => materializeReviewerAgent({ cwd: wt }),
          mcpOverrides: resolveContextMcpOverrides(n.id, nodes, edges),
          materializeSkills: skillsHookFor(n),
        });
        if (result.output !== undefined) outputsByNode.set(n.id, result.output);
        // SEC-3: a `review` MUST be strictly read-only. A review is already
        // non-mergeable, but make the read-only contract EXPLICIT + fail-closed:
        // if the audited worktree changed ANY real file (outside the orchestrator's
        // own `.kiro/`/`.orchestrator/` plumbing), FAIL the node. An indeterminate
        // listing (git failure) also fails (never pass on unknown).
        if (result.status === "success" && result.worktreePath) {
          const verdict = await checkWriteScope({
            listChangedPaths: () =>
              new WorktreeManager().listChangedPaths({
                worktreePath: result.worktreePath,
                baseRef: n.data?.baseRef ?? baseBranch ?? "HEAD",
              }),
            allow: REVIEW_READONLY_SCOPE,
          });
          if (!verdict.ok) {
            await mongoRunRepository.updateNodeRun(runId, n.id, { status: "failed" }, ownerId);
            sseEventHub.publish(runId, {
              type: "node.failed",
              runId,
              nodeId: n.id,
              timestamp: new Date().toISOString(),
              payload: {
                kind: "review",
                reason: "review must be read-only",
                ...(verdict.reason === "out-of-scope"
                  ? { wrotePaths: verdict.outOfScope.slice(0, 50) }
                  : {}),
              },
            });
            nodeOutcomes.set(n.id, "failed");
            return { ...result, status: "failed", failureReason: "review-not-readonly" };
          }
        }
        nodeOutcomes.set(n.id, result.status === "success" ? "success" : "failed");
        return result;
      }
      // RUN-5: doc runner. A `doc` node is persona-locked to `knowledge_manager`
      // and runs under the doc-scoped `orch-doc` kiro agent with read+write trust
      // tools. AFTER it runs, a fail-CLOSED SCOPE GUARD (SEC-3) inspects the
      // worktree's changed paths: any write outside `.claude/**` / `*.md` — or an
      // indeterminate listing — FAILS the node (so an out-of-scope edit is never
      // merged, and we never merge on an unknown scope).
      if (n.kind === "doc") {
        const cli = resolveNodeCli(n);
        const docBaseRef = n.data?.baseRef ?? baseBranch ?? "HEAD";
        const defaultPrompt =
          `Update the documentation to reflect this run's work. Edit ONLY .claude/** and *.md files. ${n.label ?? ""}`.trim();
        const assembled = assembleNodePrompt({
          node: n,
          nodes,
          edges,
          upstreamOutputs: dataUpstreamOutputs(n.id),
          defaultPrompt,
        });
        const prompt = await withSkillPreamble(assembled.prompt, n);
        const result = await runner.run({
          runId,
          nodeId: n.id,
          rootRepoPath,
          baseRef: docBaseRef,
          prompt,
          cli: VALID_CLIS.includes(cli) ? cli : "fake",
          ownerId,
          apiKeySecretId: n.data?.apiKeySecretId,
          secretRefs: parseSecretRefs(n.data?.secretRefs),
          allowedPaths: parseAllowedPaths(n.data?.allowedPaths),
          pathPolicyMode: parsePathPolicyMode(n.data?.pathPolicyMode),
          timeoutMs: parseTimeoutMs(n.data?.timeoutMs),
          // Persona-lock: ALWAYS doc-scoped write + the knowledge_manager agent.
          trustTools: DOC_TRUST_TOOLS,
          agent: DOC_AGENT_NAME,
          model: resolveNodeModel(n),
          mcpStartupPolicy: resolveNodeMcpPolicy(n),
          materializeAgent: (wt) => materializeDocAgent({ cwd: wt }),
          mcpOverrides: resolveContextMcpOverrides(n.id, nodes, edges),
          materializeSkills: skillsHookFor(n),
        });
        if (result.output !== undefined) outputsByNode.set(n.id, result.output);

        // SEC-3: fail-CLOSED post-run scope guard. An indeterminate path listing
        // (git failure → listChangedPaths throws) FAILS the node — we never merge
        // on an unknown scope. Out-of-scope writes (outside `.claude/** / *.md`)
        // also FAIL the node. (Hard kernel-level allowlist remains out of reach —
        // documented SEC-3 residual.)
        if (result.status === "success" && result.worktreePath) {
          const verdict = await checkWriteScope({
            listChangedPaths: () =>
              new WorktreeManager().listChangedPaths({
                worktreePath: result.worktreePath,
                baseRef: docBaseRef,
              }),
            allow: DOC_WRITE_SCOPE,
          });
          if (!verdict.ok) {
            await mongoRunRepository.updateNodeRun(runId, n.id, { status: "failed" }, ownerId);
            sseEventHub.publish(runId, {
              type: "node.failed",
              runId,
              nodeId: n.id,
              timestamp: new Date().toISOString(),
              payload:
                verdict.reason === "indeterminate"
                  ? {
                      kind: "doc",
                      reason:
                        "doc scope check failed (fail-closed): could not determine changed paths",
                    }
                  : {
                      kind: "doc",
                      reason:
                        "doc scope guard: writes outside .claude/** / *.md were rejected",
                      outOfScopePaths: verdict.outOfScope.slice(0, 50),
                    },
            });
            nodeOutcomes.set(n.id, "failed");
            return {
              ...result,
              status: "failed",
              failureReason:
                verdict.reason === "indeterminate" ? "doc-scope-indeterminate" : "doc-scope",
            };
          }
        }

        nodeOutcomes.set(n.id, result.status === "success" ? "success" : "failed");
        return result;
      }

      // RUN-6: loop runner. Re-run an attached child sub-graph until it succeeds
      // or a per-loop `maxIterations` cap is hit (hard-capped — no unbounded
      // re-runs; the global circuit breaker is SEC-4, Sprint 8). Reuses the WOW-1
      // `startRunForGraph` child-run path (Do-Not-Invent — never re-implements
      // executeRun) and awaits each iteration's terminal status.
      if (n.kind === "loop") {
        const ts = () => new Date().toISOString();
        const childGraphId = resolveLoopChildGraphId(n, nodes, edges);
        const maxIterations = clampMaxIterations(n.data?.maxIterations);
        const breakCondition =
          typeof n.data?.breakCondition === "string" && n.data.breakCondition.trim()
            ? n.data.breakCondition.trim()
            : undefined;
        const childRunIds: string[] = [];
        const failLoop = async (
          reason: string,
          outputStatus: LoopOutputStatus = "failed",
        ): Promise<ExecuteRunnerSummary> => {
          const output = loopOutput({
            status: outputStatus,
            childGraphId,
            iterations: childRunIds.length,
            maxIterations,
            breakCondition,
            breakReason: reason,
            childRunIds,
          });
          nodeOutcomes.set(n.id, outputStatus === "cancelled" ? "skipped" : "failed");
          await mongoRunRepository.updateNodeRun(runId, n.id, {
            status: outputStatus === "cancelled" ? "cancelled" : "failed",
            output: { loop: output },
          }, ownerId);
          await publishAndPersistNodeEvent({
            type: "node.loop.failed",
            runId,
            nodeId: n.id,
            timestamp: ts(),
            payload: output,
          });
          await publishAndPersistNodeEvent({
            type: outputStatus === "cancelled" ? "node.cancelled" : "node.failed",
            runId,
            nodeId: n.id,
            timestamp: ts(),
            payload: { kind: "loop", reason, loop: outputStatus },
          });
          return {
            runId,
            nodeId: n.id,
            status: outputStatus === "cancelled" ? "cancelled" : "failed",
            worktreePath: "",
            branchName: "",
            exitCode: null,
            patchLength: 0,
            output: { loop: output },
            failureReason: reason,
          };
        };

        if (!childGraphId) {
          return failLoop(
            "loop node has no child sub-graph (set data.childGraphId or attach one via a loop/attaches-to edge)",
          );
        }

        await mongoRunRepository.updateNodeRun(runId, n.id, { status: "running" }, ownerId);
        await publishAndPersistNodeEvent({
          type: "node.loop.started",
          runId,
          nodeId: n.id,
          timestamp: ts(),
          payload: {
            kind: "loop",
            childGraphId,
            maxIterations,
            breakCondition,
            breakConditionEvaluated: false,
          },
        });

        for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
          await publishAndPersistNodeEvent({
            type: "node.loop.iteration.started",
            runId,
            nodeId: n.id,
            timestamp: ts(),
            payload: { iteration, maxIterations, childGraphId, childRunId: null },
          });
          const childRunId = await startRunForGraph({ graphId: childGraphId, ownerId });
          if (!childRunId) {
            // Not owned / missing → cannot iterate further.
            await publishAndPersistNodeEvent({
              type: "node.loop.iteration",
              runId,
              nodeId: n.id,
              timestamp: ts(),
              payload: { iteration, maxIterations, childGraphId, childRunId: null, status: "failed", childRunStatus: "failed" },
            });
            await publishAndPersistNodeEvent({
              type: "node.loop.iteration.completed",
              runId,
              nodeId: n.id,
              timestamp: ts(),
              payload: {
                iteration,
                maxIterations,
                childGraphId,
                childRunId: null,
                childRunStatus: "failed",
                breakReason: "child_run_start_failed",
              },
            });
            return failLoop("child_run_start_failed");
          }
          childRunIds.push(childRunId);
          const childStatus = await awaitRunTerminal(childRunId, ownerId);
          await publishAndPersistNodeEvent({
            type: "node.loop.iteration",
            runId,
            nodeId: n.id,
            timestamp: ts(),
            payload: { iteration, maxIterations, childGraphId, childRunId, status: childStatus, childRunStatus: childStatus },
          });
          await publishAndPersistNodeEvent({
            type: "node.loop.iteration.completed",
            runId,
            nodeId: n.id,
            timestamp: ts(),
            payload: {
              iteration,
              maxIterations,
              childGraphId,
              childRunId,
              childRunStatus: childStatus,
              breakReason: childStatus === "success" ? "child_run_success" : undefined,
            },
          });
          if (childStatus === "success") {
            const output = loopOutput({
              status: "completed",
              childGraphId,
              iterations: iteration,
              maxIterations,
              breakCondition,
              breakReason: "child_run_success",
              childRunIds,
            });
            nodeOutcomes.set(n.id, "success");
            await mongoRunRepository.updateNodeRun(runId, n.id, {
              status: "success",
              output: { loop: output },
            }, ownerId);
            await publishAndPersistNodeEvent({
              type: "node.loop.break",
              runId,
              nodeId: n.id,
              timestamp: ts(),
              payload: output,
            });
            await publishAndPersistNodeEvent({
              type: "node.completed",
              runId,
              nodeId: n.id,
              timestamp: ts(),
              payload: {
                kind: "loop",
                loop: "passed",
                iterations: iteration,
                maxIterations,
                childGraphId,
                breakReason: "child_run_success",
              },
            });
            return {
              runId,
              nodeId: n.id,
              status: "success",
              worktreePath: "",
              branchName: "",
              exitCode: null,
              patchLength: 0,
              output: { loop: output },
            };
          }
          if (childStatus === "cancelled") {
            return failLoop("child_run_cancelled", "cancelled");
          }
        }

        const output = loopOutput({
          status: "exhausted",
          childGraphId,
          iterations: childRunIds.length,
          maxIterations,
          breakCondition,
          breakReason: "max_iterations_exhausted",
          childRunIds,
        });
        nodeOutcomes.set(n.id, "failed");
        await mongoRunRepository.updateNodeRun(runId, n.id, {
          status: "failed",
          output: { loop: output },
        }, ownerId);
        await publishAndPersistNodeEvent({
          type: "node.loop.exhausted",
          runId,
          nodeId: n.id,
          timestamp: ts(),
          payload: output,
        });
        await publishAndPersistNodeEvent({
          type: "node.failed",
          runId,
          nodeId: n.id,
          timestamp: ts(),
          payload: {
            kind: "loop",
            loop: "exhausted",
            iterations: childRunIds.length,
            maxIterations,
            childGraphId,
            reason: "max_iterations_exhausted",
          },
        });
        return {
          runId,
          nodeId: n.id,
          status: "failed",
          worktreePath: "",
          branchName: "",
          exitCode: null,
          patchLength: 0,
          output: { loop: output },
          failureReason: "max_iterations_exhausted",
        };
      }

      // Per-kind dispatch: only `execute` has a CLI runner. Every other kind is
      // explicitly skipped (with a reason) so no node kind silently does nothing.
      if (n.kind !== "execute") {
        nodeOutcomes.set(n.id, "skipped");
        sseEventHub.publish(runId, {
          type: "node.skipped",
          runId,
          nodeId: n.id,
          timestamp: new Date().toISOString(),
          payload: { reason: `no runner for kind "${n.kind ?? "unknown"}" yet (Sprint 1)` },
        });
        return skippedSummary(runId, n.id);
      }
      const cli = resolveNodeCli(n);

      // Seed ref: base-fanin forks every node from base (unchanged). Lineage forks
      // a node from its parent branch(es) so it builds on its ancestors' work.
      let baseRef = n.data?.baseRef ?? baseBranch ?? "HEAD";
      if (mergeStrategy === "lineage") {
        const ancestors = resolveExecuteAncestors(n.id, nodes, edges);
        if (ancestors.length === 0) {
          baseRef = baseBranch ?? "HEAD"; // root → from the graph's base branch
        } else if (ancestors.length === 1) {
          baseRef = branchByNode.get(ancestors[0]) ?? baseBranch ?? "HEAD";
        } else {
          // Convergence: seed from an integration branch that merges the parents.
          const parentBranches = ancestors
            .map((a) => branchByNode.get(a))
            .filter((b): b is string => Boolean(b));
          const integ = await createIntegrationBranch({
            rootRepoPath,
            runId,
            nodeId: n.id,
            parentBranches,
          });
          if (integ.status === "conflicted") {
            integrationArtifacts.set(n.id, { branch: integ.branch, worktreePath: integ.worktreePath });
            blockedNodes.add(n.id);
            nodeOutcomes.set(n.id, "skipped");
            await handleMergeConflict({
              runId,
              ownerId,
              graphId: String(run.graphId),
              baseBranch,
              node: {
                nodeId: n.id,
                branchName: integ.branch,
                conflictFiles: integ.conflictFiles,
                mergeWorktreePath: integ.worktreePath,
              },
            });
            return blockedSummary(runId, n.id, integ.branch, integ.worktreePath);
          }
          if (integ.status === "failed") {
            nodeOutcomes.set(n.id, "failed");
            sseEventHub.publish(runId, {
              type: "merge.failed",
              runId,
              nodeId: n.id,
              timestamp: new Date().toISOString(),
              payload: { reason: integ.message ?? "integration failed", stage: "integration" },
            });
            return { runId, nodeId: n.id, status: "failed", worktreePath: "", branchName: "", exitCode: null, patchLength: 0 };
          }
          integrationArtifacts.set(n.id, { branch: integ.branch, worktreePath: integ.worktreePath });
          baseRef = integ.branch;
        }
      }

      // MODEL-2 (was RUN-7): compose the canonical prompt via the single
      // `assembleNodePrompt` seam — resolved `{{upstream.<id>.<path>}}` data
      // bindings (from settled upstream outputs) THEN the materialized
      // `## Attached context` block. With no data edges + no attached context
      // this is byte-identical to a context-free run.
      // TPL-4: when this execute node pins `data.persona`, resolve the owner's
      // workspace fork (else the seeded default) and prepend its `## Persona`
      // block. Absent-safe — byte-identical when no persona is pinned or none
      // resolves. (Persona-locked review/doc nodes keep their trusted agent.)
      const pinnedPersonaId =
        typeof (n.data as { persona?: unknown } | undefined)?.persona === "string"
          ? ((n.data as { persona?: string }).persona as string)
          : undefined;
      let personaContent: string | undefined;
      if (pinnedPersonaId) {
        try {
          const resolved = await resolvePersona(ownerId, pinnedPersonaId);
          personaContent = resolved?.content;
        } catch {
          // Best-effort: a resolution failure must never abort the run.
          personaContent = undefined;
        }
      }
      const assembled = assembleNodePrompt({
        node: n,
        nodes,
        edges,
        upstreamOutputs: dataUpstreamOutputs(n.id),
        personaContent,
      });
      const prompt = await withSkillPreamble(assembled.prompt, n);

      const result = await runner.run({
        runId,
        nodeId: n.id,
        rootRepoPath,
        baseRef,
        prompt,
        cli: VALID_CLIS.includes(cli) ? cli : "fake",
        ownerId,
        apiKeySecretId: n.data?.apiKeySecretId,
        secretRefs: parseSecretRefs(n.data?.secretRefs),
        allowedPaths: parseAllowedPaths(n.data?.allowedPaths),
        pathPolicyMode: parsePathPolicyMode(n.data?.pathPolicyMode),
        timeoutMs: parseTimeoutMs(n.data?.timeoutMs),
        trustTools,
        // MODEL-1: node `data.model` → owner's per-node-type default model.
        model: resolveNodeModel(n),
        // MCP-RESILIENCE: node `data.mcpStartupPolicy` → owner's default policy.
        mcpStartupPolicy: resolveNodeMcpPolicy(n),
        // MCP-2: per-node MCP servers from attached `context` nodes (attaches-to).
        mcpOverrides: resolveContextMcpOverrides(n.id, nodes, edges),
        // SKILL-1: materialize node-declared skills into `.kiro/skills/`.
        materializeSkills: skillsHookFor(n),
      });
      nodeOutcomes.set(n.id, result.status === "success" ? "success" : "failed");
      // MODEL-2: expose this node's parsed output to downstream data-edge bindings.
      if (result.output !== undefined) outputsByNode.set(n.id, result.output);
      if (result.branchName) branchByNode.set(n.id, result.branchName);
      if (result.worktreePath) worktreeByNode.set(n.id, result.worktreePath);
      // Lineage: commit the agent's edits to this node's branch so downstream
      // nodes that fork from it inherit the work (children seed off the branch).
      if (mergeStrategy === "lineage" && result.status === "success" && result.worktreePath) {
        await checkpointWorktree(result.worktreePath, `orchestrator checkpoint ${n.id}`);
      }
      return result;
      }; // end __runBody

      // SEC-4: once the breaker has tripped, skip every remaining unstarted node
      // (no new work) — the run is being halted. Persist `skipped` + emit the
      // EXISTING node.skipped with the breaker reason.
      if (breaker.tripped) {
        nodeOutcomes.set(n.id, "skipped");
        await mongoRunRepository.updateNodeRun(runId, n.id, { status: "skipped" }, ownerId);
        sseEventHub.publish(runId, {
          type: "node.skipped",
          runId,
          nodeId: n.id,
          timestamp: new Date().toISOString(),
          payload: { reason: breaker.reason(), breaker: true },
        });
        return skippedSummary(runId, n.id);
      }
      const __result = await __runBody();
      // Record a settled-failed node into the breaker (cancelled/blocked/skipped
      // do not count). A 3rd identical consecutive failure trips it.
      if (__result.status === "failed") {
        breaker.record({
          nodeKind: n.kind ?? "unknown",
          error: __result.failureReason ?? "failed",
        });
      }
      return __result;
    },
  });

  // Final per-node status: a node-runner skip (non-execute) reports `skipped` via
  // its result; a dependency gate reports `skipped` via the scheduler verdict.
  const finalStatus = (r: (typeof results)[number]): string =>
    r.status === "skipped" ? "skipped" : r.result?.status ?? r.status;

  if (skippedGateEvents.length > 0 || skippedNodeEvents.length > 0) {
    await mongoRunRepository.appendNodeEventsBatch([...skippedGateEvents, ...skippedNodeEvents], ownerId);
  }

  // Persist `skipped` for nodes ExecuteRunner never ran (gated + no-runner kinds).
  // RUN-3: a `gate` whose fan-in was NOT satisfied is persisted `blocked`
  // (convergence verdict), not `skipped`.
  await Promise.all(
    results
      .filter((r) => finalStatus(r) === "skipped")
      .map((r) => {
        if (r.node.kind === "gate") {
          // Recompute the gate verdict from FINAL upstream outcomes. The skip-time
          // output captured in `onNodeSkipped` can under-count successes: the
          // scheduler skips an all-of gate as soon as ONE upstream fails, while a
          // slower-but-successful sibling may still be in flight (its outcome is
          // the "skipped" fallback at that instant). By finalization every
          // upstream is terminal, so the persisted convergence verdict is accurate.
          const fanInMode = resolveGateFanInMode(r.node.id, edges);
          const resolution = resolveGate({
            fanInMode,
            upstreams: gateUpstreams(r.node.id, "skipped"),
          });
          const reason = skippedGateOutputs.get(r.node.id)?.reason as
            | string
            | undefined;
          return mongoRunRepository.updateNodeRun(
            runId,
            r.node.id,
            { status: "blocked", output: { gate: gateOutput(resolution, "blocked", reason) } },
            ownerId,
          );
        }
        return mongoRunRepository.updateNodeRun(
          runId,
          r.node.id,
          { status: "skipped" },
          ownerId,
        );
      }),
  );

  // ── Auto-merge-back (ON by default; ORCH_AUTO_MERGE=false disables) ──
  const autoMergeEnabled = process.env.ORCH_AUTO_MERGE !== "false";
  // A run stopped via runs.cancel surfaces `cancelled` node results.
  const anyCancelled = results.some((r) => finalStatus(r) === "cancelled");
  // Gate-gating: if a present gate is blocked, the convergence failed → hold the merge.
  const gatePresent = results.some((r) => r.node.kind === "gate");
  const anyGateBlocked = results.some(
    (r) =>
      r.node.kind === "gate" &&
      (finalStatus(r) === "skipped" || finalStatus(r) === "blocked"),
  );

  // Candidates that merge into the base branch:
  //  - base-fanin: every successful execute node that produced a patch.
  //  - lineage: ONLY the terminal/leaf execute nodes (their branches already
  //    contain their ancestors' work via the stacked lineage).
  const terminalSet =
    mergeStrategy === "lineage" ? new Set(terminalExecuteNodes(nodes, edges)) : null;
  const mergeCandidates: MergeBackNode[] = results
    .filter(
      (r) =>
        r.node.kind === "execute" &&
        finalStatus(r) === "success" &&
        (r.result?.patchLength ?? 0) > 0 &&
        Boolean(r.result?.branchName) &&
        (!terminalSet || terminalSet.has(r.node.id)),
    )
    .map((r) => ({
      nodeId: r.node.id,
      branchName: r.result!.branchName,
      worktreePath: r.result!.worktreePath || undefined,
    }));

  let branchCleanupReported = false;
  if (
    autoMergeEnabled &&
    !anyCancelled &&
    mergeCandidates.length > 0 &&
    !(gatePresent && anyGateBlocked)
  ) {
    const worktreeManager = new WorktreeManager();
    sseEventHub.publish(runId, {
      type: "merge.started",
      runId,
      timestamp: new Date().toISOString(),
      payload: { nodeCount: mergeCandidates.length, baseBranch, strategy: "no-ff" },
    });

    try {
      const mergeBack = await runMergeBack({
        rootRepoPath,
        runId,
        baseBranch,
        nodes: mergeCandidates,
        edges,
        strategy: "no-ff",
      });

      const mergedIds: string[] = [];
      let promotedCount = 0;
      for (const m of mergeBack.results) {
        if (m.status === "merged") {
          mergedIds.push(m.nodeId);
          if (m.promoted) promotedCount += 1;
          // GIT-4: remove the agent worktree (+ delete the merged branch) and the
          // temporary merge worktree on success. Best-effort, scoped to .orchestrator/.
          let agentCleanup: Awaited<ReturnType<WorktreeManager["removeWorktree"]>> | undefined;
          let mergeCleanup: Awaited<ReturnType<WorktreeManager["removeWorktree"]>> | undefined;
          const candidate = mergeCandidates.find((c) => c.nodeId === m.nodeId);
          if (candidate?.worktreePath) {
            // Lifecycle: kill any live interactive shell attached to this node's
            // worktree before we delete it (otherwise the shell's cwd vanishes).
            sharedPtySessionManager.killForNode(runId, m.nodeId);
            agentCleanup = await worktreeManager.removeWorktree({
              rootRepoPath,
              worktreePath: candidate.worktreePath,
              branchName: m.branchName,
            });
          }
          if (m.mergeWorktreePath) {
            mergeCleanup = await worktreeManager.removeWorktree({
              rootRepoPath,
              worktreePath: m.mergeWorktreePath,
              branchName: m.mergeBranchName,
            });
          }
          sseEventHub.publish(runId, {
            type: "merge.completed",
            runId,
            nodeId: m.nodeId,
            timestamp: new Date().toISOString(),
            payload: {
              branchName: m.branchName,
              mergeBranchName: m.mergeBranchName,
              mergeCommit: m.mergeCommit,
              promoted: m.promoted,
              baseBranch,
              cleanup: {
                agentWorktreeRemoved: agentCleanup?.worktreeRemoved ?? false,
                agentBranchDeleted: agentCleanup?.branchDeleted ?? false,
                mergeWorktreeRemoved: mergeCleanup?.worktreeRemoved ?? false,
                mergeBranchDeleted: mergeCleanup?.branchDeleted ?? false,
                warnings: [agentCleanup?.reason, mergeCleanup?.reason].filter(Boolean),
              },
            },
          });
        } else if (m.status === "conflicted") {
          // Worktrees are KEPT on conflict (for inspection + the reviewer). GIT-3
          // marks the node `blocked`, persists the conflict, and spawns a reviewer.
          await handleMergeConflict({
            runId,
            ownerId,
            graphId: String(run.graphId),
            baseBranch,
            node: m,
          });
        } else if (m.status === "failed") {
          sseEventHub.publish(runId, {
            type: "merge.failed",
            runId,
            nodeId: m.nodeId,
            timestamp: new Date().toISOString(),
            payload: { branchName: m.branchName, reason: m.message ?? "merge failed" },
          });
        }
        // `skipped` (short-circuited descendant) → no merge event; worktree kept.
      }

      // Lineage cleanup: prune the intermediate (non-terminal) branches + the
      // integration branches whose work has landed on base via a merged terminal.
      // Only prune the ancestor closure of a SUCCESSFULLY-merged terminal (so a
      // blocked/unmerged subtree is preserved), and never prune a blocked node.
      if (mergeStrategy === "lineage" && mergedIds.length > 0) {
        const prunable = executeAncestorClosure(mergedIds, edges);
        for (const [nodeId, worktreePath] of worktreeByNode) {
          if (blockedNodes.has(nodeId) || !prunable.has(nodeId)) continue;
          sharedPtySessionManager.killForNode(runId, nodeId);
          await worktreeManager.removeWorktree({
            rootRepoPath,
            worktreePath,
            branchName: branchByNode.get(nodeId),
          });
        }
        for (const [nodeId, art] of integrationArtifacts) {
          if (blockedNodes.has(nodeId) || !prunable.has(nodeId)) continue;
          await worktreeManager.removeWorktree({
            rootRepoPath,
            worktreePath: art.worktreePath,
            branchName: art.branch,
          });
        }
      }

      // WOW-2: when a CHILD sub-graph's run promotes a patch onto the shared
      // base, signal the parent node that its fixer landed (additive, run-level).
      if (snapshot.parentNodeId && promotedCount > 0) {
        sseEventHub.publish(runId, {
          type: "merge.promoted_to_parent",
          runId,
          timestamp: new Date().toISOString(),
          payload: {
            parentNodeId: snapshot.parentNodeId,
            parentGraphId: snapshot.parentGraphId,
            childGraphId: String(run.graphId),
            childRunId: runId,
            baseBranch,
            mergeCommit: mergeBack.baseTip,
            promotedNodeCount: promotedCount,
          },
        });
      }

      // WOW-2 (GIT-1 follow-up): keep the base working tree consistent after a
      // ref promotion. Best-effort, fast-forward-only, non-destructive — skips
      // when base isn't checked out / the tree is dirty / it isn't a ff.
      if (promotedCount > 0) {
        await syncMainCheckout({ rootRepoPath, baseBranch, targetCommit: mergeBack.baseTip });
      }

      const remainingBranches = await listRunRuntimeBranches(rootRepoPath, runId);
      sseEventHub.publish(runId, {
        type: "cleanup.completed",
        runId,
        timestamp: new Date().toISOString(),
        payload: {
          kind: "post_merge_branch_cleanup",
          checkedWith: "git branch",
          remainingBranches,
          branchCleanupComplete: remainingBranches.length === 0,
        },
      });
      branchCleanupReported = true;
    } catch (error) {
      sseEventHub.publish(runId, {
        type: "merge.failed",
        runId,
        timestamp: new Date().toISOString(),
        payload: { reason: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  if (!branchCleanupReported) {
    const remainingBranches = await listRunRuntimeBranches(rootRepoPath, runId);
    sseEventHub.publish(runId, {
      type: "cleanup.completed",
      runId,
      timestamp: new Date().toISOString(),
      payload: {
        kind: "post_run_branch_audit",
        checkedWith: "git branch",
        remainingBranches,
        branchCleanupComplete: remainingBranches.length === 0,
        reason:
          !autoMergeEnabled
            ? "auto_merge_disabled"
            : anyCancelled
              ? "run_cancelled"
              : mergeCandidates.length === 0
                ? "no_successful_mergeable_patch_branches"
                : gatePresent && anyGateBlocked
                  ? "gate_blocked"
                  : "merge_cleanup_not_run",
      },
    });
  }

  // ── Finalize the run honestly (GIT-2 cancel reconciliation) ──
  // `cancelled` wins (a stopped run must not read `failed`); `skipped`/`blocked`
  // (incl. a convergence-blocked node) never fail the run; otherwise any
  // non-success/non-skipped/non-cancelled/non-blocked node fails it.
  const anyFailed = results.some((r) => {
    const s = finalStatus(r);
    return s !== "success" && s !== "skipped" && s !== "cancelled" && s !== "blocked";
  });
  const status = anyCancelled ? "cancelled" : anyFailed ? "failed" : "success";
  await mongoRunRepository.finishRun(runId, { status }, ownerId);
  if (anyCancelled) {
    // `run.cancelled` is already streamed by the runs.cancel mutation — do not
    // emit a misleading run.failed/run.completed for a stopped run.
    return;
  }
  sseEventHub.publish(runId, {
    type: anyFailed ? "run.failed" : "run.completed",
    runId,
    timestamp: new Date().toISOString(),
    payload: breaker.tripped ? { status, reason: breaker.reason() } : { status },
  });
}

interface ExecuteRunSnapshotInput {
  runId: string;
  ownerId: string;
  graphId: string;
  snapshot: {
    nodes?: SnapshotNode[];
    edges?: Array<{ source?: string; target?: string; kind?: string }>;
    rootRepoPath?: string;
    baseBranch?: string;
  };
  runner: {
    run(input: import("./execute-runner").ExecuteRunnerInput): Promise<ExecuteRunnerSummary>;
  };
  runRepository: import("./run-repository").RunRepository;
  publish?: (runId: string, event: import("./types").RuntimeEvent) => void;
  maxConcurrency?: number;
}

export async function executeRunSnapshot(input: ExecuteRunSnapshotInput): Promise<{
  anyFailed: boolean;
  results: Awaited<ReturnType<typeof runSimpleScheduler<SnapshotNode, ExecuteRunnerSummary>>>;
}> {
  const rootRepoPath = input.snapshot.rootRepoPath;
  if (!rootRepoPath) {
    throw new Error("graphSnapshot.rootRepoPath is missing");
  }

  const nodes = (input.snapshot.nodes ?? []).filter((node) => node.kind === "execute");
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (input.snapshot.edges ?? [])
    .filter((edge) => edge.kind === undefined || edge.kind === "flow")
    .filter((edge): edge is { source: string; target: string; kind?: string } =>
      typeof edge.source === "string" &&
      typeof edge.target === "string" &&
      nodeIds.has(edge.source) &&
      nodeIds.has(edge.target)
    )
    .map((edge) => ({ source: edge.source, target: edge.target, kind: edge.kind ?? "flow" }));
  const publish = input.publish ?? ((_runId: string, _event: import("./types").RuntimeEvent) => undefined);

  const queuedEvents = nodes.map((node) =>
    createRuntimeEvent("node.queued", input.runId, node.id, {
      cli: normalizedCli(node),
      promptLength: promptForNode(node).length
    })
  );

  for (const event of queuedEvents) {
    publish(input.runId, event);
  }
  await input.runRepository.appendNodeEventsBatch(queuedEvents, input.ownerId);
  const skippedPersistence: Array<Promise<void>> = [];

  const results = await runSimpleScheduler<SnapshotNode, ExecuteRunnerSummary>({
    nodes,
    edges,
    maxConcurrency: input.maxConcurrency ?? MAX_CONCURRENCY,
    isSuccessfulResult: (result) => result.status === "success",
    runNode: (node) =>
      input.runner.run({
        ownerId: input.ownerId,
        runId: input.runId,
        graphId: input.graphId,
        nodeId: node.id,
        rootRepoPath,
        baseRef: node.data?.baseRef ?? input.snapshot.baseBranch ?? "HEAD",
        prompt: promptForNode(node),
        cli: normalizedCli(node),
        secretRefs: parseSecretRefs(node.data?.secretRefs),
        allowedPaths: parseAllowedPaths(node.data?.allowedPaths),
        pathPolicyMode: parsePathPolicyMode(node.data?.pathPolicyMode),
        timeoutMs: parseTimeoutMs(node.data?.timeoutMs)
      }),
    onNodeSkipped: (node, reason) => {
      const event = createRuntimeEvent("node.skipped", input.runId, node.id, {
        reason,
        upstreamNodeId: upstreamNodeIdFromSkipReason(reason)
      });
      publish(input.runId, event);
      skippedPersistence.push(Promise.resolve(input.runRepository.appendNodeEvent(event, input.ownerId)));
      skippedPersistence.push(Promise.resolve(input.runRepository.updateNodeRun(
        input.runId,
        node.id,
        { status: "skipped" },
        input.ownerId
      )));
    }
  });
  await Promise.all(skippedPersistence);

  return {
    anyFailed: results.some((result) => result.status !== "success"),
    results
  };
}

function normalizedCli(node: SnapshotNode): SupportedCli {
  const cli = (node.data?.cli ?? "codex") as SupportedCli;
  return normalizeRuntimeCli(cli);
}

function normalizeRuntimeCli(candidate: SupportedCli): SupportedCli {
  if (!VALID_CLIS.includes(candidate)) return "codex";
  if (
    candidate === "fake" &&
    process.env.NODE_ENV !== "test" &&
    process.env.ORCH_ALLOW_FAKE_CLI !== "1"
  ) {
    return "codex";
  }
  return candidate;
}

async function listRunRuntimeBranches(rootRepoPath: string, runId: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", rootRepoPath, "branch", "--format", "%(refname:short)"],
      { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 30_000 },
    );
    const agentPrefix = `agent/${runId}/`;
    const mergePrefix = `merge/${runId}/`;
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^\*\s*/, ""))
      .filter((branch) => branch.startsWith(agentPrefix) || branch.startsWith(mergePrefix));
  } catch {
    return [];
  }
}

function promptForNode(node: SnapshotNode): string {
  return node.data?.prompt ?? node.label ?? "";
}

function parseAllowedPaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowedPaths = value.filter((entry): entry is string =>
    typeof entry === "string" && entry.trim().length > 0
  );
  return allowedPaths.length > 0 ? allowedPaths : undefined;
}

function parsePathPolicyMode(value: unknown): "warn" | "fail" | undefined {
  return value === "warn" || value === "fail" ? value : undefined;
}

function parseTimeoutMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseSecretRefs(value: unknown): CliSecretRefs | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const refs: CliSecretRefs = {};
  for (const [key, ref] of Object.entries(value as Record<string, unknown>)) {
    if (typeof ref === "string" && ref.trim()) refs[key] = ref;
  }
  return Object.keys(refs).length > 0 ? refs : undefined;
}

function createRuntimeEvent(
  type: import("./types").RuntimeEvent["type"],
  runId: string,
  nodeId: string,
  payload: Record<string, unknown> = {}
): import("./types").RuntimeEvent {
  return {
    type,
    runId,
    nodeId,
    timestamp: new Date().toISOString(),
    payload
  };
}

function upstreamNodeIdFromSkipReason(reason: string): string | undefined {
  const match = /^Dependency\s+(.+?)\s+(?:did not complete successfully|was skipped)$/.exec(reason);
  return match?.[1];
}
