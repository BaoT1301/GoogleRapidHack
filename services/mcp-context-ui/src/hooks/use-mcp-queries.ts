/**
 * React Query Hooks for Sprint 3 MCP Query Tools
 *
 * Hooks for circular dependencies, complexity metrics, and change risk analysis.
 * Follows the same patterns as use-mcp-graph.ts: staleTime 30s, retry 2.
 */

import { useQuery } from "@tanstack/react-query";
import * as mcpApi from "../api/mcp";

/**
 * Hook to fetch circular dependencies (import cycles) in the codebase.
 *
 * @param params - Filter options (filePattern, language, maxCycles, maxDepth)
 */
export function useCircularDeps(
  params?: {
    filePattern?: string;
    language?: "python" | "typescript";
    maxCycles?: number;
    maxDepth?: number;
  },
) {
  return useQuery({
    queryKey: ["mcp-circular-deps", params],
    queryFn: () => mcpApi.getCircularDeps(params),
    staleTime: 30_000,
    retry: 2,
  });
}

/**
 * Hook to fetch complexity metrics (fan-in, fan-out, depth) for symbols.
 *
 * @param params - Filter options (filePath, kind, language, sortBy, maxResults)
 */
export function useComplexityMetrics(
  params?: {
    filePath?: string;
    kind?: "function" | "class" | "file";
    language?: "python" | "typescript";
    sortBy?: "fan_in" | "fan_out" | "depth" | "total";
    maxResults?: number;
  },
) {
  return useQuery({
    queryKey: ["mcp-complexity-metrics", params],
    queryFn: () => mcpApi.getComplexityMetrics(params),
    staleTime: 30_000,
    retry: 2,
  });
}

/**
 * Hook to fetch change risk analysis for a set of changed files.
 * Only enabled when changedFiles has at least one entry.
 *
 * @param params - Required: changedFiles array. Optional: maxDepth, maxFiles.
 */
export function useChangeRisk(
  params: {
    changedFiles: string[];
    maxDepth?: number;
    maxFiles?: number;
  },
) {
  return useQuery({
    queryKey: ["mcp-change-risk", params],
    queryFn: () => mcpApi.getChangeRisk(params),
    enabled: params.changedFiles.length > 0,
    staleTime: 30_000,
    retry: 2,
  });
}
