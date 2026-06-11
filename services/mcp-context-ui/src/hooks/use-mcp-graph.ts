/**
 * React Query Hooks for MCP Graph Data
 *
 * These hooks provide cached, auto-refreshing access to the MCP Context Manager
 * dependency graph data with proper loading and error states.
 */

import { useQuery } from "@tanstack/react-query";
import * as mcpApi from "../api/mcp";

/**
 * Hook to fetch the full dependency graph from the MCP Context Manager.
 *
 * @param scope - The scope of the graph: 'repo', 'file', or 'symbol'
 * @param options - Additional query options (filePath, symbolQualifiedName, maxNodes, maxEdges)
 */
export function useMcpGraph(
  scope: "repo" | "file" | "symbol",
  options?: {
    filePath?: string;
    symbolQualifiedName?: string;
    maxNodes?: number;
    maxEdges?: number;
  },
) {
  return useQuery({
    queryKey: ["mcp-graph", scope, options],
    queryFn: async () => {
      console.log("[useMcpGraph] Fetching graph data:", { scope, options });
      const data = await mcpApi.exportGraph({ scope, ...options });
      console.log("[useMcpGraph] Received graph data:", {
        nodeCount: data.nodes.length,
        edgeCount: data.edges.length,
        sampleNode: data.nodes[0],
        sampleEdge: data.edges[0],
      });
      return data;
    },
    staleTime: 30_000, // 30 seconds
    refetchInterval: 60_000, // Auto-refresh every minute
    retry: 2,
  });
}

/**
 * Hook to fetch the context graph for a specific function.
 *
 * @param functionName - The name of the function to analyze
 * @param filePath - Optional file path to disambiguate functions with the same name
 * @param maxHops - Maximum number of hops from the center node (default: 2)
 * @param maxNodes - Maximum number of nodes to return (default: 150)
 */
export function useFunctionContext(
  functionName: string,
  options?: {
    filePath?: string;
    maxHops?: number;
    maxNodes?: number;
  },
) {
  return useQuery({
    queryKey: ["mcp-function", functionName, options],
    queryFn: async () => {
      console.log("[useFunctionContext] Fetching function context:", { functionName, options });
      const data = await mcpApi.getFunctionContext({ functionName, ...options });
      console.log("[useFunctionContext] Received function context:", {
        nodeCount: data.nodes.length,
        edgeCount: data.edges.length,
        centerNode: data.centerNode,
      });
      return data;
    },
    enabled: !!functionName,
    staleTime: 30_000,
    retry: 2,
  });
}

/**
 * Hook to fetch file dependents (incoming/outgoing dependencies).
 *
 * @param filePath - The path to the file to analyze
 * @param direction - 'incoming', 'outgoing', or 'both'
 * @param depth - How many levels deep to traverse (default: 1)
 * @param maxFiles - Maximum number of files to return (default: 200)
 */
export function useFileDependents(
  filePath: string,
  options?: {
    direction?: "incoming" | "outgoing" | "both";
    depth?: number;
    maxFiles?: number;
  },
) {
  return useQuery({
    queryKey: ["mcp-file-dependents", filePath, options],
    queryFn: () => mcpApi.getFileDependents({ filePath, ...options }),
    enabled: !!filePath,
    staleTime: 30_000,
    retry: 2,
  });
}

/**
 * Hook to fetch all references to a specific symbol across the codebase.
 *
 * @param symbolName - The name of the symbol to search for
 * @param options - Filter options (includeReads, includeWrites, includeCalls, maxResults)
 */
export function useSymbolReferences(
  symbolName: string,
  options?: {
    includeReads?: boolean;
    includeWrites?: boolean;
    includeCalls?: boolean;
    maxResults?: number;
  },
) {
  return useQuery({
    queryKey: ["mcp-symbol-references", symbolName, options],
    queryFn: () => mcpApi.getSymbolReferences({ symbolName, ...options }),
    enabled: !!symbolName,
    staleTime: 30_000,
    retry: 2,
  });
}

// ---------------------------------------------------------------------------
// Sprint 1 — Advanced Query Hooks
// ---------------------------------------------------------------------------

/**
 * Hook to fetch all callers of a specific function (reverse call graph).
 *
 * @param functionName - The name of the function to find callers for
 * @param options - Additional query options (filePath, maxDepth, maxResults)
 */
