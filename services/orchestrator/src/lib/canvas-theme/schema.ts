/**
 * Canvas Theme Pack contract — the single, type-safe source of truth for how
 * the canvas paints nodes, statuses, edges, the background, and motion.
 *
 * Before this contract, visuals were hardcoded across three files
 * (`lib/graph-constants.ts`, `lib/status.ts`, `components/canvas/nodes/GraphNode.tsx`).
 * A Theme Pack unifies them so the canvas + nodes become purely presentational:
 * they read the active pack and never hardcode appearance. Other agents author
 * new packs (incl. game-asset / pixel packs) against THIS schema.
 *
 * Design rules:
 *   • Dependency-light — no React / Phosphor imports here. Icons are referenced
 *     by string name and resolved by the icon registry (`./icons`). Assets are
 *     referenced by id and resolved by the asset resolver. This keeps the schema
 *     safe to import from server code, tests, and the client bundle alike.
 *   • Full coverage enforced two ways: the zod record requires every NodeKind /
 *     EdgeKind / VisualStatus key at runtime, and the `_Check*` guards below fail
 *     to COMPILE if the model adds a kind/status we don't mirror (Do-Not-Invent /
 *     no-drift — same pattern as `lib/graph-constants.ts`).
 */
import { z } from "zod";
import type { NodeKind, EdgeKind, NodeStatus } from "@/db/models/graph.model";
import { NODE_KINDS, EDGE_KINDS } from "@/lib/graph-constants";

// ── Visual status vocabulary ─────────────────────────────────────────────────
// Union of the authored NodeStatus enum + the runtime SSE contract states + the
// graph-level states (all already present in `lib/status.ts` STATUS_COLORS) plus
// the UI-only derived `stale`. A pack must theme every one of these.
export const VISUAL_STATUSES = [
  // authored node (graph.model NodeStatus)
  "pending",
  "ready",
  "running",
  "paused",
  "success",
  "failed",
  "skipped",
  "blocked",
  // runtime SSE contract states
  "queued",
  "starting",
  "completed",
  "cancelled",
  // graph-level
  "draft",
  "archived",
  // UI-derived (never persisted, never on the SSE stream)
  "stale",
] as const;
export type VisualStatus = (typeof VISUAL_STATUSES)[number];

// ── Icon registry names ──────────────────────────────────────────────────────
// String keys into the icon registry (`./icons`). Kept here (pure strings) so
// the schema stays React/Phosphor-free; the registry maps each to a component.
export const ICON_NAMES = [
  "note-pencil",
  "lightning",
  "magnifying-glass",
  "file-text",
  "shield-check",
  "stack",
  "arrows-clockwise",
  "graph",
  "cube",
  "sparkle",
] as const;
export type IconName = (typeof ICON_NAMES)[number];

// ── Small reusable building blocks ───────────────────────────────────────────
const hexOrCssColor = z.string().min(1);

/** A value Motion can animate: a single number or a keyframe array. */
const numberOrKeyframes = z.union([z.number(), z.array(z.number())]);
/** A string value (e.g. boxShadow / filter) or a keyframe array of strings. */
const stringOrKeyframes = z.union([z.string(), z.array(z.string())]);

const transitionSchema = z
  .object({
    duration: z.number().nonnegative(),
    delay: z.number().nonnegative(),
    ease: z.union([z.string(), z.array(z.number())]),
    repeat: z.number(), // use Number.POSITIVE_INFINITY for looping packs
    repeatType: z.enum(["loop", "reverse", "mirror"]),
    type: z.enum(["tween", "spring", "inertia", "keyframes"]),
  })
  .partial();

/** The animatable target subset we support (extend as packs need more). */
const animatableSchema = z
  .object({
    opacity: numberOrKeyframes,
    scale: numberOrKeyframes,
    x: numberOrKeyframes,
    y: numberOrKeyframes,
    rotate: numberOrKeyframes,
    boxShadow: stringOrKeyframes,
    filter: stringOrKeyframes,
    transition: transitionSchema,
  })
  .partial();

