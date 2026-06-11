/**
 * MCP API Client
 *
 * Type-safe client for communicating with the FastAPI backend's MCP proxy endpoints.
 * All responses are validated using Zod schemas to ensure type safety.
 */

import api from "./instance";
import {
  GraphSchema,
  FunctionContextSchema,
  FileDependentsSchema,
  SymbolReferencesSchema,
  CallersResponseSchema,
  CallChainResponseSchema,
  DeadCodeResponseSchema,
  ImpactAnalysisResponseSchema,
  ModuleCouplingResponseSchema,
  HotspotsResponseSchema,
  ClassHierarchyResponseSchema,
  SearchSymbolsResponseSchema,
  CircularDepsResponseSchema,
  ComplexityMetricsResponseSchema,
  ChangeRiskResponseSchema,
  type Graph,
  type FunctionContext,
  type FileDependents,
  type SymbolReferences,
  type CallersResponse,
  type CallChainResponse,
  type DeadCodeResponse,
  type ImpactAnalysisResponse,
  type ModuleCouplingResponse,
  type HotspotsResponse,
  type ClassHierarchyResponse,
  type SearchSymbolsResponse,
  type CircularDepsResponse,
  type ComplexityMetricsResponse,
  type ChangeRiskResponse,
} from "../types/mcp";

/**
 * Export the full dependency graph from the MCP Context Manager.
 *
 * @param scope - The scope of the graph: 'repo' (entire codebase), 'file' (single file), or 'symbol' (specific symbol)
 * @param filePath - Required when scope is 'file'
 * @param symbolQualifiedName - Required when scope is 'symbol'
 * @param maxNodes - Maximum number of nodes to return (default: 2000)
 * @param maxEdges - Maximum number of edges to return (default: 4000)
 */
export async function exportGraph(params: {
  scope: "repo" | "file" | "symbol";
  filePath?: string;
  symbolQualifiedName?: string;
  maxNodes?: number;
  maxEdges?: number;
}): Promise<Graph> {
  const { data } = await api.get("/mcp/graph", { params });
  return GraphSchema.parse(data);
}

/**
 * Get the context graph for a specific function, showing its dependencies
 * and dependents within a specified number of hops.
 *
 * @param functionName - The name of the function to analyze
 * @param filePath - Optional file path to disambiguate functions with the same name
 * @param maxHops - Maximum number of hops from the center node (default: 2)
 * @param maxNodes - Maximum number of nodes to return (default: 150)
 */
export async function getFunctionContext(params: {
  functionName: string;
  filePath?: string;
  maxHops?: number;
  maxNodes?: number;
}): Promise<FunctionContext> {
  const { functionName, ...queryParams } = params;
  const { data } = await api.get(`/mcp/function/${functionName}`, {
    params: {
      file_path: queryParams.filePath,
      max_hops: queryParams.maxHops,
      max_nodes: queryParams.maxNodes,
    },
  });
  return FunctionContextSchema.parse(data);
}

/**
 * Get all files that depend on or are depended upon by a specific file.
 *
 * @param filePath - The path to the file to analyze
 * @param direction - 'incoming' (files that depend on this file), 'outgoing' (files this file depends on), or 'both'
 * @param depth - How many levels deep to traverse (default: 1)
 * @param maxFiles - Maximum number of files to return (default: 200)
 */
export async function getFileDependents(params: {
  filePath: string;
  direction?: "incoming" | "outgoing" | "both";
  depth?: number;
  maxFiles?: number;
}): Promise<FileDependents> {
  const { filePath, ...queryParams } = params;
  const { data } = await api.get(`/mcp/file/${encodeURIComponent(filePath)}/dependents`, {
    params: {
      direction: queryParams.direction,
      depth: queryParams.depth,
      max_files: queryParams.maxFiles,
    },
  });
  return FileDependentsSchema.parse(data);
}

/**
 * Get all references to a specific symbol (function, class, variable) across the codebase.
 *
 * @param symbolName - The name of the symbol to search for
 * @param includeReads - Include read references (default: true)
 * @param includeWrites - Include write references (default: true)
 * @param includeCalls - Include function call references (default: true)
 * @param maxResults - Maximum number of references to return (default: 300)
 */
export async function getSymbolReferences(params: {
  symbolName: string;
  includeReads?: boolean;
  includeWrites?: boolean;
  includeCalls?: boolean;
  maxResults?: number;
}): Promise<SymbolReferences> {
  const { symbolName, ...queryParams } = params;
  const { data } = await api.get(`/mcp/symbol/${symbolName}/references`, {
    params: {
      include_reads: queryParams.includeReads,
      include_writes: queryParams.includeWrites,
      include_calls: queryParams.includeCalls,
      max_results: queryParams.maxResults,
    },
  });
  return SymbolReferencesSchema.parse(data);
}

