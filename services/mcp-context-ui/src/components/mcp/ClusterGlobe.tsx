/**
 * ClusterGlobe Component
 *
 * Renders a single cluster as a 3D sphere in the R3F scene.
 * Each cluster gets one ClusterGlobe instance inside the shared Canvas.
 * Handles node rendering, intra-cluster arcs, hover detection, and LOD.
 */

import { useMemo, useState, useRef } from "react";
import { Sphere, Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { ARC_STYLES, type GlobeNode } from "../../types/globe";
import type { Cluster } from "../../types/globe";
import type { Edge } from "../../types/mcp";
import type { LODState } from "../../hooks/use-lod";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ClusterGlobeProps {
  cluster: Cluster;
  nodes: GlobeNode[];
  intraClusterEdges: Edge[];
  enabledEdgeTypes: Set<string>;
  globeRadius?: number;
  position: [number, number, number];
  lodState: LODState;
  highlightedNodeIds?: Set<string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert lat/lng (degrees) to 3D position on a sphere of given radius. */
function latLngToVector3(
  lat: number,
  lng: number,
  radius: number,
): [number, number, number] {
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const x = radius * Math.cos(latRad) * Math.cos(lngRad);
  const y = radius * Math.sin(latRad);
  const z = radius * Math.cos(latRad) * Math.sin(lngRad);
  return [x, y, z];
}

/** Build a quadratic bezier curve elevated above the sphere surface. */
function buildArcPoints(
  start: [number, number, number],
  end: [number, number, number],
  elevation: number,
): [number, number, number][] {
  const mid: [number, number, number] = [
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
    (start[2] + end[2]) / 2,
  ];
  // Normalize midpoint and push outward
  const len = Math.sqrt(mid[0] ** 2 + mid[1] ** 2 + mid[2] ** 2);
  if (len > 0) {
    const scale = (len + elevation) / len;
    mid[0] *= scale;
    mid[1] *= scale;
    mid[2] *= scale;
  }

  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(...start),
    new THREE.Vector3(...mid),
    new THREE.Vector3(...end),
  );
  return curve.getPoints(20).map((p) => [p.x, p.y, p.z]);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ClusterGlobe({
  cluster,
  nodes,
  intraClusterEdges,
  enabledEdgeTypes,
  globeRadius = 2,
  position,
  lodState,
  highlightedNodeIds,
}: ClusterGlobeProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  // ── Build node position map ─────────────────────────────────────────
  const nodePositionMap = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    for (const node of nodes) {
      map.set(node.id, latLngToVector3(node.lat, node.lng, globeRadius));
    }
    return map;
  }, [nodes, globeRadius]);

  // ── Filter and build arc data ───────────────────────────────────────
  const arcs = useMemo(() => {
    if (!lodState.showDirectedArcs) return [];

    const nodeIds = new Set(nodes.map((n) => n.id));
    return intraClusterEdges
      .filter((edge) => {
        if (!enabledEdgeTypes.has(edge.type)) return false;
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false;
        return true;
      })
      .map((edge) => {
        const startPos = nodePositionMap.get(edge.source);
        const endPos = nodePositionMap.get(edge.target);
        if (!startPos || !endPos) return null;

        const style = ARC_STYLES[edge.type];
        const points = buildArcPoints(startPos, endPos, globeRadius * 0.3);
        return {
          id: `${edge.source}-${edge.target}-${edge.type}`,
          points,
          color: style.color,
        };
      })
      .filter((arc): arc is NonNullable<typeof arc> => arc !== null);
  }, [intraClusterEdges, enabledEdgeTypes, nodes, nodePositionMap, globeRadius, lodState.showDirectedArcs]);

  // ── Hovered node data ───────────────────────────────────────────────
  const hoveredNode = useMemo(
    () => nodes.find((n) => n.id === hoveredNodeId) ?? null,
    [nodes, hoveredNodeId],
  );

  return (
    <group ref={groupRef} position={position}>
      {/* Globe sphere */}
      <Sphere args={[globeRadius, 32, 32]}>
        <meshStandardMaterial
          color={cluster.color}
          opacity={0.15}
          transparent
          wireframe={false}
          side={THREE.DoubleSide}
        />
      </Sphere>

      {/* Cluster label */}
      <Html
        position={[0, globeRadius + 0.4, 0]}
        center
        distanceFactor={10}
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            padding: "2px 8px",
            background: "rgba(0,0,0,0.7)",
            borderRadius: 4,
            color: cluster.color,
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {cluster.label}
        </div>
      </Html>

      {/* Nodes */}
      {nodes.map((node) => {
        const pos = nodePositionMap.get(node.id);
        if (!pos) return null;

        const isHighlighted = highlightedNodeIds?.has(node.id) ?? false;
        const scale = isHighlighted ? 2 : 1;

        return (
          <mesh
            key={node.id}
            position={pos}
            scale={scale}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHoveredNodeId(node.id);
            }}
            onPointerOut={(e) => {
              e.stopPropagation();
              setHoveredNodeId(null);
            }}
          >
            <sphereGeometry args={[0.03, 8, 8]} />
            <meshBasicMaterial
              color={node.color}
              {...(isHighlighted ? { toneMapped: false } : {})}
            />
          </mesh>
        );
      })}

      {/* Hover tooltip */}
      {hoveredNode && lodState.showFunctionLabels && (
        <Html
          position={nodePositionMap.get(hoveredNode.id) ?? [0, 0, 0]}
          center
          distanceFactor={8}
          style={{ pointerEvents: "none" }}
        >
          <div
            style={{
              padding: "4px 8px",
              background: "rgba(0,0,0,0.85)",
              borderRadius: 4,
              color: "#fff",
              fontSize: 11,
              whiteSpace: "nowrap",
            }}
          >
            <strong>{hoveredNode.label}</strong>
            <br />
            {hoveredNode.functions.length} function
            {hoveredNode.functions.length !== 1 ? "s" : ""}
          </div>
        </Html>
      )}

      {/* Function badge (medium LOD) */}
      {lodState.showFunctionBadges &&
        !lodState.showFunctionLabels &&
        hoveredNode && (
          <Html
            position={nodePositionMap.get(hoveredNode.id) ?? [0, 0, 0]}
            center
            distanceFactor={8}
            style={{ pointerEvents: "none" }}
          >
            <div
              style={{
                padding: "2px 6px",
                background: "rgba(0,0,0,0.7)",
                borderRadius: 4,
                color: "#fff",
                fontSize: 10,
                whiteSpace: "nowrap",
              }}
            >
              {hoveredNode.label} ({hoveredNode.functions.length})
            </div>
          </Html>
        )}

      {/* Intra-cluster arcs */}
      {arcs.map((arc) => (
        <Line
          key={arc.id}
          points={arc.points}
          color={arc.color}
          lineWidth={1}
          transparent
          opacity={0.6}
        />
      ))}
    </group>
  );
}
