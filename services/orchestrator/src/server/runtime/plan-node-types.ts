import type { IEdgeSpec, INodeSpec } from "@/db/models/graph.model";
import type { ContextRequest, GraphSpec } from "../plan/schemas";
import type { PlanProviderName } from "../plan/types";

export type PlanNodeResultStatus =
  | "proposal_ready"
  | "context_required"
  | "failed";

export interface PlanNodeGraphProposal {
  featureName?: string;
  sprintNumber?: number;
  missingContext?: string[];
  proposedNodes: INodeSpec[];
  proposedEdges: IEdgeSpec[];
  rawGraphSpecPreview: unknown;
}

export interface PlanNodeOutput {
  kind: "plan";
  status: PlanNodeResultStatus;
  provider: PlanProviderName;
  model?: string;
  objective: string;
  prompt: string;
  resultType?: "context_request" | "graph_spec";
  contextRequest?: ContextRequest;
  graphProposal?: PlanNodeGraphProposal;
  warnings: string[];
  generatedAt: string;
}

export interface PlanNodeRunResult {
  status: "success" | "blocked" | "failed";
  output: PlanNodeOutput;
  eventType:
    | "node.plan.context_required"
    | "node.plan.proposal_ready"
    | "node.plan.failed";
  eventPayload: Record<string, unknown>;
  failureReason?: string;
}