// ---------------------------------------------------------------------------
// Sprint 1 — Advanced Query Endpoints
// ---------------------------------------------------------------------------

/**
 * Get all callers of a specific function (reverse call graph).
 *
 * @param functionName - The name of the function to find callers for
 * @param filePath - Optional file path to disambiguate functions with the same name
 * @param maxDepth - Transitive depth (default: 3, max: 10)
 * @param maxResults - Maximum callers returned (default: 100, max: 500)
 */
export async function getCallers(params: {
  functionName: string;
  filePath?: string;
  maxDepth?: number;
  maxResults?: number;
}): Promise<CallersResponse> {
  const { functionName, ...queryParams } = params;
  const { data } = await api.get(`/mcp/callers/${encodeURIComponent(functionName)}`, {
    params: {
      file_path: queryParams.filePath,
      max_depth: queryParams.maxDepth,
      max_results: queryParams.maxResults,
    },
  });
  return CallersResponseSchema.parse(data);
}

/**
 * Get the call chain (directed subgraph) for a specific function.
 *
 * @param functionName - The root function name
 * @param filePath - Optional file path to disambiguate
 * @param direction - 'upstream', 'downstream', or 'both' (default: 'both')
 * @param maxDepth - Traversal depth (default: 5, max: 10)
 * @param maxNodes - Max nodes in subgraph (default: 200, max: 500)
 */
export async function getCallChain(params: {
  functionName: string;
  filePath?: string;
  direction?: "upstream" | "downstream" | "both";
  maxDepth?: number;
  maxNodes?: number;
}): Promise<CallChainResponse> {
  const { functionName, ...queryParams } = params;
  const { data } = await api.get(`/mcp/call-chain/${encodeURIComponent(functionName)}`, {
    params: {
      file_path: queryParams.filePath,
      direction: queryParams.direction,
      max_depth: queryParams.maxDepth,
      max_nodes: queryParams.maxNodes,
    },
  });
  return CallChainResponseSchema.parse(data);
}

/**
 * Get dead code (unreferenced symbols) in the codebase.
 *
 * @param filePattern - Glob pattern to filter files (e.g., 'backend/**')
 * @param language - Filter by language: 'python' or 'typescript'
 * @param kind - Filter by symbol kind: 'function' or 'class'
 * @param maxResults - Maximum results (default: 100, max: 500)
 */
export async function getDeadCode(params?: {
  filePattern?: string;
  language?: string;
  kind?: string;
  maxResults?: number;
}): Promise<DeadCodeResponse> {
  const { data } = await api.get("/mcp/dead-code", {
    params: {
      file_pattern: params?.filePattern,
      language: params?.language,
      kind: params?.kind,
      max_results: params?.maxResults,
    },
  });
  return DeadCodeResponseSchema.parse(data);
}

/**
 * Get impact analysis for a specific file — which files and symbols are affected.
 *
 * @param filePath - The source file path to analyze
 * @param maxDepth - Import chain depth (default: 3, max: 5)
 * @param maxFiles - Max affected files (default: 100, max: 500)
 */
export async function getImpactAnalysis(params: {
  filePath: string;
  maxDepth?: number;
  maxFiles?: number;
}): Promise<ImpactAnalysisResponse> {
  const { filePath, ...queryParams } = params;
  const { data } = await api.get(`/mcp/impact/${encodeURIComponent(filePath)}`, {
    params: {
      max_depth: queryParams.maxDepth,
      max_files: queryParams.maxFiles,
    },
  });
  return ImpactAnalysisResponseSchema.parse(data);
}

// ---------------------------------------------------------------------------
// Sprint 2 — Advanced Query Endpoints
// ---------------------------------------------------------------------------

/**
 * Get coupling metrics between two files.
 *
 * @param filePathA - First file path
 * @param filePathB - Second file path
 * @param maxDepth - Transitive edge traversal depth (default: 2, max: 5)
 */
export async function getModuleCoupling(params: {
  filePathA: string;
  filePathB: string;
  maxDepth?: number;
}): Promise<ModuleCouplingResponse> {
  const { filePathA, filePathB, ...queryParams } = params;
  const { data } = await api.get(
    `/mcp/coupling/${encodeURIComponent(filePathA)}/${encodeURIComponent(filePathB)}`,
    {
      params: {
        max_depth: queryParams.maxDepth,
      },
    },
  );
  return ModuleCouplingResponseSchema.parse(data);
}

/**
 * Get the top-N most-referenced symbols (highest fan-in) in the codebase.
 *
 * @param topN - Number of hotspots to return (default: 20, max: 100)
 * @param kind - Filter by symbol kind: 'function', 'class', or 'variable'
 * @param language - Filter by language: 'python' or 'typescript'
 * @param filePattern - Glob pattern to filter files
 */
