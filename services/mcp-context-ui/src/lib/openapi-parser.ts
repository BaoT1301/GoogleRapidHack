/**
 * OpenAPI Parser
 *
 * Parses the MCP Context Manager OpenAPI specification and provides
 * typed data structures for the API Reference UI to consume.
 * Extracts endpoints, parameters, request bodies, response schemas, and examples.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface ParameterDef {
  name: string;
  in: "query" | "path" | "header";
  required: boolean;
  description: string;
  schema: SchemaField;
}

export interface SchemaField {
  type: "string" | "integer" | "number" | "boolean" | "array" | "object";
  enum?: string[];
  default?: string | number | boolean;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  items?: SchemaField;
  description?: string;
}

export interface RequestBodyDef {
  required: boolean;
  properties: Record<string, SchemaField & { required?: boolean }>;
  example?: Record<string, unknown>;
}

export interface EndpointDef {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  operationId: string;
  tag: string;
  parameters: ParameterDef[];
  requestBody?: RequestBodyDef;
  responseExample?: Record<string, unknown>;
  responseDescription: string;
}

export interface EndpointGroup {
  tag: string;
  description: string;
  endpoints: EndpointDef[];
}

// ---------------------------------------------------------------------------
// Static endpoint data (parsed from OpenAPI spec at build time)
// ---------------------------------------------------------------------------

const ENDPOINT_DATA: EndpointDef[] = [
  // Health
  {
    id: "getHealth",
    method: "GET",
    path: "/api/v1/health",
    summary: "Health check",
    description: "Returns service health status. Also available at /api/health (alias).",
    operationId: "getHealth",
    tag: "Health",
    parameters: [],
    responseExample: { status: "ok | degraded", reasons: [] },
    responseDescription: "Service is healthy or degraded (running but 0 files indexed)",
  },
  // Graph Export
  {
    id: "exportGraph",
    method: "GET",
    path: "/api/v1/mcp/graph",
    summary: "Export dependency graph",
    description: "Exports the full dependency graph with nodes (files, functions, classes, variables) and edges (imports, calls, reads, writes). Nodes include geographic coordinates and cluster assignments for visualization.",
    operationId: "exportGraph",
    tag: "Graph Export",
    parameters: [
      { name: "scope", in: "query", required: false, description: "Graph scope", schema: { type: "string", enum: ["repo", "file", "symbol"], default: "repo" } },
      { name: "file_path", in: "query", required: false, description: "Required when scope is 'file'", schema: { type: "string" } },
      { name: "symbol_qualified_name", in: "query", required: false, description: "Required when scope is 'symbol'", schema: { type: "string" } },
      { name: "max_nodes", in: "query", required: false, description: "Max nodes (0 = unlimited)", schema: { type: "integer", default: 0 } },
      { name: "max_edges", in: "query", required: false, description: "Max edges (0 = unlimited)", schema: { type: "integer", default: 0 } },
    ],
    responseExample: {
      nodes: [{ id: "file:backend/app/main.py", type: "file", label: "main.py", filePath: "backend/app/main.py" }],
      edges: [{ source: "file:backend/app/main.py", target: "file:backend/app/database.py", type: "imports" }],
      meta: { nodeCount: 150, edgeCount: 300 },
    },
    responseDescription: "Graph exported successfully",
  },
  {
    id: "getClusters",
    method: "GET",
    path: "/api/v1/mcp/clusters",
    summary: "Get cluster configuration",
    description: "Returns the current cluster groupings used for geographic mapping.",
    operationId: "getClusters",
    tag: "Graph Export",
    parameters: [],
    responseExample: { clusters: [{ id: "backend", path: "backend/", label: "Backend Services", color: "#4A90E2" }] },
    responseDescription: "Cluster configuration",
  },
  // Function Context
  {
    id: "getFunctionContext",
    method: "GET",
    path: "/api/v1/mcp/function/{functionName}",
    summary: "Get function context",
    description: "Returns the neighborhood subgraph around a function (callers, callees, related files).",
    operationId: "getFunctionContext",
    tag: "Function Context",
    parameters: [
      { name: "functionName", in: "path", required: true, description: "Target function name", schema: { type: "string" } },
      { name: "file_path", in: "query", required: false, description: "File path to disambiguate", schema: { type: "string" } },
      { name: "max_hops", in: "query", required: false, description: "Max hops from center node", schema: { type: "integer", default: 2 } },
      { name: "max_nodes", in: "query", required: false, description: "Max nodes to return", schema: { type: "integer", default: 150 } },
    ],
    responseExample: { centerNode: { id: "func:main:create_app", type: "function", label: "create_app" }, nodes: [], edges: [], relatedFiles: [], truncated: false },
    responseDescription: "Function context retrieved",
  },
  {
    id: "getFunctionContextPost",
    method: "POST",
    path: "/api/v1/mcp/function",
    summary: "Get function context (POST)",
    description: "Returns the neighborhood subgraph around a function using POST body.",
    operationId: "getFunctionContextPost",
    tag: "Function Context",
    parameters: [],
    requestBody: {
      required: true,
      properties: {
        function_name: { type: "string", required: true, description: "Target function name" },
        file_path: { type: "string", description: "File path to disambiguate" },
        max_hops: { type: "integer", default: 2, description: "Max hops from center node" },
        max_nodes: { type: "integer", default: 150, description: "Max nodes to return" },
      },
    },
    responseDescription: "Function context retrieved",
  },
  // File Dependents
  {
    id: "getFileDependents",
    method: "GET",
    path: "/api/v1/mcp/file/{filePath}/dependents",
    summary: "Get file dependents",
    description: "Returns files that depend on or are depended upon by the specified file.",
    operationId: "getFileDependents",
    tag: "File Dependents",
    parameters: [
      { name: "filePath", in: "path", required: true, description: "Target file path (URL-encoded)", schema: { type: "string" } },
      { name: "direction", in: "query", required: false, description: "Dependency direction", schema: { type: "string", enum: ["incoming", "outgoing", "both"], default: "incoming" } },
      { name: "depth", in: "query", required: false, description: "Traversal depth", schema: { type: "integer", default: 1 } },
      { name: "max_files", in: "query", required: false, description: "Max files to return", schema: { type: "integer", default: 200 } },
    ],
    responseDescription: "File dependents retrieved",
  },
  {
    id: "getFileDependentsPost",
    method: "POST",
    path: "/api/v1/mcp/dependents",
    summary: "Get file dependents (POST)",
    description: "Returns files that depend on or are depended upon by the specified file using POST body.",
    operationId: "getFileDependentsPost",
    tag: "File Dependents",
    parameters: [],
    requestBody: {
      required: true,
      properties: {
        file_path: { type: "string", required: true, description: "Target file path" },
        direction: { type: "string", enum: ["incoming", "outgoing", "both"], default: "incoming", description: "Dependency direction" },
        depth: { type: "integer", default: 1, description: "Traversal depth" },
        max_files: { type: "integer", default: 200, description: "Max files to return" },
      },
    },
    responseDescription: "File dependents retrieved",
  },
  // Symbol References
  {
    id: "getSymbolReferences",
    method: "GET",
    path: "/api/v1/mcp/symbol/{symbolName}/references",
    summary: "Get symbol references",
    description: "Returns all references to a symbol across the codebase.",
    operationId: "getSymbolReferences",
    tag: "Symbol References",
    parameters: [
      { name: "symbolName", in: "path", required: true, description: "Symbol qualified name", schema: { type: "string" } },
      { name: "include_reads", in: "query", required: false, description: "Include read references", schema: { type: "boolean", default: true } },
      { name: "include_writes", in: "query", required: false, description: "Include write references", schema: { type: "boolean", default: true } },
      { name: "include_calls", in: "query", required: false, description: "Include call references", schema: { type: "boolean", default: true } },
      { name: "max_results", in: "query", required: false, description: "Max results to return", schema: { type: "integer", default: 300 } },
    ],
    responseDescription: "Symbol references retrieved",
  },
  {
    id: "getSymbolReferencesPost",
    method: "POST",
    path: "/api/v1/mcp/references",
    summary: "Get symbol references (POST)",
    description: "Returns all references to a symbol across the codebase using POST body.",
    operationId: "getSymbolReferencesPost",
    tag: "Symbol References",
    parameters: [],
    requestBody: {
      required: true,
      properties: {
        symbol_qualified_name: { type: "string", required: true, description: "Symbol qualified name" },
        include_reads: { type: "boolean", default: true, description: "Include read references" },
        include_writes: { type: "boolean", default: true, description: "Include write references" },
        include_calls: { type: "boolean", default: true, description: "Include call references" },
        max_results: { type: "integer", default: 300, description: "Max results to return" },
      },
    },
    responseDescription: "Symbol references retrieved",
  },
  // Callers
  {
    id: "getCallers",
    method: "GET",
    path: "/api/v1/mcp/callers/{functionName}",
    summary: "Get callers (reverse call graph)",
    description: "Returns all functions that call the specified function, traversing up to max_depth levels.",
    operationId: "getCallers",
    tag: "Callers",
    parameters: [
      { name: "functionName", in: "path", required: true, description: "Target function name", schema: { type: "string" } },
      { name: "file_path", in: "query", required: false, description: "File path to disambiguate", schema: { type: "string" } },
      { name: "max_depth", in: "query", required: false, description: "Transitive depth", schema: { type: "integer", default: 3, minimum: 1, maximum: 10 } },
      { name: "max_results", in: "query", required: false, description: "Max callers returned", schema: { type: "integer", default: 100, minimum: 1, maximum: 500 } },
    ],
    responseDescription: "Callers retrieved",
  },
  {
    id: "getCallersPost",
    method: "POST",
    path: "/api/v1/mcp/callers",
    summary: "Get callers (POST)",
    description: "Returns all functions that call the specified function using POST body.",
    operationId: "getCallersPost",
    tag: "Callers",
    parameters: [],
    requestBody: {
      required: true,
      properties: {
        function_name: { type: "string", required: true, description: "Target function name" },
        file_path: { type: "string", description: "File path to disambiguate" },
        max_depth: { type: "integer", default: 3, description: "Transitive depth" },
        max_results: { type: "integer", default: 100, description: "Max callers returned" },
      },
      example: { function_name: "create_app", file_path: "backend/app/main.py", max_depth: 3, max_results: 100 },
    },
    responseDescription: "Callers retrieved",
  },
  // Call Chain
  {
    id: "getCallChain",
    method: "GET",
    path: "/api/v1/mcp/call-chain/{functionName}",
    summary: "Get call chain (directed subgraph)",
    description: "Returns the upstream and/or downstream call chain for a function.",
    operationId: "getCallChain",
    tag: "Call Chain",
    parameters: [
      { name: "functionName", in: "path", required: true, description: "Target function name", schema: { type: "string" } },
      { name: "file_path", in: "query", required: false, description: "File path to disambiguate", schema: { type: "string" } },
      { name: "direction", in: "query", required: false, description: "Chain direction", schema: { type: "string", enum: ["upstream", "downstream", "both"], default: "both" } },
      { name: "max_depth", in: "query", required: false, description: "Traversal depth", schema: { type: "integer", default: 5, minimum: 1, maximum: 10 } },
      { name: "max_nodes", in: "query", required: false, description: "Max nodes in subgraph", schema: { type: "integer", default: 200, minimum: 1, maximum: 500 } },
    ],
    responseDescription: "Call chain retrieved",
  },
  {
    id: "getCallChainPost",
    method: "POST",
    path: "/api/v1/mcp/call-chain",
    summary: "Get call chain (POST)",
    description: "Returns the upstream and/or downstream call chain for a function using POST body.",
    operationId: "getCallChainPost",
    tag: "Call Chain",
    parameters: [],
    requestBody: {
      required: true,
      properties: {
        function_name: { type: "string", required: true, description: "Target function name" },
        file_path: { type: "string", description: "File path to disambiguate" },
        direction: { type: "string", enum: ["upstream", "downstream", "both"], default: "both", description: "Chain direction" },
        max_depth: { type: "integer", default: 5, description: "Traversal depth" },
        max_nodes: { type: "integer", default: 200, description: "Max nodes in subgraph" },
      },
    },
    responseDescription: "Call chain retrieved",
  },
  // Dead Code
  {
    id: "getDeadCode",
    method: "GET",
    path: "/api/v1/mcp/dead-code",
    summary: "Get dead code",
    description: "Detects unreferenced symbols (functions/classes with zero inbound edges).",
    operationId: "getDeadCode",
    tag: "Dead Code",
    parameters: [
      { name: "file_pattern", in: "query", required: false, description: "Glob pattern (e.g., backend/**)", schema: { type: "string" } },
      { name: "language", in: "query", required: false, description: "Filter by language", schema: { type: "string", enum: ["python", "typescript"] } },
      { name: "kind", in: "query", required: false, description: "Filter by symbol kind", schema: { type: "string", enum: ["function", "class"] } },
      { name: "max_results", in: "query", required: false, description: "Max results", schema: { type: "integer", default: 100, minimum: 1, maximum: 500 } },
    ],
    responseDescription: "Dead code analysis complete",
  },
  // Hotspots
  {
    id: "getHotspots",
    method: "GET",
    path: "/api/v1/mcp/hotspots",
    summary: "Get hotspots",
    description: "Returns the top-N most-referenced symbols (highest fan-in).",
    operationId: "getHotspots",
    tag: "Hotspots",
    parameters: [
      { name: "top_n", in: "query", required: false, description: "Number of hotspots to return", schema: { type: "integer", default: 20 } },
      { name: "kind", in: "query", required: false, description: "Filter by symbol kind", schema: { type: "string", enum: ["function", "class", "variable"] } },
      { name: "language", in: "query", required: false, description: "Filter by language", schema: { type: "string", enum: ["python", "typescript"] } },
      { name: "file_pattern", in: "query", required: false, description: "Glob pattern to filter files", schema: { type: "string" } },
    ],
    responseDescription: "Hotspots retrieved",
  },
  // Impact Analysis
  {
    id: "getImpactAnalysis",
    method: "GET",
    path: "/api/v1/mcp/impact/{filePath}",
    summary: "Get impact analysis",
    description: "Analyzes the blast radius of changes to a file — which files and symbols are affected.",
    operationId: "getImpactAnalysis",
    tag: "Impact Analysis",
    parameters: [
      { name: "filePath", in: "path", required: true, description: "Source file path (URL-encoded)", schema: { type: "string" } },
      { name: "max_depth", in: "query", required: false, description: "Import chain depth", schema: { type: "integer", default: 3, minimum: 1, maximum: 5 } },
      { name: "max_files", in: "query", required: false, description: "Max affected files", schema: { type: "integer", default: 100, minimum: 1, maximum: 500 } },
    ],
    responseDescription: "Impact analysis complete",
  },
  // Module Coupling
  {
    id: "getModuleCoupling",
    method: "GET",
    path: "/api/v1/mcp/coupling/{filePathA}/{filePathB}",
    summary: "Get module coupling",
    description: "Computes coupling metrics between two files (shared imports, shared symbols, direct/transitive edges).",
    operationId: "getModuleCoupling",
    tag: "Module Coupling",
    parameters: [
      { name: "filePathA", in: "path", required: true, description: "First file path", schema: { type: "string" } },
      { name: "filePathB", in: "path", required: true, description: "Second file path", schema: { type: "string" } },
      { name: "max_depth", in: "query", required: false, description: "Transitive edge traversal depth", schema: { type: "integer", default: 2 } },
    ],
    responseDescription: "Coupling metrics retrieved",
  },
  // Class Hierarchy
  {
    id: "getClassHierarchy",
    method: "GET",
    path: "/api/v1/mcp/class-hierarchy/{className}",
    summary: "Get class hierarchy",
    description: "Traverses the inheritance tree for a class (ancestors, descendants, or both).",
    operationId: "getClassHierarchy",
    tag: "Class Hierarchy",
    parameters: [
      { name: "className", in: "path", required: true, description: "Target class name", schema: { type: "string" } },
      { name: "file_path", in: "query", required: false, description: "File path to disambiguate", schema: { type: "string" } },
      { name: "direction", in: "query", required: false, description: "Traversal direction", schema: { type: "string", enum: ["ancestors", "descendants", "both"], default: "both" } },
      { name: "max_depth", in: "query", required: false, description: "Traversal depth", schema: { type: "integer", default: 5, minimum: 1, maximum: 10 } },
    ],
    responseDescription: "Class hierarchy retrieved",
  },
  // Search
  {
    id: "searchSymbols",
    method: "GET",
    path: "/api/v1/mcp/search",
    summary: "Search symbols",
    description: "Fuzzy or regex search for symbols across the codebase.",
    operationId: "searchSymbols",
    tag: "Search",
    parameters: [
      { name: "query", in: "query", required: true, description: "Search string (fuzzy match or regex)", schema: { type: "string" } },
      { name: "kind", in: "query", required: false, description: "Filter by symbol kind", schema: { type: "string", enum: ["file", "module", "function", "class", "variable", "external"] } },
      { name: "language", in: "query", required: false, description: "Filter by language", schema: { type: "string", enum: ["python", "typescript"] } },
      { name: "file_pattern", in: "query", required: false, description: "Glob pattern to filter files", schema: { type: "string" } },
      { name: "use_regex", in: "query", required: false, description: "Treat query as regex pattern", schema: { type: "boolean", default: false } },
      { name: "max_results", in: "query", required: false, description: "Max results", schema: { type: "integer", default: 50, minimum: 1, maximum: 500 } },
    ],
    responseDescription: "Search results",
  },
  // Circular Dependencies
  {
    id: "getCircularDeps",
    method: "POST",
    path: "/api/v1/mcp/circular-deps",
    summary: "Get circular dependencies",
    description: "Detects circular import chains using iterative DFS on the file-level import graph.",
    operationId: "getCircularDepsPost",
    tag: "Circular Dependencies",
    parameters: [],
    requestBody: {
      required: false,
      properties: {
        file_pattern: { type: "string", description: "Glob pattern to filter files" },
        language: { type: "string", enum: ["python", "typescript"], description: "Filter by language" },
        max_cycles: { type: "integer", default: 50, description: "Max cycles to return" },
        max_depth: { type: "integer", default: 20, description: "Max DFS depth" },
      },
    },
    responseExample: { cycles: [{ chain: ["src/a.py", "src/b.py", "src/a.py"], length: 2 }], totalFilesScanned: 42, truncated: false },
    responseDescription: "Circular dependencies detected",
  },
  // Complexity Metrics
  {
    id: "getComplexityMetrics",
    method: "POST",
    path: "/api/v1/mcp/complexity",
    summary: "Get complexity metrics",
    description: "Computes per-symbol complexity (fan-in, fan-out, max call-chain depth).",
    operationId: "getComplexityMetricsPost",
    tag: "Complexity Metrics",
    parameters: [],
    requestBody: {
      required: false,
      properties: {
        file_path: { type: "string", description: "Glob pattern to filter by file path" },
        kind: { type: "string", enum: ["function", "class", "file"], description: "Filter by symbol kind" },
        language: { type: "string", enum: ["python", "typescript"], description: "Filter by language" },
        sort_by: { type: "string", enum: ["fan_in", "fan_out", "depth", "total"], default: "total", description: "Sort field" },
        max_results: { type: "integer", default: 100, description: "Max results" },
      },
    },
    responseExample: { metrics: [{ node: { id: "func:main:create_app", type: "function", label: "create_app" }, fanIn: 5, fanOut: 3, maxDepth: 2, totalComplexity: 10 }], totalScanned: 42, truncated: false },
    responseDescription: "Complexity metrics computed",
  },
  // Change Risk
  {
    id: "getChangeRisk",
    method: "POST",
    path: "/api/v1/mcp/change-risk",
    summary: "Get change risk",
    description: "Predicts which tests should run and which areas are highest risk given a set of changed files.",
    operationId: "getChangeRiskPost",
    tag: "Change Risk",
    parameters: [],
    requestBody: {
      required: true,
      properties: {
        changed_files: { type: "array", required: true, items: { type: "string" }, minItems: 1, maxItems: 50, description: "Array of changed file paths" },
        max_depth: { type: "integer", default: 3, description: "Import chain depth" },
        max_files: { type: "integer", default: 100, description: "Max affected files" },
      },
      example: { changed_files: ["backend/app/database.py"], max_depth: 3, max_files: 100 },
    },
    responseExample: { changedFiles: ["backend/app/database.py"], aggregateRiskScore: 0.72, affectedFiles: [{ filePath: "backend/app/main.py", depth: 1, impactType: "direct", riskContribution: 1.0 }], suggestedTestFiles: ["backend/tests/test_database.py"], hotspotOverlap: [], truncated: false },
    responseDescription: "Change risk analysis complete",
  },
  // SSE Events
  {
    id: "getSSEEvents",
    method: "GET",
    path: "/api/v1/mcp/events",
    summary: "SSE event stream",
    description: "Server-Sent Events stream for real-time file change notifications. Events: connected, file-change, indexing-progress, indexing-complete, keepalive.",
    operationId: "getSSEEvents",
    tag: "SSE Events",
    parameters: [],
    responseDescription: "SSE stream established (text/event-stream)",
  },
];

// ---------------------------------------------------------------------------
// Tag metadata
// ---------------------------------------------------------------------------

const TAG_DESCRIPTIONS: Record<string, string> = {
  "Health": "Service health check",
  "Graph Export": "Full dependency graph export with geographic mapping",
  "Function Context": "Function neighborhood subgraph",
  "File Dependents": "File dependency analysis",
  "Symbol References": "Cross-file symbol reference tracking",
  "Callers": "Reverse call graph (who calls this function)",
  "Call Chain": "Directed call subgraph (upstream/downstream)",
  "Dead Code": "Unreferenced symbol detection",
  "Hotspots": "High fan-in symbols (most referenced)",
  "Impact Analysis": "File change blast radius analysis",
  "Module Coupling": "Inter-file coupling metrics",
  "Class Hierarchy": "Inheritance tree traversal",
  "Search": "Symbol search (fuzzy and regex)",
  "Circular Dependencies": "Import cycle detection",
  "Complexity Metrics": "Per-symbol complexity scoring",
  "Change Risk": "Multi-file change risk assessment",
  "SSE Events": "Server-Sent Events for real-time file change notifications",
};

// Tag ordering for display
const TAG_ORDER: string[] = [
  "Health",
  "Graph Export",
  "Function Context",
  "File Dependents",
  "Symbol References",
  "Callers",
  "Call Chain",
  "Dead Code",
  "Hotspots",
  "Impact Analysis",
  "Module Coupling",
  "Class Hierarchy",
  "Search",
  "Circular Dependencies",
  "Complexity Metrics",
  "Change Risk",
  "SSE Events",
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns all endpoints grouped by tag, in display order.
 */
export function getEndpointGroups(): EndpointGroup[] {
  const groupMap = new Map<string, EndpointDef[]>();

  for (const endpoint of ENDPOINT_DATA) {
    const existing = groupMap.get(endpoint.tag) ?? [];
    existing.push(endpoint);
    groupMap.set(endpoint.tag, existing);
  }

  return TAG_ORDER
    .filter((tag) => groupMap.has(tag))
    .map((tag) => ({
      tag,
      description: TAG_DESCRIPTIONS[tag] ?? "",
      endpoints: groupMap.get(tag)!,
    }));
}

/**
 * Returns all endpoints as a flat list.
 */
export function getAllEndpoints(): EndpointDef[] {
  return ENDPOINT_DATA;
}

/**
 * Returns the total number of endpoints.
 */
export function getEndpointCount(): number {
  return ENDPOINT_DATA.length;
}

/**
 * Returns the total number of tags/categories.
 */
export function getTagCount(): number {
  return TAG_ORDER.length;
}

/**
 * Finds an endpoint by its operation ID.
 */
export function getEndpointById(id: string): EndpointDef | undefined {
  return ENDPOINT_DATA.find((e) => e.id === id);
}
