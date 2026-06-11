/**
 * Globe3DPhase1 Component
 *
 * Phase 1 proof-of-concept globe visualization using react-globe.gl.
 * Renders code files as points on a 3D globe with dependency arcs.
 * Integrates LOD system for performance and edge type filtering.
 */

import { useMemo, useState, useCallback, useRef } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { useLOD } from "../../hooks/use-lod";
import { ARC_STYLES, type GlobeNode, type FunctionLabel } from "../../types/globe";
import type { Graph, Node, Edge } from "../../types/mcp";
import type { Cluster } from "../../types/globe";

// ---------------------------------------------------------------------------
// Internal arc data shape for react-globe.gl
// ---------------------------------------------------------------------------
interface GlobeArcData {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
  dashLength: number;
  dashGap: number;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface Globe3DPhase1Props {
  graph: Graph;
  clusters: Cluster[];
  selectedClusterId: string;
  enabledEdgeTypes: Set<string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Access lat/lng/clusterId from a node that passed through .passthrough() */
function getNodeLat(node: Node): number | undefined {
  return (node as Record<string, unknown>)["lat"] as number | undefined;
}

function getNodeLng(node: Node): number | undefined {
  return (node as Record<string, unknown>)["lng"] as number | undefined;
}

function getNodeClusterId(node: Node): string | undefined {
  return (node as Record<string, unknown>)["clusterId"] as string | undefined;
}

/** Extract function/class labels from a node's metadata or related graph nodes */
function extractFunctions(node: Node, allNodes: Node[], edges: Edge[]): FunctionLabel[] {
  // Find child symbols (functions/classes) defined in this file
  const childIds = new Set(
    edges
      .filter((e) => e.source === node.id && e.type === "defines")
      .map((e) => e.target),
  );

  return allNodes
    .filter((n) => childIds.has(n.id) && (n.type === "function" || n.type === "class"))
    .map((n) => ({
      name: n.label,
      signature: n.qualifiedName ?? n.label,
      type: n.type as "function" | "class",
    }));
}

// ---------------------------------------------------------------------------
// Default globe radius used by react-globe.gl
// ---------------------------------------------------------------------------
const DEFAULT_GLOBE_RADIUS = 100;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function Globe3DPhase1({
  graph,
  clusters,
  selectedClusterId,
  enabledEdgeTypes,
}: Globe3DPhase1Props) {
  const globeRef = useRef<GlobeMethods>(undefined);
  const [cameraDistance, setCameraDistance] = useState(DEFAULT_GLOBE_RADIUS * 3.5);
  // NOTE: The performance warning threshold for "Show All Details" is defined in
  // ../../constants/globe.ts as PERFORMANCE_WARNING_NODE_THRESHOLD (2000 nodes).
  // A future enhancement should guard this toggle with shouldShowPerformanceWarning().
  const [forceShowAll, setForceShowAll] = useState(false);

  const lodState = useLOD(cameraDistance, DEFAULT_GLOBE_RADIUS);
  const effectiveLOD = forceShowAll
    ? { level: "close" as const, showFunctionLabels: true, showDirectedArcs: true, showFunctionBadges: true }
    : lodState;

  // ── Filter nodes by selected cluster ────────────────────────────────
  const filteredNodes = useMemo(() => {
    return graph.nodes.filter((node) => {
      const clusterId = getNodeClusterId(node);
      const lat = getNodeLat(node);
      const lng = getNodeLng(node);
      // Only include nodes that belong to the selected cluster and have coordinates
      return clusterId === selectedClusterId && lat !== undefined && lng !== undefined;
    });
  }, [graph.nodes, selectedClusterId]);

  // ── Build a set of filtered node IDs for fast lookup ────────────────
  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map((n) => n.id)),
    [filteredNodes],
  );

  // ── Transform to GlobeNode[] ────────────────────────────────────────
  const globeNodes: GlobeNode[] = useMemo(() => {
    return filteredNodes.map((node) => {
      const cluster = clusters.find((c) => c.id === selectedClusterId);
      return {
        id: node.id,
        label: node.label,
        lat: getNodeLat(node) ?? 0,
        lng: getNodeLng(node) ?? 0,
        altitude: 0.01,
        color: cluster?.color ?? "#4A90E2",
        clusterId: selectedClusterId,
        functions: extractFunctions(node, graph.nodes, graph.edges),
      };
    });
  }, [filteredNodes, clusters, selectedClusterId, graph.nodes, graph.edges]);

