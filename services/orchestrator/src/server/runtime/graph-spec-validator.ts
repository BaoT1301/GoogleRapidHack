import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import AjvModule from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import graphSpecSchema from "./_schemas/graph-spec.schema.json" with { type: "json" };
import type { CreateGraphInput, GraphSpec, UpdateGraphInput } from "./_ported-types/graph-spec";
import { sanitizeId } from "./git-merge-coordinator";

const execFileAsync = promisify(execFile);
type AjvConstructor = new (options?: { allErrors?: boolean }) => {
  compile(schema: object): ValidateFunction;
};
const Ajv = (AjvModule as unknown as { default?: AjvConstructor }).default ??
  (AjvModule as unknown as AjvConstructor);
const validateSchema = new Ajv({ allErrors: true }).compile(graphSpecSchema);

export async function validateGraphSpec(graph: GraphSpec): Promise<void> {
  if (!validateSchema(graph)) {
    throw new Error(`Invalid GraphSpec: ${validateSchema.errors?.map((error: ErrorObject) => {
      // Ajv v8 uses `instancePath`; v6 uses `dataPath`. Support both.
      const e = error as ErrorObject & { instancePath?: string; dataPath?: string };
      return `${e.instancePath ?? e.dataPath ?? "/"} ${error.message}`;
    }).join("; ")}`);
  }

  if (!path.isAbsolute(graph.rootRepoPath)) {
    throw new Error("rootRepoPath must be an absolute path");
  }

  await runGit(graph.rootRepoPath, ["rev-parse", "--is-inside-work-tree"]);
  await runGit(graph.rootRepoPath, ["rev-parse", "--verify", graph.baseBranch]);
  assertGraphSemantics(graph);
}

export function graphFromCreateInput(input: CreateGraphInput): CreateGraphInput {
  return {
    ...input,
    name: input.name.trim(),
    description: input.description?.trim(),
    rootRepoPath: path.resolve(input.rootRepoPath),
    baseBranch: input.baseBranch.trim(),
    nodes: input.nodes ?? [],
    edges: input.edges ?? []
  };
}

export function graphFromUpdateInput(current: GraphSpec, input: UpdateGraphInput): GraphSpec {
  const {
    expectedRevision: _expectedRevision,
    name,
    description,
    rootRepoPath,
    baseBranch,
    status,
    nodes,
    edges
  } = input;

  return {
    ...current,
    name: name?.trim() ?? current.name,
    description: description?.trim() ?? current.description,
    rootRepoPath: rootRepoPath ? path.resolve(rootRepoPath) : current.rootRepoPath,
    baseBranch: baseBranch?.trim() ?? current.baseBranch,
    status: status ?? current.status,
    nodes: nodes ?? current.nodes,
    edges: edges ?? current.edges,
    revision: current.revision,
    updatedAt: current.updatedAt
  };
}

function assertGraphSemantics(graph: GraphSpec): void {
  const graphId = sanitizeId(graph.id, "graph.id");
  if (graphId !== graph.id) {
    throw new Error("graph.id must already be path-safe");
  }

  const nodeIds = new Set<string>();
  const sanitizedNodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`Duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);

    const sanitized = sanitizeId(node.id, `node id ${node.id}`);
    if (sanitizedNodeIds.has(sanitized)) {
      throw new Error(`Node ids collide after sanitization: ${node.id}`);
    }
    sanitizedNodeIds.add(sanitized);
  }

  const edgeIds = new Set<string>();
  const connections = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      throw new Error(`Duplicate edge id: ${edge.id}`);
    }
    edgeIds.add(edge.id);

    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error(`Edge ${edge.id} references a missing node`);
    }
    if (edge.source === edge.target) {
      throw new Error(`Edge ${edge.id} cannot connect a node to itself`);
    }

    const connection = `${edge.source}\u0000${edge.target}`;
    if (connections.has(connection)) {
      throw new Error(`Duplicate flow edge: ${edge.source} -> ${edge.target}`);
    }
    connections.add(connection);
  }

  assertAcyclic(graph.nodes.map((node) => node.id), graph.edges);
}

function assertAcyclic(nodeIds: string[], edges: GraphSpec["edges"]): void {
  const children = new Map(nodeIds.map((nodeId) => [nodeId, [] as string[]]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  for (const edge of edges) {
    children.get(edge.source)?.push(edge.target);
  }

  const visit = (nodeId: string) => {
    if (visiting.has(nodeId)) {
      throw new Error("Graph contains a flow cycle");
    }
    if (visited.has(nodeId)) {
      return;
    }
    visiting.add(nodeId);
    for (const child of children.get(nodeId) ?? []) {
      visit(child);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const nodeId of nodeIds) {
    visit(nodeId);
  }
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  try {
    await execFileAsync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    throw new Error(`Git validation failed for ${cwd}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