export async function getHotspots(params?: {
  topN?: number;
  kind?: string;
  language?: string;
  filePattern?: string;
}): Promise<HotspotsResponse> {
  const { data } = await api.get("/mcp/hotspots", {
    params: {
      top_n: params?.topN,
      kind: params?.kind,
      language: params?.language,
      file_pattern: params?.filePattern,
    },
  });
  return HotspotsResponseSchema.parse(data);
}

/**
 * Get the class inheritance hierarchy for a specific class.
 *
 * @param className - The name of the class to analyze
 * @param filePath - Optional file path to disambiguate classes with the same name
 * @param direction - 'ancestors', 'descendants', or 'both' (default: 'both')
 * @param maxDepth - Traversal depth (default: 5, max: 10)
 */
export async function getClassHierarchy(params: {
  className: string;
  filePath?: string;
  direction?: "ancestors" | "descendants" | "both";
  maxDepth?: number;
}): Promise<ClassHierarchyResponse> {
  const { className, ...queryParams } = params;
  const { data } = await api.get(`/mcp/class-hierarchy/${encodeURIComponent(className)}`, {
    params: {
      file_path: queryParams.filePath,
      direction: queryParams.direction,
      max_depth: queryParams.maxDepth,
    },
  });
  return ClassHierarchyResponseSchema.parse(data);
}

/**
 * Search for symbols across the codebase by name, kind, and file path.
 *
 * @param query - Search query string (or regex pattern if useRegex is true)
 * @param kind - Filter by symbol kind
 * @param language - Filter by language
 * @param filePattern - Glob pattern to filter files
 * @param useRegex - Whether to treat query as a regex pattern (default: false)
 * @param maxResults - Maximum results (default: 50, max: 200)
 */
export async function searchSymbols(params: {
  query: string;
  kind?: string;
  language?: string;
  filePattern?: string;
  useRegex?: boolean;
  maxResults?: number;
}): Promise<SearchSymbolsResponse> {
  const { data } = await api.get("/mcp/search", {
    params: {
      query: params.query,
      kind: params.kind,
      language: params.language,
      file_pattern: params.filePattern,
      use_regex: params.useRegex,
      max_results: params.maxResults,
    },
  });
  return SearchSymbolsResponseSchema.parse(data);
}

// ---------------------------------------------------------------------------
// Sprint 3 — Advanced Query Endpoints
// ---------------------------------------------------------------------------

/**
 * Get circular dependencies (import cycles) in the codebase.
 *
 * @param filePattern - Glob pattern to filter files
 * @param language - Filter by language: 'python' or 'typescript'
 * @param maxCycles - Maximum cycles to return (default: 50, max: 200)
 * @param maxDepth - Maximum DFS depth (default: 20, max: 50)
 */
export async function getCircularDeps(params?: {
  filePattern?: string;
  language?: "python" | "typescript";
  maxCycles?: number;
  maxDepth?: number;
}): Promise<CircularDepsResponse> {
  const { data } = await api.post("/mcp/circular-deps", {
    file_pattern: params?.filePattern,
    language: params?.language,
    max_cycles: params?.maxCycles,
    max_depth: params?.maxDepth,
  });
  return CircularDepsResponseSchema.parse(data);
}

/**
 * Get complexity metrics (fan-in, fan-out, depth) for symbols in the codebase.
 *
 * @param filePath - Glob pattern to filter by file path
 * @param kind - Filter by symbol kind: 'function', 'class', or 'file'
 * @param language - Filter by language: 'python' or 'typescript'
 * @param sortBy - Sort field: 'fan_in', 'fan_out', 'depth', or 'total' (default: 'total')
 * @param maxResults - Maximum results (default: 100, max: 500)
 */
export async function getComplexityMetrics(params?: {
  filePath?: string;
  kind?: "function" | "class" | "file";
  language?: "python" | "typescript";
  sortBy?: "fan_in" | "fan_out" | "depth" | "total";
  maxResults?: number;
}): Promise<ComplexityMetricsResponse> {
  const { data } = await api.post("/mcp/complexity", {
    file_path: params?.filePath,
    kind: params?.kind,
    language: params?.language,
    sort_by: params?.sortBy,
    max_results: params?.maxResults,
  });
  return ComplexityMetricsResponseSchema.parse(data);
}

/**
 * Get change risk analysis for a set of changed files.
 *
 * @param changedFiles - Array of changed file paths (1–50)
 * @param maxDepth - Import chain depth (default: 3, max: 5)
 * @param maxFiles - Max affected files (default: 100, max: 500)
 */
export async function getChangeRisk(params: {
  changedFiles: string[];
  maxDepth?: number;
  maxFiles?: number;
}): Promise<ChangeRiskResponse> {
  const { data } = await api.post("/mcp/change-risk", {
    changed_files: params.changedFiles,
    max_depth: params.maxDepth,
    max_files: params.maxFiles,
  });
  return ChangeRiskResponseSchema.parse(data);
}
