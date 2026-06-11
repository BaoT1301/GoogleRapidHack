/**
 * DependencyGraph Component
 *
 * Interactive graph visualization using React Flow to display code dependencies,
 * function calls, and module relationships from the MCP Context Manager.
 */

import { useCallback, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ConnectionLineType,
  Panel,
} from "reactflow";
import type { Node as FlowNode, Edge as FlowEdge } from "reactflow";
import "reactflow/dist/style.css";
import type { Graph, Node, Edge } from "../../types/mcp";

interface DependencyGraphProps {
  graph: Graph;
  onNodeClick?: (node: Node) => void;
  highlightedNodes?: Set<string>;
  className?: string;
}

// Map MCP node types to visual styles
function getNodeStyle(type: Node["type"]): {
  padding: string;
  borderRadius: string;
  fontSize: string;
  fontWeight: number;
  border: string;
  backgroundColor: string;
  borderColor: string;
  color: string;
} {
  const baseStyle = {
    padding: "10px 15px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 500,
    border: "2px solid",
  };

  switch (type) {
    case "file":
      return {
        ...baseStyle,
        backgroundColor: "#dbeafe",
        borderColor: "#3b82f6",
        color: "#1e40af",
      };
    case "function":
      return {
        ...baseStyle,
        backgroundColor: "#d1fae5",
        borderColor: "#10b981",
        color: "#065f46",
      };
    case "class":
      return {
        ...baseStyle,
        backgroundColor: "#e9d5ff",
        borderColor: "#8b5cf6",
        color: "#5b21b6",
      };
    case "variable":
      return {
        ...baseStyle,
        backgroundColor: "#fed7aa",
        borderColor: "#f59e0b",
        color: "#92400e",
      };
    case "module":
      return {
        ...baseStyle,
        backgroundColor: "#e0e7ff",
        borderColor: "#6366f1",
        color: "#3730a3",
      };
    default:
      return {
        ...baseStyle,
        backgroundColor: "#f3f4f6",
        borderColor: "#9ca3af",
        color: "#374151",
      };
  }
}

// Map MCP edge types to visual styles
function getEdgeStyle(type: Edge["type"]) {
  switch (type) {
    case "calls":
      return {
        stroke: "#22c55e",
        strokeWidth: 2,
        animated: true,
      };
    case "imports":
      return {
        stroke: "#94a3b8",
        strokeWidth: 1.5,
      };
    case "reads":
      return {
        stroke: "#60a5fa",
        strokeWidth: 1.5,
      };
    case "writes":
      return {
        stroke: "#f97316",
        strokeWidth: 2,
      };
    case "defines":
      return {
        stroke: "#8b5cf6",
        strokeWidth: 1.5,
      };
    case "instantiates":
      return {
        stroke: "#ec4899",
        strokeWidth: 2,
      };
    case "references":
      return {
        stroke: "#64748b",
        strokeWidth: 1,
      };
    case "exports":
      return {
        stroke: "#14b8a6",
        strokeWidth: 1.5,
      };
    default:
      return {
        stroke: "#94a3b8",
        strokeWidth: 1,
      };
  }
}

export function DependencyGraph({
  graph,
  onNodeClick,
  highlightedNodes,
  className = "",
}: DependencyGraphProps) {
  // Convert MCP graph nodes to React Flow nodes
  const initialNodes: FlowNode[] = useMemo(
    () =>
      graph.nodes.map((node, index) => ({
        id: node.id,
        type: "default",
        data: {
          label: node.label,
          mcpNode: node,
        },
        position: {
          // Simple grid layout as placeholder (React Flow will auto-layout)
          x: (index % 10) * 200,
          y: Math.floor(index / 10) * 100,
        },
        style: {
          ...getNodeStyle(node.type),
          ...(highlightedNodes?.has(node.id)
            ? {
                boxShadow: "0 0 0 3px #fbbf24",
                borderColor: "#f59e0b",
              }
            : {}),
        },
      })),
    [graph.nodes, highlightedNodes],
  );

  // Convert MCP graph edges to React Flow edges
  const initialEdges: FlowEdge[] = useMemo(
    () =>
      graph.edges.map((edge) => ({
        id: `${edge.source}-${edge.target}-${edge.type}`,
        source: edge.source,
        target: edge.target,
        label: edge.type,
        type: ConnectionLineType.SmoothStep,
        style: getEdgeStyle(edge.type),
        labelStyle: {
          fontSize: "10px",
          fill: "#64748b",
        },
        labelBgStyle: {
          fill: "#ffffff",
          fillOpacity: 0.8,
        },
      })),
    [graph.edges],
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, flowNode: FlowNode) => {
      const mcpNode = flowNode.data.mcpNode as Node;
      onNodeClick?.(mcpNode);
    },
    [onNodeClick],
  );

  return (
    <div className={`h-full w-full ${className}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        fitView
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: ConnectionLineType.SmoothStep,
        }}
      >
        <Background color="#e2e8f0" gap={16} />
        <Controls />
        <MiniMap
          nodeColor={(node: FlowNode) => {
            const mcpNode = node.data.mcpNode as Node;
            return getNodeStyle(mcpNode.type).borderColor;
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
        />
        <Panel position="top-left" className="bg-white p-3 rounded-lg shadow-md">
          <div className="text-sm font-medium text-gray-900 mb-2">
            Graph Stats
          </div>
          <div className="text-xs text-gray-600 space-y-1">
            <div>Nodes: {graph.nodes.length}</div>
            <div>Edges: {graph.edges.length}</div>
          </div>
        </Panel>
        <Panel position="top-right" className="bg-white p-3 rounded-lg shadow-md">
          <div className="text-sm font-medium text-gray-900 mb-2">Legend</div>
          <div className="text-xs space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: "#3b82f6" }} />
              <span>File</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: "#10b981" }} />
              <span>Function</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: "#8b5cf6" }} />
              <span>Class</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: "#f59e0b" }} />
              <span>Variable</span>
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
