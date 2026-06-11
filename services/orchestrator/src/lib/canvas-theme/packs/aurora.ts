/**
 * "Aurora" theme pack — a rich VECTOR pack (renderMode "vector"). It exercises
 * the layout/motion side of the contract without any imported assets: a distinct
 * palette, animated data edges, a cross-hatch background, and glow/scale status
 * variants. Demonstrates that a pack can re-skin the canvas purely via tokens +
 * motion (no sprites required).
 */
import { parseThemePack, type ThemePack } from "../schema";

export const AURORA_PACK_ID = "aurora";

export const auroraPack: ThemePack = parseThemePack({
  id: AURORA_PACK_ID,
  name: "Aurora",
  renderMode: "vector",

  kinds: {
    plan: { label: "Plan", color: "#5eead4", icon: "note-pencil" },
    execute: { label: "Execute", color: "#a78bfa", icon: "lightning" },
    review: { label: "Review", color: "#fcd34d", icon: "magnifying-glass" },
    doc: { label: "Doc", color: "#67e8f9", icon: "file-text" },
    gate: { label: "Gate", color: "#fb923c", icon: "shield-check" },
    context: { label: "Context", color: "#f0abfc", icon: "stack" },
    loop: { label: "Loop", color: "#c084fc", icon: "arrows-clockwise" },
  },

  statuses: {
    pending: { color: "#7c8499", indicator: "dot" },
    ready: { color: "#5eead4", indicator: "dot" },
    running: { color: "#fcd34d", indicator: "ring", motionVariant: "glow" },
    paused: { color: "#a78bfa", indicator: "dot" },
    success: { color: "#34d399", indicator: "dot" },
    failed: { color: "#fb7185", indicator: "ring", motionVariant: "shake" },
    skipped: { color: "#94a3b8", indicator: "dot" },
    blocked: { color: "#fb923c", indicator: "dot" },
    queued: { color: "#7c8499", indicator: "dot" },
    starting: { color: "#fcd34d", indicator: "ring", motionVariant: "glow" },
    completed: { color: "#34d399", indicator: "dot" },
    cancelled: { color: "#a78bfa", indicator: "dot" },
    draft: { color: "#7c8499", indicator: "dot" },
    archived: { color: "#94a3b8", indicator: "dot" },
    stale: {
      color: "#fcd34d",
      indicator: "ring",
      frame: "dashed",
      opacity: 0.75,
      motionVariant: "breathe",
      label: "Stale — inputs changed since last run",
    },
  },

  edges: {
    flow: { label: "Flow", color: "#a78bfa", strokeWidth: 1.75, animated: true },
    data: { label: "Data", color: "#67e8f9", strokeWidth: 1.75, animated: true },
    "attaches-to": { label: "Attaches", color: "#94a3b8", strokeWidth: 1.5, animated: false },
    loop: { label: "Loop", color: "#c084fc", strokeWidth: 1.75, animated: true },
  },

  background: { kind: "cross", color: "rgba(167,139,250,0.10)", gap: 26, size: 2 },

  motion: {
    enabled: true,
    entrance: {
      initial: { opacity: 0, scale: 0.9, y: 4 },
      animate: { opacity: 1, scale: 1, y: 0 },
      transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
    },
    hover: { y: -2, scale: 1.02 },
    perStatus: {
      glow: {
        animate: {
          boxShadow: [
            "0 0 0px rgba(252,211,77,0.0)",
            "0 0 14px rgba(252,211,77,0.55)",
            "0 0 0px rgba(252,211,77,0.0)",
          ],
        },
        transition: { duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" },
      },
      shake: {
        animate: { x: [0, -3, 3, -2, 2, 0] },
        transition: { duration: 0.42, ease: "easeInOut" },
      },
      breathe: {
        animate: { opacity: [0.75, 0.5, 0.75], scale: [1, 0.99, 1] },
        transition: { duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" },
      },
    },
  },

  assets: {},
});
