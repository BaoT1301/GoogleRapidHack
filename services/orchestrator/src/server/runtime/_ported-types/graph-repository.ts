import type { CreateGraphInput, GraphSpec, UpdateGraphInput } from "./graph-spec";

export class GraphRevisionConflictError extends Error {}
export class GraphNotFoundError extends Error {}
export class ArchivedGraphError extends Error {}

export interface GraphRepository {
  createGraph(input: CreateGraphInput): GraphSpec;
  listGraphs(): GraphSpec[];
  getGraph(graphId: string): GraphSpec | undefined;
  updateGraph(graphId: string, input: UpdateGraphInput): GraphSpec;
  deleteGraph(graphId: string): boolean;
}

export class InMemoryGraphRepository implements GraphRepository {
  private readonly graphs = new Map<string, GraphSpec>();

  createGraph(input: CreateGraphInput): GraphSpec {
    const now = new Date().toISOString();
    const graph: GraphSpec = {
      graphSpecVersion: "1.0",
      id: createGraphId(),
      name: input.name,
      description: input.description,
      rootRepoPath: input.rootRepoPath,
      baseBranch: input.baseBranch,
      status: "draft",
      revision: 1,
      createdAt: now,
      updatedAt: now,
      nodes: input.nodes ?? [],
      edges: input.edges ?? []
    };

    this.graphs.set(graph.id, structuredClone(graph));
    return structuredClone(graph);
  }

  listGraphs(): GraphSpec[] {
    return [...this.graphs.values()]
      .map((graph) => structuredClone(graph))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getGraph(graphId: string): GraphSpec | undefined {
    const graph = this.graphs.get(graphId);
    return graph ? structuredClone(graph) : undefined;
  }

  updateGraph(graphId: string, input: UpdateGraphInput): GraphSpec {
    const current = this.requireGraph(graphId);
    const { expectedRevision, ...changes } = input;

    if (current.status === "archived") {
      throw new ArchivedGraphError(`Graph is archived and cannot be edited: ${graphId}`);
    }

    if (expectedRevision !== current.revision) {
      throw new GraphRevisionConflictError(
        `Graph revision conflict: expected ${expectedRevision}, current ${current.revision}`
      );
    }

    const graph: GraphSpec = {
      ...current,
      ...definedChanges(changes),
      id: current.id,
      graphSpecVersion: "1.0",
      revision: current.revision + 1,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    };

    this.graphs.set(graphId, structuredClone(graph));
    return structuredClone(graph);
  }

  deleteGraph(graphId: string): boolean {
    return this.graphs.delete(graphId);
  }

  private requireGraph(graphId: string): GraphSpec {
    const graph = this.graphs.get(graphId);

    if (!graph) {
      throw new GraphNotFoundError(`Graph not found: ${graphId}`);
    }

    return graph;
  }
}

function createGraphId(): string {
  return `graph_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function definedChanges(input: Omit<UpdateGraphInput, "expectedRevision">): Partial<GraphSpec> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as Partial<GraphSpec>;
}