/** A continuous, status-driven variant: a target plus its transition. */
const motionVariantSchema = z
  .object({
    animate: animatableSchema,
    transition: transitionSchema.optional(),
  })
  .strict();

// ── Asset definitions ────────────────────────────────────────────────────────
export const assetDefSchema = z
  .object({
    /** Resolvable URL (DB-backed asset route, data URI, or bundled path). */
    url: z.string().min(1),
    /** When true, render with `image-rendering: pixelated` (crisp pixel-art). */
    pixelated: z.boolean().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
  })
  .strict();
export type AssetDef = z.infer<typeof assetDefSchema>;

// ── Per-kind visual ──────────────────────────────────────────────────────────
export const kindVisualSchema = z
  .object({
    label: z.string().min(1),
    color: hexOrCssColor,
    /** Vector icon name (resolved by the icon registry). */
    icon: z.enum(ICON_NAMES).optional(),
    /** Asset id (key into `assets`) for image/sprite packs. Wins over `icon`. */
    assetRef: z.string().min(1).optional(),
  })
  .strict();
export type KindVisual = z.infer<typeof kindVisualSchema>;

// ── Per-status visual ────────────────────────────────────────────────────────
export const statusVisualSchema = z
  .object({
    color: hexOrCssColor,
    /** How the status chip on the node renders. Default "dot". */
    indicator: z.enum(["dot", "ring", "none"]).optional(),
    /** Node border-frame override (e.g. dashed for `stale`). */
    frame: z.enum(["none", "solid", "dashed"]).optional(),
    /** Node opacity multiplier (e.g. `stale` → 0.6 desaturated look). */
    opacity: z.number().min(0).max(1).optional(),
    /** Key into `motion.perStatus` to drive a continuous animation. */
    motionVariant: z.string().min(1).optional(),
    /** Optional status overlay sprite (image packs). */
    assetRef: z.string().min(1).optional(),
    /** Optional human label override for tooltips. */
    label: z.string().min(1).optional(),
  })
  .strict();
export type StatusVisual = z.infer<typeof statusVisualSchema>;

// ── Per-edge visual ──────────────────────────────────────────────────────────
export const edgeVisualSchema = z
  .object({
    label: z.string().min(1),
    color: hexOrCssColor,
    strokeWidth: z.number().positive().optional(),
    animated: z.boolean().optional(),
  })
  .strict();
export type EdgeVisual = z.infer<typeof edgeVisualSchema>;

// ── Background image filters ─────────────────────────────────────────────────
// Optional, purely-visual adjustments applied to an `image` background so an
// uploaded backdrop can be tuned for readability over the canvas grid/nodes.
// Each field maps to a CSS `filter()` function (composed by `apply.ts`) except
// `opacity` (layer opacity) and the `tint*` pair (a color wash overlay). All
// optional + bounded so packs without filters stay byte-identical to before.
export const backgroundFilterSchema = z
  .object({
    /** Gaussian blur in px (0 = none). */
    blur: z.number().min(0).max(40).optional(),
    /** Brightness multiplier (1 = unchanged). */
    brightness: z.number().min(0).max(3).optional(),
    /** Contrast multiplier (1 = unchanged). */
    contrast: z.number().min(0).max(3).optional(),
    /** Saturation multiplier (1 = unchanged, 0 = grayscale). */
    saturate: z.number().min(0).max(3).optional(),
    /** Grayscale amount (0 = full color, 1 = fully gray). */
    grayscale: z.number().min(0).max(1).optional(),
    /** Background layer opacity (1 = opaque). */
    opacity: z.number().min(0).max(1).optional(),
    /** Tint wash color drawn over the image (e.g. to darken for contrast). */
    tintColor: hexOrCssColor.optional(),
    /** Tint wash opacity (0 = invisible). Defaults to 0.3 at render time. */
    tintOpacity: z.number().min(0).max(1).optional(),
  })
  .strict();
