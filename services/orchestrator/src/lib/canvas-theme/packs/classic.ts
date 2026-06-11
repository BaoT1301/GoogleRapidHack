/**
 * "Classic" theme pack — reproduces the canvas's current hardcoded look EXACTLY
 * (the values previously living in `lib/graph-constants.ts` KIND_META/EDGE_META,
 * `lib/status.ts` STATUS_COLORS, `GraphNode.tsx` icons + entrance motion, and the
 * dot-grid `<Background>` in `Canvas.tsx`). `classic.parity.test.ts` pins every
 * value against those originals so this refactor cannot drift.
 *
 * `stale` is the one NEW status (UI-derived, see node-visual-state). Its styling
 * is authored here since the originals had no stale concept.
 */
import { parseThemePack, type ThemePack } from "../schema";

export const CLASSIC_PACK_ID = "classic";

export const classicPack: ThemePack = parseThemePack({
  id: CLASSIC_PACK_ID,
  name: "Classic",
  renderMode: "vector",

  // ← KIND_META (color + label) + KIND_ICONS (icon) from graph-constants/GraphNode
  kinds: {
    plan: { label: "Plan", color: "#4f9be0", icon: "note-pencil" },
    execute: { label: "Execute", color: "#8b7cff", icon: "lightning" },
    review: { label: "Review", color: "#d8a72b", icon: "magnifying-glass" },
    doc: { label: "Doc", color: "#46b85f", icon: "file-text" },
    gate: { label: "Gate", color: "#d8803f", icon: "shield-check" },
    context: { label: "Context", color: "#3fc8d6", icon: "stack" },
    loop: { label: "Loop", color: "#c77dff", icon: "arrows-clockwise" },
  },

  // ← STATUS_COLORS from lib/status.ts (rendered as a 2px dot today).
  statuses: {
    pending: { color: "#646b7a", indicator: "dot" },
    ready: { color: "#4f9be0", indicator: "dot" },
    running: { color: "#d8a72b", indicator: "dot", motionVariant: "pulse" },
    paused: { color: "#9a86ff", indicator: "dot" },
    success: { color: "#46b85f", indicator: "dot" },
    failed: { color: "#ef6b5c", indicator: "dot", motionVariant: "shake" },
    skipped: { color: "#6b7280", indicator: "dot" },
    blocked: { color: "#d8803f", indicator: "dot" },
    queued: { color: "#646b7a", indicator: "dot" },
    starting: { color: "#d8a72b", indicator: "dot", motionVariant: "pulse" },
    completed: { color: "#46b85f", indicator: "dot" },
    cancelled: { color: "#8b6f9c", indicator: "dot" },
    draft: { color: "#646b7a", indicator: "dot" },
    archived: { color: "#6b7280", indicator: "dot" },
    // NEW (UI-derived): a node that succeeded but whose inputs changed since the
    // last run. Amber dashed frame + slight desaturation + a slow fade. (Task 7
    // wires it in; Task 8 gives it the `fade` motion.)
    stale: {
      color: "#d8a72b",
      indicator: "ring",
      frame: "dashed",
      opacity: 0.72,
      motionVariant: "fade",
      label: "Stale — inputs changed since last run",
    },
  },

  // ← EDGE_META + serialize.edgeStyle (strokeWidth 1.5; only `flow` animated).
  edges: {
    flow: { label: "Flow", color: "#8b7cff", strokeWidth: 1.5, animated: true },
    data: { label: "Data", color: "#3fc8d6", strokeWidth: 1.5, animated: false },
    "attaches-to": {
      label: "Attaches",
      color: "#9aa1ad",
      strokeWidth: 1.5,
      animated: false,
    },
    loop: { label: "Loop", color: "#c77dff", strokeWidth: 1.5, animated: false },
  },

  // ← <Background color="rgba(255,255,255,0.06)" gap={22} /> in Canvas.tsx
  background: { kind: "dots", color: "rgba(255,255,255,0.06)", gap: 22 },

  // ← GraphNodeBody motion.div entrance + hover, plus status-driven variants.
  motion: {
    enabled: true,
    entrance: {
      initial: { opacity: 0, scale: 0.92 },
      animate: { opacity: 1, scale: 1 },
      transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] },
    },
    hover: { y: -1 },
    perStatus: {
      // running / starting → gentle attention pulse.
      pulse: {
        animate: { opacity: [1, 0.55, 1] },
        transition: {
          duration: 1.3,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        },
      },
      // failed → a single quick shake.
      shake: {
        animate: { x: [0, -3, 3, -2, 2, 0] },
        transition: { duration: 0.4, ease: "easeInOut" },
      },
      // stale → slow breathing fade to read as "dimmed / out of date".
      fade: {
        animate: { opacity: [0.72, 0.5, 0.72] },
        transition: {
          duration: 2.2,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        },
      },
    },
  },

  assets: {},
});
