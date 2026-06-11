"use client";

import { useMemo } from "react";
import { KIND_META } from "@/lib/graph-constants";
import type { NodeKind } from "@/db/models/graph.model";
import { cn } from "@/lib/cn";

/** Minimal shapes — a structural subset of INodeSpec / IEdgeSpec so this stays
 *  decoupled from the full Mongo/tRPC types and is trivial to unit-test. */
type ThumbNode = {
  id: string;
  kind: NodeKind;
  position?: { x: number; y: number } | null;
};
type ThumbEdge = { source: string; target: string };

// Internal coordinate space; nodes are projected into this box with padding.
const VIEW_W = 100;
const VIEW_H = 52;
const PAD = 8;
const DOT = 5; // node marker size (square side, in view units)
// Guard against pathological graphs — a thumbnail only needs the gist.
const MAX_NODES = 80;

/**
 * Decorative SVG mini-map of a graph's node layout. Projects each node's
 * canvas position into a small fixed-aspect viewBox, draws edges as hairlines
 * and nodes as kind-coloured squares. Purely presentational (`aria-hidden`);
 * the card's text/labels carry the accessible information.
 */
export function GraphThumbnail({
  nodes,
  edges = [],
  className,
}: {
  nodes: ThumbNode[];
  edges?: ThumbEdge[];
  className?: string;
}) {
  const projected = useMemo(() => {
    const shown = nodes.slice(0, MAX_NODES);
    if (shown.length === 0) return null;

    const pts = shown.map((n) => ({
      id: n.id,
      kind: n.kind,
      x: n.position?.x ?? 0,
      y: n.position?.y ?? 0,
    }));

    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const innerW = VIEW_W - PAD * 2;
    const innerH = VIEW_H - PAD * 2;
    // Uniform scale preserves the layout's aspect ratio inside the box.
    const scale = Math.min(innerW / spanX, innerH / spanY);

    // Centre the scaled cloud within the inner box.
    const offsetX = PAD + (innerW - spanX * scale) / 2;
    const offsetY = PAD + (innerH - spanY * scale) / 2;

    const byId = new Map<string, { x: number; y: number }>();
    const placed = pts.map((p) => {
      const cx = offsetX + (p.x - minX) * scale;
      const cy = offsetY + (p.y - minY) * scale;
      byId.set(p.id, { x: cx, y: cy });
      return { ...p, cx, cy };
    });

    const lines = edges
      .map((e) => ({ a: byId.get(e.source), b: byId.get(e.target) }))
      .filter((l): l is { a: { x: number; y: number }; b: { x: number; y: number } } =>
        Boolean(l.a && l.b),
      );

    return { placed, lines };
  }, [nodes, edges]);

  return (
    <div
      data-testid="graph-thumbnail"
      aria-hidden
      className={cn(
        "relative overflow-hidden rounded-md border border-border bg-surface/60",
        className,
      )}
    >
      {projected === null ? (
        <div
          data-testid="graph-thumbnail-empty"
          className="grid h-full w-full place-items-center"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            No nodes yet
          </span>
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
        >
          {projected.lines.map((l, i) => (
            <line
              key={`e${i}`}
              x1={l.a.x}
              y1={l.a.y}
              x2={l.b.x}
              y2={l.b.y}
              stroke="rgba(255,255,255,0.16)"
              strokeWidth={0.75}
            />
          ))}
          {projected.placed.map((p) => {
            const color = KIND_META[p.kind]?.color ?? "#646b7a";
            return (
              <rect
                key={p.id}
                data-testid="graph-thumbnail-node"
                x={p.cx - DOT / 2}
                y={p.cy - DOT / 2}
                width={DOT}
                height={DOT}
                rx={1.5}
                fill={color}
                stroke="rgba(0,0,0,0.35)"
                strokeWidth={0.5}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}
