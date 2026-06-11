"use client";

import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  SelectionMode,
  type Connection,
  type Edge,
  type NodeTypes,
  type OnNodesChange,
  type OnEdgesChange,
  type OnSelectionChangeParams,
  type NodeMouseHandler,
} from "@xyflow/react";
import { PlusIcon, GraphIcon } from "@phosphor-icons/react";
import { GraphNode } from "@/components/canvas/nodes/GraphNode";
import { iconForName } from "@/lib/canvas-theme/icons";
import {
  edgeRenderProps,
  backgroundRenderProps,
  resolveAsset,
  shouldPixelate,
  backgroundFilterStyle,
  backgroundTint,
  type BackgroundVariantName,
} from "@/lib/canvas-theme/apply";
import { useCanvasTheme } from "@/components/canvas/CanvasThemeProvider";
import { NODE_KINDS } from "@/lib/graph-constants";
import { EmptyState } from "@/components/ui/EmptyState";
import type { AppNode, AppEdge } from "@/components/canvas/serialize";
import type { NodeKind } from "@/db/models/graph.model";

const nodeTypes: NodeTypes = { graphNode: GraphNode };

const RF_BG_VARIANT: Record<BackgroundVariantName, BackgroundVariant> = {
  dots: BackgroundVariant.Dots,
  lines: BackgroundVariant.Lines,
  cross: BackgroundVariant.Cross,
};

/** Presentational ReactFlow island. State + handlers live in WorkspaceEditor. */
export function Canvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  isValidConnection,
  onAddNode,
  onSelectionChange,
  onNodeContextMenu,
  onNodeMouseEnter,
  onNodeMouseLeave,
  onEdgeContextMenu,
  onPaneClick,
}: {
  nodes: AppNode[];
  edges: AppEdge[];
  onNodesChange: OnNodesChange<AppNode>;
  onEdgesChange: OnEdgesChange<AppEdge>;
  onConnect: (c: Connection) => void;
  isValidConnection: (c: Connection | Edge) => boolean;
  onAddNode: (k: NodeKind) => void;
  onSelectionChange: (p: OnSelectionChangeParams) => void;
  onNodeContextMenu: (e: React.MouseEvent, node: AppNode) => void;
  onNodeMouseEnter?: NodeMouseHandler<AppNode>;
  onNodeMouseLeave?: NodeMouseHandler<AppNode>;
  onEdgeContextMenu: (e: React.MouseEvent, edge: AppEdge) => void;
  onPaneClick: () => void;
}) {
  const { pack } = useCanvasTheme();

  // Edge stroke + animation come from the active pack (re-skins with the theme).
  const themedEdges = useMemo(
    () =>
      edges.map((e) => {
        const renderProps = edgeRenderProps(pack, e.data?.kind);
        const patchState = e.data?.aiPatchState;
        return {
          ...e,
          ...renderProps,
          animated: renderProps.animated || patchState === "added" || patchState === "changed",
          style: {
            ...renderProps.style,
            strokeDasharray: patchState === "added" ? "5 5" : undefined,
            opacity: patchState === "removed" ? 0.42 : undefined,
            filter:
              patchState === "added" || patchState === "changed"
                ? "drop-shadow(0 0 7px rgba(89,240,255,0.5))"
                : undefined,
          },
        };
      }),
    [edges, pack],
  );

  const bg = useMemo(() => backgroundRenderProps(pack), [pack]);
  // Image background (pixel/vector packs): a tiled backdrop behind the grid,
  // optionally filtered (blur/brightness/…) and washed with a tint for contrast.
  const bgImage = useMemo(() => {
    if (!bg?.imageAssetRef) return null;
    const asset = resolveAsset(pack, bg.imageAssetRef);
    if (!asset) return null;
    return {
      url: asset.url,
      pixelated: shouldPixelate(pack, asset),
      filterStyle: backgroundFilterStyle(pack),
      tint: backgroundTint(pack),
    };
  }, [bg, pack]);

  return (
    <div className="relative h-full w-full">
      {bgImage && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0"
            style={{
              backgroundImage: `url(${bgImage.url})`,
              backgroundRepeat: "repeat",
              imageRendering: bgImage.pixelated ? "pixelated" : undefined,
              ...bgImage.filterStyle,
            }}
          />
          {bgImage.tint && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-0"
              style={{
                backgroundColor: bgImage.tint.color,
                opacity: bgImage.tint.opacity,
              }}
            />
          )}
        </>
      )}
      <ReactFlow
        nodes={nodes}
        edges={themedEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onSelectionChange={onSelectionChange}
        onNodeContextMenu={onNodeContextMenu}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneClick={onPaneClick}
        selectionOnDrag
        panOnDrag={[1, 2]}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={["Meta", "Shift", "Control"]}
        deleteKeyCode={null}
        fitView
        minZoom={0.2}
        className={bgImage ? "!bg-transparent" : "bg-surface"}
      >
        {bg && !bgImage && (
          <Background
            variant={RF_BG_VARIANT[bg.variant]}
            color={bg.color}
            gap={bg.gap}
            size={bg.size}
          />
        )}
        <Controls className="!border !border-border !bg-panel" />
      </ReactFlow>
      <NodePalette onAdd={onAddNode} />
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <EmptyState
            icon={<GraphIcon size={22} weight="duotone" />}
            title="Empty canvas"
            description="Add a node from the palette (top-left) to start composing your workflow."
          />
        </div>
      )}
    </div>
  );
}

function NodePalette({ onAdd }: { onAdd: (kind: NodeKind) => void }) {
  const { pack } = useCanvasTheme();
  return (
    <div className="absolute left-4 top-4 z-10 flex flex-col gap-1 rounded-lg border border-border bg-panel/80 p-1.5 backdrop-blur-xl">
      {NODE_KINDS.map((kind) => {
        const meta = pack.kinds[kind];
        const Icon = iconForName(meta.icon);
        return (
          <button
            key={kind}
            onClick={() => onAdd(kind)}
            aria-label={`Add ${meta.label} node`}
            className="group flex items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-hover"
          >
            <span
              className="grid h-6 w-6 place-items-center rounded"
              style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
            >
              <Icon size={14} weight="duotone" />
            </span>
            <span className="pr-1 text-xs font-medium text-muted group-hover:text-content">
              {meta.label}
            </span>
            <PlusIcon
              size={12}
              className="ml-auto text-faint opacity-0 transition-opacity group-hover:opacity-100"
            />
          </button>
        );
      })}
    </div>
  );
}