  // ── Build a lookup map for globe nodes by ID ────────────────────────
  const nodeMap = useMemo(() => {
    const map = new Map<string, GlobeNode>();
    for (const gn of globeNodes) {
      map.set(gn.id, gn);
    }
    return map;
  }, [globeNodes]);

  // ── Transform edges to arcs ─────────────────────────────────────────
  const globeArcs: GlobeArcData[] = useMemo(() => {
    if (!effectiveLOD.showDirectedArcs) return [];

    return graph.edges
      .filter((edge) => {
        if (!enabledEdgeTypes.has(edge.type)) return false;
        if (!filteredNodeIds.has(edge.source)) return false;
        if (!filteredNodeIds.has(edge.target)) return false;
        return true;
      })
      .map((edge) => {
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        if (!sourceNode || !targetNode) return null;

        const style = ARC_STYLES[edge.type];
        return {
          id: `${edge.source}-${edge.target}-${edge.type}`,
          startLat: sourceNode.lat,
          startLng: sourceNode.lng,
          endLat: targetNode.lat,
          endLng: targetNode.lng,
          color: style.color,
          dashLength: style.dashLength,
          dashGap: style.dashGap,
        };
      })
      .filter((arc): arc is GlobeArcData => arc !== null);
  }, [graph.edges, enabledEdgeTypes, filteredNodeIds, nodeMap, effectiveLOD.showDirectedArcs]);

  // ── Camera zoom handler ─────────────────────────────────────────────
  const handleZoom = useCallback((pov: { altitude: number }) => {
    // react-globe.gl altitude is in globe-radius units
    const distance = pov.altitude * DEFAULT_GLOBE_RADIUS;
    setCameraDistance(distance);
  }, []);

  // ── Point label builder ─────────────────────────────────────────────
  const pointLabel = useCallback(
    (obj: object) => {
      const node = obj as GlobeNode;
      const fnCount = node.functions.length;
      if (effectiveLOD.showFunctionBadges) {
        return `<div style="padding:4px 8px;background:rgba(0,0,0,0.8);border-radius:4px;color:#fff;font-size:12px">
          <strong>${node.label}</strong><br/>${fnCount} function${fnCount !== 1 ? "s" : ""}
        </div>`;
      }
      return `<div style="padding:4px 8px;background:rgba(0,0,0,0.8);border-radius:4px;color:#fff;font-size:12px">
        <strong>${node.label}</strong>
      </div>`;
    },
    [effectiveLOD.showFunctionBadges],
  );

  // ── Point color accessor ────────────────────────────────────────────
  const pointColor = useCallback((obj: object) => {
    return (obj as GlobeNode).color;
  }, []);

  // ── Arc color accessor ──────────────────────────────────────────────
  const arcColor = useCallback((obj: object) => {
    return (obj as GlobeArcData).color;
  }, []);

  const arcDashLength = useCallback((obj: object) => {
    return (obj as GlobeArcData).dashLength;
  }, []);

  const arcDashGap = useCallback((obj: object) => {
    return (obj as GlobeArcData).dashGap;
  }, []);

  return (
    <div className="relative w-full h-full">
      {/* Show All Details toggle */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => setForceShowAll((prev) => !prev)}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg shadow transition-colors ${
            forceShowAll
              ? "bg-blue-600 text-white"
              : "bg-white/10 text-gray-300 hover:bg-white/20"
          }`}
        >
          {forceShowAll ? "Auto LOD" : "Show All Details"}
        </button>
      </div>

      {/* LOD indicator */}
      <div className="absolute top-4 left-4 z-10 px-3 py-1.5 bg-black/60 rounded-lg text-xs text-gray-300">
        LOD: <span className="font-medium text-white capitalize">{effectiveLOD.level}</span>
      </div>

      <Globe
        ref={globeRef}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        backgroundColor="#000011"
        // Points layer
        pointsData={globeNodes}
        pointLat="lat"
        pointLng="lng"
        pointColor={pointColor}
        pointAltitude={0.01}
        pointRadius={0.5}
        pointLabel={pointLabel}
        // Arcs layer
        arcsData={globeArcs}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor={arcColor}
        arcDashLength={arcDashLength}
        arcDashGap={arcDashGap}
        arcDashAnimateTime={2000}
        arcStroke={0.5}
        // Camera
        onZoom={handleZoom}
      />
    </div>
  );
}
