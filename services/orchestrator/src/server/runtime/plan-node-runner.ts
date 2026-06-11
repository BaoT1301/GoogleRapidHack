import { planToGraphSpec } from "@/lib/plan-map";
import { generatePlan, type GeneratePlanResult } from "../plan/generate-plan";
import type { PlanProviderName } from "../plan/types";
import type { GraphSpec } from "../plan/schemas";
import type { PlanNodeRunResult } from "./plan-node-types";

const UPSTREAM_OUTPUT_PREVIEW_LIMIT = 3000;

interface RuntimeGraphNode {
  id: string;
  kind?: string;
  label?: string;
  data?: Record<string, unknown>;
}

interface RuntimeGraphSnapshot {
  name?: string;
  rootRepoPath?: string;
  baseBranch?: string;
  baseRef?: string;
  nodes?: RuntimeGraphNode[];
  edges?: Array<{ source?: string; target?: string; kind?: string }>;
}

export interface RunPlanNodeInput {
  ownerId: string;
  runId: string;
  nodeId: string;
  node: RuntimeGraphNode;
  graphSnapshot: RuntimeGraphSnapshot;
  upstreamOutputs?: Record<string, unknown>;
}

export async function runPlanNode(input: RunPlanNodeInput): Promise<PlanNodeRunResult> {
  const objective = asString(input.node.data?.objective);
  const prompt = asString(input.node.data?.prompt) || input.node.label || objective;
  const provider = normalizeProvider(input.node.data?.provider);
  const model = asString(input.node.data?.model);
  const warnings: string[] = [];

  const allowDownstreamAfterProposal =
    input.node.data?.allowDownstreamAfterProposal === true;
  if (model && model !== "auto") {
    warnings.push(
      "Plan node model selection is validated by the backend allowlist, but the planner provider may still use its configured default unless it supports explicit model routing.",
    );
  }

  try {
    const result = await generatePlan({
      prompt: buildPlanPrompt({
        objective,
        prompt,
        graphSnapshot: input.graphSnapshot,
        upstreamOutputs: input.upstreamOutputs,
      }),
      approved: true,
      messages: [],
      provider,
      model: model || undefined,
      ownerId: input.ownerId,
      source: "plan_node_runtime",
    });

    warnings.push(...result.warnings);
    if (result.resultType === "graph_spec" && result.graphSpec) {
      return graphSpecResult({
        result,
        objective,
        prompt,
        warnings,
        allowDownstreamAfterProposal,
      });
    }
    if (result.resultType === "graph_spec" || !result.contextRequest) {
      return failedResult({
        provider: result.provider,
        model: result.model,
        objective,
        prompt,
        warnings,
        reason: "planner output did not validate as ContextRequest or GraphSpec",
        failureReason: "plan-output-validation",
      });
    }

    return contextRequestResult({
      result,
      objective,
      prompt,
      warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedResult({
      provider: provider === "local" ? "local" : "cloud",
      objective,
      prompt,
      warnings,
      reason: message,
      failureReason: "plan-provider",
    });
  }
}

function failedResult(input: {
  provider: "cloud" | "local";
  model?: string;
  objective: string;
  prompt: string;
  warnings: string[];
  reason: string;
  failureReason: string;
}): PlanNodeRunResult {
  return {
    status: "failed",
    eventType: "node.plan.failed",
    failureReason: input.failureReason,
    output: {
      kind: "plan",
      status: "failed",
      provider: input.provider,
      model: input.model,
      objective: input.objective,
      prompt: input.prompt,
      warnings: input.warnings,
      generatedAt: new Date().toISOString(),
    },
    eventPayload: {
      kind: "plan",
      reason: input.reason,
      warnings: input.warnings,
    },
  };
}

function graphSpecResult(input: {
  result: GeneratePlanResult;
  objective: string;
  prompt: string;
  warnings: string[];
  allowDownstreamAfterProposal: boolean;
}): PlanNodeRunResult {
  const graphSpec = input.result.graphSpec as GraphSpec;
  const proposal = planToGraphSpec(graphSpec);
  const output = {
    kind: "plan" as const,
    status: "proposal_ready" as const,
    provider: input.result.provider,
    model: input.result.model,
    objective: input.objective,
    prompt: input.prompt,
    resultType: "graph_spec" as const,
    graphProposal: {
      featureName: graphSpec.featureName,
      sprintNumber: graphSpec.sprintNumber,
      missingContext: graphSpec.missingContext,
      proposedNodes: proposal.nodes,
      proposedEdges: proposal.edges,
      rawGraphSpecPreview: input.result.rawPreview,
    },
    warnings: input.warnings,
    generatedAt: new Date().toISOString(),
  };

  return {
    status: input.allowDownstreamAfterProposal ? "success" : "blocked",
    eventType: "node.plan.proposal_ready",
    output,
    eventPayload: {
      kind: "plan",
      provider: output.provider,
      resultType: "graph_spec",
      proposedNodeCount: proposal.nodes.length,
      proposedEdgeCount: proposal.edges.length,
      requiresApply: !input.allowDownstreamAfterProposal,
      allowDownstreamAfterProposal: input.allowDownstreamAfterProposal,
      warnings: input.warnings,
    },
  };
}

function contextRequestResult(input: {
  result: GeneratePlanResult;
  objective: string;
  prompt: string;
  warnings: string[];
}): PlanNodeRunResult {
  const contextRequest = input.result.contextRequest;
  return {
    status: "blocked",
    eventType: "node.plan.context_required",
    output: {
      kind: "plan",
      status: "context_required",
      provider: input.result.provider,
      model: input.result.model,
      objective: input.objective,
      prompt: input.prompt,
      resultType: "context_request",
      contextRequest,
      warnings: input.warnings,
      generatedAt: new Date().toISOString(),
    },
    eventPayload: {
      kind: "plan",
      provider: input.result.provider,
      resultType: "context_request",
      confidence: contextRequest?.confidence,
      questionCount: contextRequest?.questions.length ?? 0,
      requiresHumanInput: true,
      warnings: input.warnings,
    },
  };
}

function buildPlanPrompt(input: {
  objective: string;
  prompt: string;
  graphSnapshot: RuntimeGraphSnapshot;
  upstreamOutputs?: Record<string, unknown>;
}): string {
  const parts = [
    "Generate a graph proposal for this Plan node. Do not mutate the existing graph.",
    input.objective ? `Objective: ${input.objective}` : undefined,
    input.prompt ? `Plan node prompt: ${input.prompt}` : undefined,
    input.graphSnapshot.name ? `Graph: ${input.graphSnapshot.name}` : undefined,
    input.graphSnapshot.rootRepoPath ? `Root repo: ${input.graphSnapshot.rootRepoPath}` : undefined,
    (input.graphSnapshot.baseBranch ?? input.graphSnapshot.baseRef)
      ? `Base branch/ref: ${input.graphSnapshot.baseBranch ?? input.graphSnapshot.baseRef}`
      : undefined,
    input.upstreamOutputs && Object.keys(input.upstreamOutputs).length > 0
      ? `Upstream outputs: ${previewJson(input.upstreamOutputs, UPSTREAM_OUTPUT_PREVIEW_LIMIT)}`
      : undefined,
    "Return the canonical Architect graph_spec when enough context exists.",
  ];
  return parts.filter(Boolean).join("\n\n");
}

function normalizeProvider(value: unknown): PlanProviderName | "auto" | undefined {
  return value === "cloud" || value === "local" || value === "auto" ? value : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function previewJson(value: unknown, limit: number): string {
  try {
    const text = JSON.stringify(value);
    return text.length <= limit ? text : `${text.slice(0, limit)}… [truncated]`;
  } catch {
    return "[unserializable upstream outputs]";
  }
}
