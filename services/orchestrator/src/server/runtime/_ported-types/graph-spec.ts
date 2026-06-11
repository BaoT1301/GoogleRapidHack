import type { SupportedCli } from "../types";

export interface GraphSpec {
  graphSpecVersion: "1.0";
  id: string;
  name: string;
  description?: string;
  rootRepoPath: string;
  baseBranch: string;
  status: "draft" | "archived";
  revision: number;
  createdAt: string;
  updatedAt: string;
  nodes: ExecuteGraphNode[];
  edges: FlowGraphEdge[];
}

export interface ExecuteGraphNode {
  id: string;
  kind: "execute";
  label: string;
  cli: SupportedCli;
  prompt: string;
  position: { x: number; y: number };
}

export interface FlowGraphEdge {
  id: string;
  kind: "flow";
  source: string;
  target: string;
}

export interface CreateGraphInput {
  name: string;
  description?: string;
  rootRepoPath: string;
  baseBranch: string;
  nodes?: ExecuteGraphNode[];
  edges?: FlowGraphEdge[];
}

export interface UpdateGraphInput {
  expectedRevision: number;
  name?: string;
  description?: string;
  rootRepoPath?: string;
  baseBranch?: string;
  status?: GraphSpec["status"];
  nodes?: ExecuteGraphNode[];
  edges?: FlowGraphEdge[];
}