export function useCallers(
  functionName: string,
  options?: {
    filePath?: string;
    maxDepth?: number;
    maxResults?: number;
  },
) {
  return useQuery({
    queryKey: ["mcp-callers", functionName, options],
    queryFn: () => mcpApi.getCallers({ functionName, ...options }),
    enabled: !!functionName,
    staleTime: 30_000,
    retry: 2,
  });
}

/**
 * Hook to fetch the call chain (directed subgraph) for a specific function.
 *
 * @param functionName - The root function name
 * @param options - Additional query options (filePath, direction, maxDepth, maxNodes)
 */
export function useCallChain(
  functionName: string,
  options?: {
    filePath?: string;
    direction?: "upstream" | "downstream" | "both";
    maxDepth?: number;
    maxNodes?: number;
  },
) {
  return useQuery({
    queryKey: ["mcp-call-chain", functionName, options],
    queryFn: () => mcpApi.getCallChain({ functionName, ...options }),
    enabled: !!functionName,
    staleTime: 30_000,
    retry: 2,
  });
}

/**
 * Hook to fetch dead code (unreferenced symbols) in the codebase.
 *
 * @param options - Filter options (filePattern, language, kind, maxResults)
 */
export function useDeadCode(
  options?: {
    filePattern?: string;
    language?: string;
    kind?: string;
    maxResults?: number;
  },
) {
  return useQuery({
    queryKey: ["mcp-dead-code", options],
    queryFn: () => mcpApi.getDeadCode(options),
    staleTime: 30_000,
    retry: 2,
  });
}

/**
 * Hook to fetch impact analysis for a specific file.
 *
 * @param filePath - The source file path to analyze
 * @param options - Additional query options (maxDepth, maxFiles)
 */
export function useImpactAnalysis(
  filePath: string,
  options?: {
    maxDepth?: number;
    maxFiles?: number;
  },
) {
  return useQuery({
    queryKey: ["mcp-impact", filePath, options],
    queryFn: () => mcpApi.getImpactAnalysis({ filePath, ...options }),
    enabled: !!filePath,
    staleTime: 30_000,
    retry: 2,
  });
}

// ---------------------------------------------------------------------------
// Sprint 2 — Advanced Query Hooks
// ---------------------------------------------------------------------------

/**
 * Hook to fetch coupling metrics between two files.
 *
 * @param filePathA - First file path
 * @param filePathB - Second file path
 * @param options - Additional query options (maxDepth)
 */
export function useModuleCoupling(
  filePathA: string,
  filePathB: string,
  options?: {
    maxDepth?: number;
  },
) {
  return useQuery({
    queryKey: ["mcp-coupling", filePathA, filePathB, options],
    queryFn: () => mcpApi.getModuleCoupling({ filePathA, filePathB, ...options }),
    enabled: !!filePathA && !!filePathB,
    staleTime: 30_000,
    retry: 2,
  });
}

/**
 * Hook to fetch the top-N most-referenced symbols (highest fan-in).
 *
 * @param options - Filter options (topN, kind, language, filePattern)
 */
export function useHotspots(
  options?: {
    topN?: number;
    kind?: string;
    language?: string;
    filePattern?: string;
  },
) {
  return useQuery({
    queryKey: ["mcp-hotspots", options],
    queryFn: () => mcpApi.getHotspots(options),
    staleTime: 30_000,
    retry: 2,
  });
}

/**
 * Hook to fetch the class inheritance hierarchy for a specific class.
 *
 * @param className - The name of the class to analyze
 * @param options - Additional query options (filePath, direction, maxDepth)
 */
export function useClassHierarchy(
  className: string,
  options?: {
    filePath?: string;
    direction?: "ancestors" | "descendants" | "both";
    maxDepth?: number;
  },
) {
  return useQuery({
    queryKey: ["mcp-class-hierarchy", className, options],
    queryFn: () => mcpApi.getClassHierarchy({ className, ...options }),
    enabled: !!className,
    staleTime: 30_000,
    retry: 2,
  });
}

/**
 * Hook to search for symbols across the codebase.
 *
 * @param query - Search query string
 * @param options - Filter options (kind, language, filePattern, useRegex, maxResults)
 */
export function useSearchSymbols(
  query: string,
  options?: {
    kind?: string;
    language?: string;
    filePattern?: string;
    useRegex?: boolean;
    maxResults?: number;
  },
) {
  return useQuery({
    queryKey: ["mcp-search", query, options],
    queryFn: () => mcpApi.searchSymbols({ query, ...options }),
    enabled: !!query,
    staleTime: 30_000,
    retry: 2,
  });
}
