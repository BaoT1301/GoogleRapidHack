import type { INodeSpec, IEdgeSpec } from "@/db/models/graph.model";

/** Portable GraphSpec JSON — the subset of IGraph that round-trips on import. */
export interface GraphSpecFile {
  graphSpecVersion: string;
  name: string;
  description?: string;
  rootRepoPath?: string;
  baseBranch: string;
  nodes: INodeSpec[];
  edges: IEdgeSpec[];
}

/** Shape coming back from `graphs.getById` / `graphs.list` (loosely typed). */
interface GraphLike {
  graphSpecVersion?: string;
  name: string;
  description?: string;
  rootRepoPath?: string;
  baseBranch?: string;
  nodes?: unknown;
  edges?: unknown;
}

export function toGraphSpec(graph: GraphLike): GraphSpecFile {
  return {
    graphSpecVersion: graph.graphSpecVersion ?? "1.0",
    name: graph.name,
    description: graph.description,
    rootRepoPath: graph.rootRepoPath,
    baseBranch: graph.baseBranch ?? "main",
    nodes: (graph.nodes as INodeSpec[]) ?? [],
    edges: (graph.edges as IEdgeSpec[]) ?? [],
  };
}

/** Validate + normalise an uploaded GraphSpec JSON string. Throws on bad input. */
export function parseGraphSpec(text: string): GraphSpecFile {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }
  if (typeof obj !== "object" || obj === null) {
    throw new Error("GraphSpec must be a JSON object.");
  }
  const g = obj as Record<string, unknown>;
  if (typeof g.name !== "string" || g.name.trim() === "") {
    throw new Error("GraphSpec is missing a 'name'.");
  }
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
    throw new Error("GraphSpec must contain 'nodes' and 'edges' arrays.");
  }
  return {
    graphSpecVersion: typeof g.graphSpecVersion === "string" ? g.graphSpecVersion : "1.0",
    name: g.name,
    description: typeof g.description === "string" ? g.description : undefined,
    rootRepoPath: typeof g.rootRepoPath === "string" ? g.rootRepoPath : undefined,
    baseBranch: typeof g.baseBranch === "string" ? g.baseBranch : "main",
    nodes: g.nodes as INodeSpec[],
    edges: g.edges as IEdgeSpec[],
  };
}

/** Trigger a browser download of the graph as GraphSpec JSON. */
export function downloadGraphSpec(graph: GraphLike): void {
  const spec = toGraphSpec(graph);
  const blob = new Blob([JSON.stringify(spec, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${spec.name.replace(/[^\w.-]+/g, "_") || "graph"}.graphspec.json`;
  a.click();
  URL.revokeObjectURL(url);
}
