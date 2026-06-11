/**
 * Full-text search hook using Fuse.js.
 *
 * Builds a searchable index from documentation content including
 * endpoint names, descriptions, and page titles.
 */
import { useMemo } from "react";
import Fuse from "fuse.js";

export interface SearchResult {
  title: string;
  description?: string;
  category: string;
  path: string;
}

/** Static searchable content for the documentation portal. */
const SEARCH_INDEX: SearchResult[] = [
  // Overview
  { title: "What is MCP?", description: "Model Context Protocol overview", category: "Overview", path: "/" },
  { title: "Architecture", description: "System architecture diagram", category: "Overview", path: "/" },
  { title: "Quick Start", description: "Get started with MCP Context Manager", category: "Overview", path: "/" },

  // Setup
  { title: "Docker Setup", description: "Docker Compose configuration wizard", category: "Setup", path: "/setup" },
  { title: "Prerequisites", description: "Docker, Docker Compose requirements", category: "Setup", path: "/setup" },
  { title: "Environment Variables", description: "Configure WORKSPACE_ROOT, HTTP_PORT, LOG_LEVEL", category: "Setup", path: "/setup" },
  { title: "Port Mapping", description: "Configure service ports", category: "Setup", path: "/setup" },
  { title: "Volume Mapping", description: "Mount source directories", category: "Setup", path: "/setup" },
  { title: "Health Check", description: "Verify service is running", category: "Setup", path: "/setup" },

  // API Reference
  { title: "GET /api/v1/mcp/graph/export", description: "Export full dependency graph", category: "API", path: "/api" },
  { title: "GET /api/v1/mcp/function-context", description: "Get function context and dependencies", category: "API", path: "/api" },
  { title: "GET /api/v1/mcp/file-dependents", description: "Find files that depend on a given file", category: "API", path: "/api" },
  { title: "GET /api/v1/mcp/symbol-references", description: "Find all references to a symbol", category: "API", path: "/api" },
  { title: "GET /api/v1/mcp/callers", description: "Find all callers of a function", category: "API", path: "/api" },
  { title: "GET /api/v1/mcp/call-chain", description: "Trace call chain between functions", category: "API", path: "/api" },
  { title: "GET /api/v1/mcp/dead-code", description: "Detect unused code", category: "API", path: "/api" },
  { title: "GET /api/v1/mcp/hotspots", description: "Find frequently changed files", category: "API", path: "/api" },
  { title: "GET /api/v1/mcp/impact-analysis", description: "Analyze change impact", category: "API", path: "/api" },
  { title: "GET /api/v1/mcp/module-coupling", description: "Measure module coupling", category: "API", path: "/api" },
  { title: "GET /api/v1/mcp/class-hierarchy", description: "View class inheritance tree", category: "API", path: "/api" },
  { title: "GET /api/v1/mcp/search", description: "Search codebase symbols", category: "API", path: "/api" },
  { title: "GET /api/v1/mcp/circular-dependencies", description: "Detect circular imports", category: "API", path: "/api" },
  { title: "GET /api/v1/mcp/complexity-metrics", description: "Code complexity analysis", category: "API", path: "/api" },
  { title: "GET /api/v1/mcp/change-risk", description: "Assess change risk score", category: "API", path: "/api" },
  { title: "GET /api/v1/health", description: "Service health check endpoint", category: "API", path: "/api" },
  { title: "SSE /api/v1/mcp/events", description: "Server-sent events for real-time updates", category: "API", path: "/api" },

  // AI Agents
  { title: "Claude Desktop", description: "Configure MCP for Claude Desktop", category: "Agents", path: "/agents" },
  { title: "Cursor", description: "Configure MCP for Cursor IDE", category: "Agents", path: "/agents" },
  { title: "Kiro", description: "Configure MCP for Kiro IDE", category: "Agents", path: "/agents" },
  { title: "MCP Tools", description: "Available MCP tools for AI agents", category: "Agents", path: "/agents" },

  // Graph
  { title: "Dependency Graph", description: "2D interactive dependency visualization", category: "Graph", path: "/graph" },
  { title: "3D Globe", description: "3D globe visualization of codebase", category: "Graph", path: "/graph" },
];

const fuse = new Fuse(SEARCH_INDEX, {
  keys: [
    { name: "title", weight: 0.6 },
    { name: "description", weight: 0.3 },
    { name: "category", weight: 0.1 },
  ],
  threshold: 0.4,
  includeScore: true,
});

/**
 * Search documentation content using fuzzy matching.
 * Returns up to 8 results sorted by relevance.
 */
export function useSearch(query: string): SearchResult[] {
  return useMemo(() => {
    if (!query || query.length < 2) return [];
    const results = fuse.search(query, { limit: 8 });
    return results.map((r) => r.item);
  }, [query]);
}
