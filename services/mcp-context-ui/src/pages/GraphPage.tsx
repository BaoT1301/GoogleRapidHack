/**
 * Graph page — live dependency graph visualization.
 *
 * Migrated from the original MCPPage. Preserves all existing functionality:
 * 2D React Flow graph (default), 3D Globe toggle, file tree, symbol search,
 * edge filter panel, and SSE real-time updates.
 */
import { useState, useMemo, useCallback } from "react";
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

export default function GraphPage() {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [enabledEdgeTypes, setEnabledEdgeTypes] = useState<Set<string>>(
    () => new Set(ALL_EDGE_TYPES)
  );

  const { data: graph, isLoading, error } = useMcpGraph("repo");
  const { data: clusterConfig } = useClusterConfig();
  const { indexingProgress } = useSSEEvents();

  const clusters = useMemo(() => {
    const graphClusterMeta = (graph as Record<string, unknown> | undefined)?.clusterMeta as
      | Array<{ id: string; path: string; label: string; color: string }>
      | undefined;
    if (graphClusterMeta && graphClusterMeta.length > 0) {
      return graphClusterMeta;
    }
    return clusterConfig?.clusters ?? [];
  }, [graph, clusterConfig]);

  const fileNodes = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.filter((node) => node.type === "file");
  }, [graph]);

  const symbolNodes = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.filter((node) =>
      ["function", "class", "variable", "module"].includes(node.type)
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
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-500 border-t-transparent mx-auto mb-4" />
          <p className="text-slate-600">Loading dependency graph...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <div className="text-danger-500 text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Failed to Load Graph</h2>
          <p className="text-slate-600 mb-4">
            {error instanceof Error ? error.message : "Unable to connect to MCP Context Manager"}
          </p>
          <p className="text-sm text-slate-500">
            Make sure the MCP service is running and the backend proxy is configured correctly.
          </p>
        </div>
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-slate-400 text-5xl mb-4">📊</div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">No Data Available</h2>
          <p className="text-slate-600">
            The dependency graph is empty. Make sure the MCP Context Manager has indexed your codebase.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Graph Header */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-6 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-600">
              Live dependency graph of your codebase &mdash; {graph.nodes.length} nodes, {graph.edges.length} edges
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-slate-300 overflow-hidden">
              <button
                onClick={() => setViewMode("2d")}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === "2d"
                    ? "bg-primary-600 text-white"
                    : "bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                2D
              </button>
              <button
                onClick={() => setViewMode("3d")}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === "3d"
                    ? "bg-primary-600 text-white"
                    : "bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                3D Globe
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-80 bg-white border-r border-slate-200 flex flex-col">
          <div className="p-4 border-b border-slate-200">
            <SymbolSearch
              symbols={symbolNodes}
              onSelect={handleSymbolSelect}
              placeholder="Search functions, classes..."
            />
          </div>

          {viewMode === "3d" && (
            <EdgeFilterPanel
              enabledTypes={enabledEdgeTypes}
              onToggle={handleEdgeTypeToggle}
            />
          )}

          <div className="flex-1 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200">
              <h3 className="text-sm font-medium text-slate-900">Files</h3>
            </div>
            <FileTree
              files={fileNodes}
              onFileClick={handleFileClick}
              selectedFilePath={selectedNode?.filePath}
              className="h-full"
            />
          </div>

          {selectedNode && (
            <div className="p-4 border-t border-slate-200 bg-slate-50">
              <h3 className="text-sm font-medium text-slate-900 mb-2">Selected</h3>
              <div className="text-xs space-y-1">
                <div>
                  <span className="font-medium">Type:</span>{" "}
                  <span className="text-slate-600">{selectedNode.type}</span>
                </div>
                <div>
                  <span className="font-medium">Label:</span>{" "}
                  <span className="text-slate-600">{selectedNode.label}</span>
                </div>
                {selectedNode.filePath && (
                  <div>
                    <span className="font-medium">File:</span>{" "}
                    <span className="text-slate-600 break-all">{selectedNode.filePath}</span>
                  </div>
                )}
                {selectedNode.qualifiedName && (
                  <div>
                    <span className="font-medium">Qualified Name:</span>{" "}
                    <span className="text-slate-600 break-all">{selectedNode.qualifiedName}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Visualization Area */}
        {viewMode === "2d" ? (
          <div className="flex-1 bg-slate-50">
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
    </div>
  );
}
