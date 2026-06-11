"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion, useReducedMotion } from "motion/react";
import { iconForName } from "@/lib/canvas-theme/icons";
import { nodeMotionProps } from "@/lib/canvas-theme/motion";
import { resolveAsset, shouldPixelate, statusAsset } from "@/lib/canvas-theme/apply";
import type { VisualStatus, ThemePack } from "@/lib/canvas-theme/schema";
import { useCanvasTheme } from "@/components/canvas/CanvasThemeProvider";
import { cn } from "@/lib/cn";
import type { AppNode, FlowNodeData } from "@/components/canvas/serialize";

/** Fallback when a status isn't themed by the active pack (mirrors statusColor). */
const FALLBACK_STATUS_COLOR = "#646b7a";

/**
 * Presentational node body — now fully Theme-Pack driven (no hardcoded
 * KIND_META / KIND_ICONS / statusColor imports). It reads the active pack from
 * {@link useCanvasTheme} and paints kind (border/icon/label) and status
 * (indicator/frame/opacity) from it, so any pack re-skins the node.
 *
 * `visualStatus` lets the editor pass a UI-DERIVED status (e.g. `stale`) without
 * touching `data.status` (the persisted/runtime value). Defaults to `data.status`.
 */
export function GraphNodeBody({
  data,
  selected,
  visualStatus,
  pack: packProp,
}: {
  data: FlowNodeData;
  selected?: boolean;
  visualStatus?: VisualStatus;
  /** Override the active pack (testing / embedding). Defaults to context pack. */
  pack?: ThemePack;
}) {
  const theme = useCanvasTheme();
  const pack = packProp ?? theme.pack;
  const kind = pack.kinds[data.kind];
  const Icon = iconForName(kind.icon);
  // Mixed-media: a kind may render an imported sprite/image instead of a vector
  // icon. Falls back to the vector icon when no asset is resolved.
  const kindAsset = resolveAsset(pack, kind.assetRef);
  const pixelated = shouldPixelate(pack, kindAsset);

  const effectiveStatus = (visualStatus ?? data.status) as VisualStatus;
  const statusVisual = pack.statuses[effectiveStatus];
  const sColor = statusVisual?.color ?? FALLBACK_STATUS_COLOR;
  const indicator = statusVisual?.indicator ?? "dot";
  const frameDashed = statusVisual?.frame === "dashed";
  const statusTitle = statusVisual?.label ?? effectiveStatus;
  // Per-state overlay sprite (image/gif). When the active pack themes this
  // status with an asset, it renders as a badge in place of the dot/ring.
  const statusSprite = statusAsset(pack, effectiveStatus);
  const statusPixelated = shouldPixelate(pack, statusSprite);

  // Motion comes from the active pack (entrance + hover + status-driven variant),
  // and collapses to static when the pack disables motion or the user prefers
  // reduced motion.
  const reducedMotion = useReducedMotion() ?? false;
  const m = nodeMotionProps(pack, effectiveStatus, { reducedMotion });

  // AI-editing / Plan-node UI states (layered on top of the theme-pack visuals).
  // These drive selection glow, AI-improve pulsing, graph-patch preview tints,
  // and Plan Node proposal states without touching the persisted status.
  const hovered = Boolean(data.hovered);
  const aiPulsing = Boolean(data.aiPulsing);
  const patchState = typeof data.aiPatchState === "string" ? data.aiPatchState : undefined;
  const planState = data.kind === "plan" && typeof data.planState === "string" ? data.planState : undefined;
  const runtimeLabel = typeof data.runtimeLabel === "string" ? data.runtimeLabel : undefined;

  return (
    <motion.div
      initial={m.initial}
      animate={m.animate}
      transition={m.transition}
      whileHover={m.whileHover}
      className={cn(
        "rounded-lg border bg-raised p-1 transition-[border-color,box-shadow,opacity] duration-200",
        frameDashed && "border-dashed",
        selected
          ? "border-accent shadow-[0_0_0_1px_rgba(89,240,255,0.22),0_0_30px_rgba(89,240,255,0.2)]"
          : "border-border hover:border-border-strong",
        hovered && !selected && "border-accent/60 shadow-[0_0_0_1px_rgba(89,240,255,0.16),0_0_30px_rgba(89,240,255,0.18)]",
        aiPulsing && "animate-pulse shadow-[0_0_36px_rgba(89,240,255,0.28)] motion-reduce:animate-none",
        patchState === "changed" && "shadow-[0_0_34px_rgba(90,255,190,0.22)]",
        patchState === "added" && "border-success/70 shadow-[0_0_34px_rgba(90,255,190,0.26)]",
        patchState === "removed" && "border-danger/70 opacity-55 shadow-[0_0_34px_rgba(255,90,120,0.2)]",
        planState === "planning" && "animate-pulse border-accent/70 shadow-[0_0_34px_rgba(89,240,255,0.22)] motion-reduce:animate-none",
        planState === "proposal_ready" && "border-warning/70 shadow-[0_0_34px_rgba(255,220,90,0.18)]",
        planState === "context_required" && "border-warning/60",
        planState === "applied" && "border-success/70 shadow-[0_0_34px_rgba(90,255,190,0.2)]",
        planState === "failed" && "border-danger/70",
      )}
      style={{
        borderTopColor: frameDashed ? sColor : kind.color,
        opacity: statusVisual?.opacity,
      }}
    >
      <div className="min-w-[168px] rounded-md bg-panel-raised px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <div className="flex items-center gap-2">
          <span
            className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded"
            style={{
              backgroundColor: kindAsset ? "transparent" : `${kind.color}22`,
              color: kind.color,
            }}
          >
            {kindAsset ? (
              // eslint-disable-next-line @next/next/no-img-element -- dynamic capability URL; Next <Image> needs static config
              <img
                src={kindAsset.url}
                alt={kind.label}
                width={kindAsset.width ?? 16}
                height={kindAsset.height ?? 16}
                className="h-4 w-4 object-contain"
                style={pixelated ? { imageRendering: "pixelated" } : undefined}
              />
            ) : (
              <Icon size={14} weight="duotone" />
            )}
          </span>
          <span className="truncate text-xs font-semibold tracking-tight text-content">
            {data.label}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">
            {kind.label}
          </span>
          {statusSprite ? (
            // eslint-disable-next-line @next/next/no-img-element -- dynamic capability URL; gifs animate natively
            <img
              src={statusSprite.url}
              alt={statusTitle}
              title={statusTitle}
              aria-label={`status: ${statusTitle}`}
              width={statusSprite.width ?? 16}
              height={statusSprite.height ?? 16}
              className="h-4 w-4 shrink-0 object-contain"
              style={statusPixelated ? { imageRendering: "pixelated" } : undefined}
            />
          ) : (
            indicator !== "none" && (
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  indicator === "ring" && "border-2 bg-transparent",
                )}
                style={
                  indicator === "ring"
                    ? { borderColor: sColor }
                    : { backgroundColor: sColor }
                }
                title={statusTitle}
                aria-label={`status: ${statusTitle}`}
              />
            )
          )}
        </div>
        {planState && (
          <div className="mt-2 rounded-sm border border-white/10 bg-white/[0.03] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.12em] text-faint">
            {planState.replaceAll("_", " ")}
          </div>
        )}
        {runtimeLabel && (
          <div
            className="mt-2 inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-muted"
            aria-label={`runtime ${runtimeLabel}`}
            title={`Runtime ${runtimeLabel}`}
          >
            {runtimeLabel}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function GraphNodeImpl({ data, selected }: NodeProps<AppNode>) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-border-strong !bg-panel"
      />
      <GraphNodeBody
        data={data}
        selected={selected}
        visualStatus={data.visualStatus}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-border-strong !bg-panel"
      />
    </>
  );
}

export const GraphNode = memo(GraphNodeImpl);
