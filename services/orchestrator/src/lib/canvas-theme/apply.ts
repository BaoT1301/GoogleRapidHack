/**
 * Pure adapters from a {@link ThemePack} to ReactFlow render props. Kept
 * framework-light (no React) so they're trivially unit-testable and reusable by
 * the canvas, the background layer, and tests. The canvas applies these so edge
 * + background appearance is fully pack-driven (no hardcoded EDGE_META / inline
 * <Background> colors).
 */
import type { CSSProperties } from "react";
import type { EdgeKind } from "@/db/models/graph.model";
import type { ThemePack, AssetDef, VisualStatus } from "./schema";

const FALLBACK_EDGE_WIDTH = 1.5;

export interface EdgeRenderProps {
  style: CSSProperties;
  animated: boolean;
}

/** Resolve the stroke style + animation for an edge of `kind` from the pack. */
export function edgeRenderProps(
  pack: ThemePack,
  kind: EdgeKind | undefined,
): EdgeRenderProps {
  const e = (kind && pack.edges[kind]) || pack.edges.flow;
  return {
    style: { stroke: e.color, strokeWidth: e.strokeWidth ?? FALLBACK_EDGE_WIDTH },
    animated: e.animated ?? false,
  };
}

export type BackgroundVariantName = "dots" | "lines" | "cross";

export interface BackgroundRenderProps {
  /** ReactFlow Background variant. */
  variant: BackgroundVariantName;
  color?: string;
  gap?: number;
  size?: number;
  /** Asset id when the pack uses an image background (resolved by the caller). */
  imageAssetRef?: string;
}

/**
 * Resolve background render props from the pack. Returns `null` for `kind:"none"`
 * (caller renders no grid). `image` backgrounds carry `imageAssetRef` for the
 * caller to render an <img> layer (Task 11) and fall back to a dot grid variant.
 */
export function backgroundRenderProps(
  pack: ThemePack,
): BackgroundRenderProps | null {
  const bg = pack.background;
  if (bg.kind === "none") return null;
  if (bg.kind === "image") {
    return {
      variant: "dots",
      color: bg.color,
      gap: bg.gap,
      size: bg.size,
      imageAssetRef: bg.assetRef,
    };
  }
  return { variant: bg.kind, color: bg.color, gap: bg.gap, size: bg.size };
}

/** Resolve an `assetRef` (key into `pack.assets`) to its definition, if present. */
export function resolveAsset(
  pack: ThemePack,
  ref: string | undefined,
): AssetDef | undefined {
  if (!ref) return undefined;
  return pack.assets[ref];
}

/**
 * Whether an asset should render with crisp `image-rendering: pixelated` — true
 * for pixel-art packs (renderMode "pixel") or any asset explicitly flagged
 * `pixelated`. Prevents modern browsers from blurring upscaled sprites.
 */
export function shouldPixelate(
  pack: ThemePack,
  asset: AssetDef | undefined,
): boolean {
  return pack.renderMode === "pixel" || asset?.pixelated === true;
}

/** CSS for an image element given the pack/asset pixelation decision. */
export function imageRenderingStyle(
  pack: ThemePack,
  asset: AssetDef | undefined,
): CSSProperties {
  return shouldPixelate(pack, asset)
    ? { imageRendering: "pixelated" }
    : {};
}

/**
 * Compose the CSS `filter` string + layer `opacity` for an image background from
 * the pack's `background.filter`. Returns `{}` when no filters are configured so
 * the background layer renders exactly as before. Only the provided filter
 * functions are emitted (order is fixed for determinism).
 */
export function backgroundFilterStyle(pack: ThemePack): CSSProperties {
  const f = pack.background.filter;
  if (!f) return {};
  const parts: string[] = [];
  if (f.blur !== undefined) parts.push(`blur(${f.blur}px)`);
  if (f.brightness !== undefined) parts.push(`brightness(${f.brightness})`);
  if (f.contrast !== undefined) parts.push(`contrast(${f.contrast})`);
  if (f.saturate !== undefined) parts.push(`saturate(${f.saturate})`);
  if (f.grayscale !== undefined) parts.push(`grayscale(${f.grayscale})`);
  const style: CSSProperties = {};
  if (parts.length > 0) style.filter = parts.join(" ");
  if (f.opacity !== undefined) style.opacity = f.opacity;
  return style;
}

/**
 * Resolve the tint wash overlay for an image background — a flat color drawn
 * over the image (e.g. to darken a busy photo so nodes stay legible). Returns
 * `null` when no `tintColor` is set; `tintOpacity` defaults to 0.3.
 */
export function backgroundTint(
  pack: ThemePack,
): { color: string; opacity: number } | null {
  const f = pack.background.filter;
  if (!f?.tintColor) return null;
  return { color: f.tintColor, opacity: f.tintOpacity ?? 0.3 };
}

/**
 * Resolve the per-status overlay sprite (key `statuses[status].assetRef`) to its
 * asset definition, if the active pack themes that status with an image/gif.
 * Returns `undefined` when the status has no sprite (the node falls back to its
 * dot/ring indicator).
 */
export function statusAsset(
  pack: ThemePack,
  status: VisualStatus,
): AssetDef | undefined {
  return resolveAsset(pack, pack.statuses[status]?.assetRef);
}
