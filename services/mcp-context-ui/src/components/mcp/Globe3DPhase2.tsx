/**
 * Globe3DPhase2 Component
 *
 * Multi-globe solar system using @react-three/fiber and @react-three/drei.
 * Each cluster becomes its own sphere in a shared 3D scene with cross-globe
 * arcs, drag-and-drop positioning, collision detection, and localStorage
 * persistence.
 */

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import * as THREE from "three";
import { ClusterGlobe } from "./ClusterGlobe";
import { useMultiGlobeLOD } from "../../hooks/use-multi-globe-lod";
import {
  GLOBE_RADIUS,
  STORAGE_KEY,
  detectCollision,
  latLngToWorld,
  savePositions,
  loadPersistedPositions,
  computeDefaultPositions,
} from "./globe-physics-utils";
import { computeBezierArcPoints } from "./globe-arc-utils";
import type { Graph, Node, Edge } from "../../types/mcp";
import type { Cluster, GlobeNode, FunctionLabel } from "../../types/globe";
import type { GlobePosition } from "../../types/globe-r3f";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BACKGROUND_COLOR = "#000011";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface Globe3DPhase2Props {
  graph: Graph;
  clusters: Cluster[];
  enabledEdgeTypes: Set<string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNodeLat(node: Node): number | undefined {
  return (node as Record<string, unknown>)["lat"] as number | undefined;
}

function getNodeLng(node: Node): number | undefined {
  return (node as Record<string, unknown>)["lng"] as number | undefined;
}

function getNodeClusterId(node: Node): string | undefined {
  return (node as Record<string, unknown>)["clusterId"] as string | undefined;
}

function extractFunctions(node: Node, allNodes: Node[], edges: Edge[]): FunctionLabel[] {
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
// Inner scene component (needs R3F context)
// ---------------------------------------------------------------------------
interface SceneProps {
  graph: Graph;
  clusters: Cluster[];
  enabledEdgeTypes: Set<string>;
  positions: GlobePosition[];
  onPositionsChange: (positions: GlobePosition[]) => void;
  highlightedNodeIds: Set<string>;
  onHighlightChange: (ids: Set<string>) => void;
}

function Scene({
  graph,
  clusters,
  enabledEdgeTypes,
  positions,
  onPositionsChange,
  highlightedNodeIds,
  onHighlightChange,
}: SceneProps) {
  const { camera } = useThree();
  const [cameraPos, setCameraPos] = useState<[number, number, number]>([0, 0, 15]);
  const frameCount = useRef(0);

  // Throttled camera position tracking (every 5 frames)
  useFrame(() => {
    frameCount.current += 1;
    if (frameCount.current % 5 === 0) {
      setCameraPos([camera.position.x, camera.position.y, camera.position.z]);
    }
  });

  // ── Per-globe LOD ───────────────────────────────────────────────────
  const globePositionTuples = useMemo(
    () => positions.map((p) => [p.x, p.y, p.z] as [number, number, number]),
    [positions],
  );

  const lodStates = useMultiGlobeLOD(globePositionTuples, cameraPos, GLOBE_RADIUS);

  // ── Build per-cluster node maps ─────────────────────────────────────
  const clusterNodeMap = useMemo(() => {
    const map = new Map<string, GlobeNode[]>();
    for (const cluster of clusters) {
      map.set(cluster.id, []);
    }
    for (const node of graph.nodes) {
      const clusterId = getNodeClusterId(node);
      const lat = getNodeLat(node);
      const lng = getNodeLng(node);
      if (!clusterId || lat === undefined || lng === undefined) continue;

      const existing = map.get(clusterId);
      if (!existing) continue;

      existing.push({
        id: node.id,
        label: node.label,
        lat,
        lng,
        altitude: 0.01,
        color: clusters.find((c) => c.id === clusterId)?.color ?? "#4A90E2",
        clusterId,
        functions: extractFunctions(node, graph.nodes, graph.edges),
      });
    }
    return map;
  }, [graph.nodes, graph.edges, clusters]);

  // ── Build per-cluster intra-cluster edges ───────────────────────────
  const clusterEdgeMap = useMemo(() => {
    const map = new Map<string, Edge[]>();
    for (const cluster of clusters) {
      map.set(cluster.id, []);
    }

    // Build nodeId → clusterId lookup
    const nodeClusterLookup = new Map<string, string>();
    for (const node of graph.nodes) {
      const cid = getNodeClusterId(node);
      if (cid) nodeClusterLookup.set(node.id, cid);
    }

    for (const edge of graph.edges) {
      // Use server-side isCrossCluster flag if available
      if (edge.isCrossCluster === true) continue;
      if (edge.isCrossCluster === undefined) {
        // Fallback: client-side comparison
        const srcCluster = nodeClusterLookup.get(edge.source);
        const tgtCluster = nodeClusterLookup.get(edge.target);
        if (srcCluster !== tgtCluster) continue;
      }

      const srcCluster = nodeClusterLookup.get(edge.source);
      if (srcCluster) {
        map.get(srcCluster)?.push(edge);
      }
    }
    return map;
  }, [graph.nodes, graph.edges, clusters]);

  // ── Build cross-globe arcs ──────────────────────────────────────────
  const crossGlobeArcs = useMemo(() => {
    const nodeClusterLookup = new Map<string, string>();
    for (const node of graph.nodes) {
      const cid = getNodeClusterId(node);
      if (cid) nodeClusterLookup.set(node.id, cid);
    }

    // Build a flat lookup of all globe nodes by ID
    const allGlobeNodes = new Map<string, GlobeNode>();
    for (const [, nodes] of clusterNodeMap) {
      for (const node of nodes) {
        allGlobeNodes.set(node.id, node);
      }
    }

    const positionLookup = new Map<string, [number, number, number]>();
    for (const pos of positions) {
      positionLookup.set(pos.clusterId, [pos.x, pos.y, pos.z]);
    }

    const arcs: Array<{
      id: string;
      points: [number, number, number][];
      sourceNodeId: string;
      targetNodeId: string;
    }> = [];

    for (const edge of graph.edges) {
      if (!enabledEdgeTypes.has(edge.type)) continue;

      let isCross = false;
      if (edge.isCrossCluster !== undefined) {
        isCross = edge.isCrossCluster;
      } else {
        const srcCluster = nodeClusterLookup.get(edge.source);
        const tgtCluster = nodeClusterLookup.get(edge.target);
        isCross = Boolean(srcCluster && tgtCluster && srcCluster !== tgtCluster);
      }
      if (!isCross) continue;

      const srcNode = allGlobeNodes.get(edge.source);
      const tgtNode = allGlobeNodes.get(edge.target);
      if (!srcNode || !tgtNode) continue;

      const srcCenter = positionLookup.get(srcNode.clusterId);
      const tgtCenter = positionLookup.get(tgtNode.clusterId);
      if (!srcCenter || !tgtCenter) continue;

      const srcWorld = latLngToWorld(srcNode.lat, srcNode.lng, GLOBE_RADIUS, srcCenter);
      const tgtWorld = latLngToWorld(tgtNode.lat, tgtNode.lng, GLOBE_RADIUS, tgtCenter);

      arcs.push({
        id: `cross-${edge.source}-${edge.target}-${edge.type}`,
        points: computeBezierArcPoints(srcWorld, tgtWorld),
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
      });
    }
    return arcs;
  }, [graph.nodes, graph.edges, enabledEdgeTypes, clusterNodeMap, positions]);

  // ── Drag state ──────────────────────────────────────────────────────
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [preDragPositions, setPreDragPositions] = useState<GlobePosition[] | null>(null);

  const handleGlobePointerDown = useCallback(
    (index: number, e: THREE.Event & { stopPropagation: () => void; point: THREE.Vector3 }) => {
      e.stopPropagation();
      setDragIndex(index);
      setDragStart({ x: e.point.x, y: e.point.z });
      setPreDragPositions([...positions]);
    },
    [positions],
  );

  const handlePointerMove = useCallback(
    (e: { point: THREE.Vector3 }) => {
      if (dragIndex === null || !dragStart || !preDragPositions) return;

      const dx = e.point.x - dragStart.x;
      const dz = e.point.z - dragStart.y;

      const newPositions = preDragPositions.map((p, i) => {
        if (i !== dragIndex) return p;
        return { ...p, x: p.x + dx, z: p.z + dz };
      });
      onPositionsChange(newPositions);
    },
    [dragIndex, dragStart, preDragPositions, onPositionsChange],
  );

  const handlePointerUp = useCallback(() => {
    if (dragIndex === null || !preDragPositions) {
      setDragIndex(null);
      setDragStart(null);
      setPreDragPositions(null);
      return;
    }

    // Collision detection: check distance between all globe pairs
    const current = positions;
    const hasCollision = detectCollision(current, GLOBE_RADIUS);

    if (hasCollision) {
      // Snap back to pre-drag positions
      onPositionsChange(preDragPositions);
    } else {
      // Save new positions
      savePositions(current);
    }

    setDragIndex(null);
    setDragStart(null);
    setPreDragPositions(null);
  }, [dragIndex, preDragPositions, positions, onPositionsChange]);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} />

      <OrbitControls
        minDistance={3}
        maxDistance={50}
        enablePan
        enabled={dragIndex === null}
      />

      {/* Invisible drag plane */}
      <mesh
        visible={false}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onPointerMove={dragIndex !== null ? handlePointerMove : undefined}
        onPointerUp={handlePointerUp}
      >
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Cluster globes */}
      {clusters.map((cluster, index) => {
        const pos = positions[index];
        if (!pos) return null;

        const clusterNodes = clusterNodeMap.get(cluster.id) ?? [];
        const clusterEdges = clusterEdgeMap.get(cluster.id) ?? [];
        const lod = lodStates.find((l) => l.clusterId === cluster.id);

        return (
          <group
            key={cluster.id}
            onPointerDown={(e) => handleGlobePointerDown(index, e)}
          >
            <ClusterGlobe
              cluster={cluster}
              nodes={clusterNodes}
              intraClusterEdges={clusterEdges}
              enabledEdgeTypes={enabledEdgeTypes}
              globeRadius={GLOBE_RADIUS}
              position={[pos.x, pos.y, pos.z]}
              lodState={
                lod
                  ? {
                      level: lod.level,
                      showFunctionLabels: lod.level === "close",
                      showDirectedArcs: lod.level === "close",
                      showFunctionBadges: lod.level !== "far",
                    }
                  : {
                      level: "medium",
                      showFunctionLabels: false,
                      showDirectedArcs: false,
                      showFunctionBadges: true,
                    }
              }
              highlightedNodeIds={highlightedNodeIds}
            />
          </group>
        );
      })}

      {/* Cross-globe arcs */}
      {crossGlobeArcs.map((arc) => (
        <Line
          key={arc.id}
          points={arc.points}
          color="#FFFFFF"
          lineWidth={1}
          dashed
          dashSize={0.1}
          gapSize={0.05}
          transparent
          opacity={0.5}
          onPointerOver={(e) => {
            e.stopPropagation();
            onHighlightChange(new Set([arc.sourceNodeId, arc.targetNodeId]));
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            onHighlightChange(new Set());
          }}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export function Globe3DPhase2({
  graph,
  clusters,
  enabledEdgeTypes,
}: Globe3DPhase2Props) {
  const clusterIds = useMemo(() => clusters.map((c) => c.id), [clusters]);

  const [positions, setPositions] = useState<GlobePosition[]>(() => {
    return loadPersistedPositions(clusterIds) ?? computeDefaultPositions(clusterIds);
  });

  // Update positions when clusters change
  useEffect(() => {
    const persisted = loadPersistedPositions(clusterIds);
    if (persisted) {
      setPositions(persisted);
    } else {
      setPositions(computeDefaultPositions(clusterIds));
    }
  }, [clusterIds]);

  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(
    new Set(),
  );

  const handleResetLayout = useCallback(() => {
    const defaults = computeDefaultPositions(clusterIds);
    setPositions(defaults);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Silently ignore
    }
  }, [clusterIds]);

  return (
    <div className="relative w-full h-full">
      {/* Reset Layout button */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={handleResetLayout}
          className="px-3 py-1.5 text-xs font-medium rounded-lg shadow bg-white/10 text-gray-300 hover:bg-white/20 transition-colors"
        >
          Reset Layout
        </button>
      </div>

      {/* Globe count indicator */}
      <div className="absolute top-4 left-4 z-10 px-3 py-1.5 bg-black/60 rounded-lg text-xs text-gray-300">
        {clusters.length} globe{clusters.length !== 1 ? "s" : ""}
      </div>

      <Canvas
        camera={{ position: [0, 0, 15], fov: 50 }}
        style={{ background: BACKGROUND_COLOR }}
      >
        <Scene
          graph={graph}
          clusters={clusters}
          enabledEdgeTypes={enabledEdgeTypes}
          positions={positions}
          onPositionsChange={setPositions}
          highlightedNodeIds={highlightedNodeIds}
          onHighlightChange={setHighlightedNodeIds}
        />
      </Canvas>
    </div>
  );
}
