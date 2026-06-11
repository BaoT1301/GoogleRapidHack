import { z } from "zod";

import { GraphStore } from "../graph/graph-store.js";

const edgeTypeEnum = z.enum([
  "imports",
  "defines",
  "calls",
  "instantiates",
  "reads",
  "writes",
  "references",
  "exports",
  "inherits",
]);

export function registerContextTools(server: {
  tool: (
    name: string,
    description: string,
    schema: z.ZodRawShape,
    handler: (args: any) => Promise<{ content: Array<{ type: "text"; text: string }> }>,
  ) => void;
}, graphStore: GraphStore): void {
  server.tool(
    "get_function_context",
    "Get graph neighborhood around a function symbol.",
    {
      function_name: z.string().min(1),
      file_path: z.string().optional(),
      max_hops: z.number().int().min(1).max(4).default(2),
      include_edge_types: z.array(edgeTypeEnum).optional(),
      max_nodes: z.number().int().min(1).max(500).default(150),
    },
    async (args) => {
      const result = graphStore.getFunctionContext({
        functionName: args.function_name,
        filePath: args.file_path,
        maxHops: args.max_hops,
        includeEdgeTypes: args.include_edge_types,
        maxNodes: args.max_nodes,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "get_file_dependents",
    "Find direct or transitive dependents/dependencies for a file.",
    {
      file_path: z.string().min(1),
      direction: z.enum(["incoming", "outgoing", "both"]).default("incoming"),
      depth: z.number().int().min(1).max(3).default(1),
      max_files: z.number().int().min(1).max(1000).default(200),
    },
    async (args) => {
      const result = graphStore.getFileDependents({
        filePath: args.file_path,
        direction: args.direction,
        depth: args.depth,
        maxFiles: args.max_files,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "get_symbol_references",
    "Resolve references to a qualified symbol.",
    {
      symbol_qualified_name: z.string().min(1),
      include_reads: z.boolean().default(true),
      include_writes: z.boolean().default(true),
      include_calls: z.boolean().default(true),
      max_results: z.number().int().min(1).max(2000).default(300),
    },
    async (args) => {
      const result = graphStore.getSymbolReferences({
        symbolQualifiedName: args.symbol_qualified_name,
        includeReads: args.include_reads,
        includeWrites: args.include_writes,
        includeCalls: args.include_calls,
        maxResults: args.max_results,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "get_callers",
    "Given a function name, return all functions that call it (reverse call graph). Supports depth parameter for transitive callers.",
    {
      function_name: z.string().min(1),
      file_path: z.string().optional(),
      max_depth: z.number().int().min(1).max(10).default(3),
      max_results: z.number().int().min(1).max(500).default(100),
    },
    async (args) => {
      const result = graphStore.getCallers({
        functionName: args.function_name,
        filePath: args.file_path,
        maxDepth: args.max_depth,
        maxResults: args.max_results,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "get_call_chain",
    "Given a function name and direction (upstream/downstream/both), return the full call chain as a directed subgraph of nodes and edges.",
    {
      function_name: z.string().min(1),
      file_path: z.string().optional(),
      direction: z.enum(["upstream", "downstream", "both"]).default("both"),
      max_depth: z.number().int().min(1).max(10).default(5),
      max_nodes: z.number().int().min(1).max(500).default(200),
    },
    async (args) => {
      const result = graphStore.getCallChain({
        functionName: args.function_name,
        filePath: args.file_path,
        direction: args.direction,
        maxDepth: args.max_depth,
        maxNodes: args.max_nodes,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "get_dead_code",
    "Find functions and classes with zero inbound calls/instantiations (potential dead code). Supports filtering by file pattern, language, and symbol kind.",
    {
      file_pattern: z.string().optional(),
      language: z.enum(["python", "typescript"]).optional(),
      kind: z.enum(["function", "class"]).optional(),
      max_results: z.number().int().min(1).max(500).default(100),
    },
    async (args) => {
      const result = graphStore.getDeadCode({
        filePattern: args.file_pattern,
        language: args.language,
        kind: args.kind,
        maxResults: args.max_results,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "get_hotspots",
    "Return the top-N most-referenced symbols in the codebase (highest fan-in). Supports filtering by symbol kind, language, and file pattern. Useful for identifying critical code paths and high-risk symbols.",
    {
      top_n: z.number().int().min(1).max(100).default(20),
      kind: z.enum(["function", "class", "variable"]).optional(),
      language: z.enum(["python", "typescript"]).optional(),
      file_pattern: z.string().optional(),
      include_edge_types: z.array(edgeTypeEnum).optional(),
    },
    async (args) => {
      const result = graphStore.getHotspots({
        topN: args.top_n,
        kind: args.kind,
        language: args.language,
        filePattern: args.file_pattern,
        includeEdgeTypes: args.include_edge_types,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "get_impact_analysis",
    "Given a file path, compute the transitive closure of all files and symbols that would be affected by a change to that file. Returns affected files, affected symbols, risk score, and suggested test files.",
    {
      file_path: z.string().min(1),
      max_depth: z.number().int().min(1).max(5).default(3),
      max_files: z.number().int().min(1).max(500).default(100),
    },
    async (args) => {
      const result = graphStore.getImpactAnalysis({
        filePath: args.file_path,
        maxDepth: args.max_depth,
        maxFiles: args.max_files,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "export_dependency_graph",
    "Export graph slice for visualization libraries such as D3.js or React Flow.",
    {
      scope: z.enum(["repo", "file", "symbol"]),
      file_path: z.string().optional(),
      symbol_qualified_name: z.string().optional(),
      max_nodes: z.number().int().min(1).max(10000).default(2000),
      max_edges: z.number().int().min(1).max(20000).default(4000),
    },
    async (args) => {
      const result = graphStore.exportDependencyGraph({
        scope: args.scope,
        filePath: args.file_path,
        symbolQualifiedName: args.symbol_qualified_name,
        maxNodes: args.max_nodes,
        maxEdges: args.max_edges,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "get_module_coupling",
    "Compute coupling metrics between two file paths. Returns shared imports, shared symbols, direct edges, transitive edges, and a normalized coupling score (0.0–1.0).",
    {
      file_path_a: z.string().min(1),
      file_path_b: z.string().min(1),
      max_depth: z.number().int().min(1).max(5).default(2),
    },
    async (args) => {
      const result = graphStore.getModuleCoupling({
        filePathA: args.file_path_a,
        filePathB: args.file_path_b,
        maxDepth: args.max_depth,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "search_symbols",
    "Fuzzy search across all symbols in the graph by name, kind, and file path. Returns ranked results with match scores. Supports regex patterns for advanced queries.",
    {
      query: z.string().min(1),
      kind: z.enum(["file", "module", "function", "class", "variable", "external"]).optional(),
      language: z.enum(["python", "typescript"]).optional(),
      file_pattern: z.string().optional(),
      use_regex: z.boolean().default(false),
      max_results: z.number().int().min(1).max(200).default(50),
    },
    async (args) => {
      const result = graphStore.searchSymbols({
        query: args.query,
        kind: args.kind,
        language: args.language,
        filePattern: args.file_pattern,
        useRegex: args.use_regex,
        maxResults: args.max_results,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "get_complexity_metrics",
    "Compute per-symbol complexity metrics: fan-in (inbound edges), fan-out (outbound edges), and max call-chain depth. Supports filtering by file path, symbol kind, and language. Results sorted by total complexity descending.",
    {
      file_path: z.string().optional(),
      kind: z.enum(["function", "class", "file"]).optional(),
      language: z.enum(["python", "typescript"]).optional(),
      sort_by: z.enum(["fan_in", "fan_out", "depth", "total"]).default("total"),
      max_results: z.number().int().min(1).max(500).default(100),
    },
    async (args) => {
      const result = graphStore.getComplexityMetrics({
        filePath: args.file_path,
        kind: args.kind,
        language: args.language,
        sortBy: args.sort_by,
        maxResults: args.max_results,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "get_circular_dependencies",
    "Detect circular import chains in the codebase. Uses DFS-based cycle detection on the file-level import graph. Supports filtering by file pattern and language.",
    {
      file_pattern: z.string().optional(),
      language: z.enum(["python", "typescript"]).optional(),
      max_cycles: z.number().int().min(1).max(200).default(50),
      max_depth: z.number().int().min(1).max(50).default(20),
    },
    async (args) => {
      const result = graphStore.getCircularDependencies({
        filePattern: args.file_pattern,
        language: args.language,
        maxCycles: args.max_cycles,
        maxDepth: args.max_depth,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "get_change_risk",
    "Given a set of changed file paths (e.g. from a git diff), predict which tests should run and which areas of the codebase are highest risk. Aggregates impact analysis across multiple files and cross-references with hotspots.",
    {
      changed_files: z.array(z.string()).min(1).max(50),
      max_depth: z.number().int().min(1).max(5).default(3),
      max_files: z.number().int().min(1).max(500).default(100),
    },
    async (args) => {
      const result = graphStore.getChangeRisk({
        changedFiles: args.changed_files,
        maxDepth: args.max_depth,
        maxFiles: args.max_files,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "get_class_hierarchy",
    "Get the class inheritance hierarchy (ancestors and/or descendants) for a given class. Traverses 'inherits' edges to build the full hierarchy tree.",
    {
      class_name: z.string().min(1),
      file_path: z.string().optional(),
      direction: z.enum(["ancestors", "descendants", "both"]).default("both"),
      max_depth: z.number().int().min(1).max(10).default(5),
    },
    async (args) => {
      const result = graphStore.getClassHierarchy({
        className: args.class_name,
        filePath: args.file_path,
        direction: args.direction,
        maxDepth: args.max_depth,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
