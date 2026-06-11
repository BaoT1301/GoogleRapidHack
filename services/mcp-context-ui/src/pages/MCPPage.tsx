/**
 * MCP Code Explorer Page
 *
 * Main interface for visualizing code dependencies and exploring the codebase
 * structure using the MCP Context Manager.
 *
 * Supports two view modes:
 *   - 2D: Original React Flow dependency graph (unchanged)
 *   - 3D: Globe visualization using react-globe.gl
 */

import { useState, useMemo, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useMcpGraph } from "../hooks/use-mcp-graph";
import { useClusterConfig } from "../hooks/use-cluster-config";
import { useSSEEvents } from "../hooks/use-sse-events";
import { DependencyGraph } from "../components/mcp/DependencyGraph";
import { SymbolSearch } from "../components/mcp/SymbolSearch";
import { FileTree } from "../components/mcp/FileTree";
import { Globe3DPhase2 } from "../components/mcp/Globe3DPhase2";
import { EdgeFilterPanel } from "../components/mcp/EdgeFilterPanel";
import { GlobeLoadingScreen } from "../components/mcp/GlobeLoadingScreen";
import type { Node } from "../types/mcp";

type ViewMode = "2d" | "3d";

const ALL_EDGE_TYPES = new Set([
  "imports",
  "calls",
  "defines",
  "reads",
  "writes",
  "references",
  "instantiates",
  "exports",
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function MCPPageContent() {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(
    new Set(),
  );
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [enabledEdgeTypes, setEnabledEdgeTypes] = useState<Set<string>>(
    () => new Set(ALL_EDGE_TYPES),
  );

  // Fetch the full repository graph (no client-side limits — LOD handles performance)
  const { data: graph, isLoading, error } = useMcpGraph("repo");

  // Fetch cluster configuration (used in 3D mode)
  const { data: clusterConfig } = useClusterConfig();

  // SSE events for real-time updates (active in 3D mode)
  const { indexingProgress } = useSSEEvents();

  // Use clusterMeta from graph response if available, fall back to separate API call
  const clusters = useMemo(() => {
    const graphClusterMeta = (graph as Record<string, unknown> | undefined)?.clusterMeta as
      | Array<{ id: string; path: string; label: string; color: string }>
      | undefined;
    if (graphClusterMeta && graphClusterMeta.length > 0) {
      return graphClusterMeta;
    }
    return clusterConfig?.clusters ?? [];
  }, [graph, clusterConfig]);

  // Extract file nodes for the file tree
  const fileNodes = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.filter((node) => node.type === "file");
  }, [graph]);

  // Extract all symbol nodes for search
  const symbolNodes = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.filter((node) =>
      ["function", "class", "variable", "module"].includes(node.type),
    );
  }, [graph]);

  const handleNodeClick = (node: Node) => {
    setSelectedNode(node);
    setHighlightedNodes(new Set([node.id]));
  };

  const handleSymbolSelect = (symbol: Node) => {
    setSelectedNode(symbol);
    setHighlightedNodes(new Set([symbol.id]));
  };

  const handleFileClick = (file: Node) => {
    setSelectedNode(file);
    setHighlightedNodes(new Set([file.id]));
  };

  const handleEdgeTypeToggle = useCallback((type: string) => {
    setEnabledEdgeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent mx-auto mb-4" />
          <p className="text-gray-600">Loading dependency graph...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Failed to Load Graph
          </h2>
          <p className="text-gray-600 mb-4">
            {error instanceof Error
              ? error.message
              : "Unable to connect to MCP Context Manager"}
          </p>
          <p className="text-sm text-gray-500">
            Make sure the MCP service is running and the backend proxy is
            configured correctly.
          </p>
        </div>
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-gray-400 text-5xl mb-4">📊</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            No Data Available
          </h2>
          <p className="text-gray-600">
            The dependency graph is empty. Make sure the MCP Context Manager has
            indexed your codebase.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              Code Dependency Explorer
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Visualize and explore code relationships across your codebase
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* 2D / 3D toggle */}
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              <button
                onClick={() => setViewMode("2d")}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === "2d"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                2D
              </button>
              <button
                onClick={() => setViewMode("3d")}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === "3d"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                3D
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
          {/* Search */}
          <div className="p-4 border-b border-gray-200">
            <SymbolSearch
              symbols={symbolNodes}
              onSelect={handleSymbolSelect}
              placeholder="Search functions, classes..."
            />
          </div>

          {/* Edge filter panel (3D mode only) */}
          {viewMode === "3d" && (
            <EdgeFilterPanel
              enabledTypes={enabledEdgeTypes}
              onToggle={handleEdgeTypeToggle}
            />
          )}

          {/* File Tree */}
          <div className="flex-1 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-medium text-gray-900">Files</h3>
            </div>
            <FileTree
              files={fileNodes}
              onFileClick={handleFileClick}
              selectedFilePath={selectedNode?.filePath}
              className="h-full"
            />
          </div>

          {/* Selected Node Info */}
          {selectedNode && (
            <div className="p-4 border-t border-gray-200 bg-gray-50">
              <h3 className="text-sm font-medium text-gray-900 mb-2">
                Selected
              </h3>
              <div className="text-xs space-y-1">
                <div>
                  <span className="font-medium">Type:</span>{" "}
                  <span className="text-gray-600">{selectedNode.type}</span>
                </div>
                <div>
                  <span className="font-medium">Label:</span>{" "}
                  <span className="text-gray-600">{selectedNode.label}</span>
                </div>
                {selectedNode.filePath && (
                  <div>
                    <span className="font-medium">File:</span>{" "}
                    <span className="text-gray-600 break-all">
                      {selectedNode.filePath}
                    </span>
                  </div>
                )}
                {selectedNode.qualifiedName && (
                  <div>
                    <span className="font-medium">Qualified Name:</span>{" "}
                    <span className="text-gray-600 break-all">
                      {selectedNode.qualifiedName}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Visualization Area */}
        {viewMode === "2d" ? (
          <div className="flex-1 bg-gray-50">
            <DependencyGraph
              graph={graph}
              onNodeClick={handleNodeClick}
              highlightedNodes={highlightedNodes}
            />
          </div>
        ) : (
          <div className="flex-1 relative bg-[#000011]">
            <GlobeLoadingScreen
              isLoading={clusters.length === 0}
              current={indexingProgress?.current}
              total={indexingProgress?.total}
            />
            {clusters.length > 0 && (
              <Globe3DPhase2
                graph={graph}
                clusters={clusters}
                enabledEdgeTypes={enabledEdgeTypes}
              />
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-white border-t border-gray-200 px-6 py-3">
        <div className="flex items-center justify-between text-sm text-gray-600">
          <div>
            {graph.nodes.length} nodes, {graph.edges.length} edges
          </div>
          <div>Last updated: just now</div>
        </div>
      </div>
    </div>
  );
}

export default function MCPPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster position="bottom-right" />
      <MCPPageContent />
    </QueryClientProvider>
  );
}