export type BackgroundFilterConfig = z.infer<typeof backgroundFilterSchema>;

// ── Background ───────────────────────────────────────────────────────────────
export const backgroundSchema = z
  .object({
    kind: z.enum(["dots", "lines", "cross", "image", "none"]),
    color: hexOrCssColor.optional(),
    gap: z.number().positive().optional(),
    size: z.number().positive().optional(),
    /** Asset id for an image/tiled background. */
    assetRef: z.string().min(1).optional(),
    /** Optional visual filters/tint applied to an `image` background. */
    filter: backgroundFilterSchema.optional(),
  })
  .strict();
export type BackgroundConfig = z.infer<typeof backgroundSchema>;

// ── Motion ───────────────────────────────────────────────────────────────────
export const motionConfigSchema = z
  .object({
    /** Master toggle. Combined with `prefers-reduced-motion` at render time. */
    enabled: z.boolean(),
    /** Node mount animation (initial → animate). */
    entrance: z
      .object({
        initial: animatableSchema,
        animate: animatableSchema,
        transition: transitionSchema.optional(),
      })
      .strict()
      .optional(),
    /** whileHover target. */
    hover: animatableSchema.optional(),
    /** Continuous status-driven variants, keyed by `motionVariant` name. */
    perStatus: z.record(z.string(), motionVariantSchema).optional(),
  })
  .strict();
export type MotionConfig = z.infer<typeof motionConfigSchema>;

// ── Helper: a record requiring EVERY key of a fixed const tuple ──────────────
function fullRecord<K extends string, V extends z.ZodTypeAny>(
  keys: readonly K[],
  value: V,
) {
  const shape = Object.fromEntries(keys.map((k) => [k, value])) as Record<K, V>;
  return z.object(shape).strict();
}

// ── The Theme Pack ───────────────────────────────────────────────────────────
export const themePackSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** "vector" = CSS/SVG icons; "pixel" = crisp sprite rendering. */
    renderMode: z.enum(["vector", "pixel"]),
    kinds: fullRecord(NODE_KINDS, kindVisualSchema),
    statuses: fullRecord(VISUAL_STATUSES, statusVisualSchema),
    edges: fullRecord(EDGE_KINDS, edgeVisualSchema),
    background: backgroundSchema,
    motion: motionConfigSchema,
    /** Pack-bundled assets, keyed by the ids referenced via `assetRef`. */
    assets: z.record(z.string(), assetDefSchema).default({}),
  })
  .strict();

export type ThemePack = z.infer<typeof themePackSchema>;

/** Parse + validate an unknown value into a ThemePack (throws on invalid). */
export function parseThemePack(input: unknown): ThemePack {
  return themePackSchema.parse(input);
}

/** Safe parse variant for callers that want to handle errors themselves. */
export function safeParseThemePack(input: unknown) {
  return themePackSchema.safeParse(input);
}

// ── Compile-time no-drift guards (mirror lib/graph-constants.ts) ─────────────
// If the model adds a NodeKind / EdgeKind, or a NodeStatus that isn't in
// VISUAL_STATUSES, one of these fails to compile — forcing the pack contract to
// stay in sync with the source enums.
type _CheckKindCoverage =
  Exclude<NodeKind, keyof ThemePack["kinds"]> extends never
    ? true
    : ["themePack.kinds out of sync with NodeKind"];
type _CheckEdgeCoverage =
  Exclude<EdgeKind, keyof ThemePack["edges"]> extends never
    ? true
    : ["themePack.edges out of sync with EdgeKind"];
type _CheckStatusCoverage =
  Exclude<NodeStatus, VisualStatus> extends never
    ? true
    : ["VISUAL_STATUSES out of sync with NodeStatus"];

const _ckKind: _CheckKindCoverage = true;
const _ckEdge: _CheckEdgeCoverage = true;
const _ckStatus: _CheckStatusCoverage = true;
void _ckKind;
void _ckEdge;
void _ckStatus;
