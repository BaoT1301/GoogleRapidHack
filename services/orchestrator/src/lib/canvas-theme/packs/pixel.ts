/**
 * "Pixel" theme pack — the first custom game-asset pack. It exercises the full
 * asset pipeline: `renderMode: "pixel"` (crisp `image-rendering: pixelated`),
 * per-kind raster sprites (16×16 PNG data URIs), and an image (tiled) canvas
 * background. Sprites are bundled inline as data URIs so the pack works offline
 * with no DB seeding; user-imported assets (DB-backed) reference `/api/assets/<id>`
 * the same way.
 */
import { parseThemePack, type ThemePack } from "../schema";

export const PIXEL_PACK_ID = "pixel";

// 16×16 pixel-art chips (generated; see git history for scripts/gen-pixel-sprites).
const TILE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAK0lEQVR4nGNgYGD4TyGmkgFSCgYkYawGJKSVwfEQNYDiMBg1YMgbMGC5EQDMUUISWanYjQAAAABJRU5ErkJggg==";
const SPRITES: Record<string, string> = {
  plan: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALUlEQVR4nGMQjl/ynxLMQDUD/Gc/IAljNWDqw/9wPEQNoDgMRg0Y8gYMWG4EADb0gGLVTnHoAAAAAElFTkSuQmCC",
  execute:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAK0lEQVR4nGPwdzj8nxLMQDUDumv+k4SxGnDxEAIPUQMoDoNRA4a8AQOWGwEbjrtLPzPA0wAAAABJRU5ErkJggg==",
  review:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALUlEQVR4nGOYk83wnxLMQDUDbizXJgljNeD/20I4HqIGUBwGowYMeQMGLDcCAE3GaBo9s0arAAAAAElFTkSuQmCC",
  doc: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALElEQVR4nGPgqlH+TwlmoJoBbjviScJYDej5txSOh6gBFIfBqAFD3oABy40AFyQUwaI+P/UAAAAASUVORK5CYII=",
  gate: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALElEQVR4nGOY48L8nxLMQDUDbjTYk4SxGvD/WCscD1EDKA6DUQOGvAEDlhsBfVRNqqnzE+4AAAAASUVORK5CYII=",
  context:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALUlEQVR4nGNg7pn1nxLMQDUD7E9cIwljNaD1/384HqIGUBwGowYMeQMGLDcCAE5ikzX3ezBcAAAAAElFTkSuQmCC",
  loop: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALElEQVR4nGPodjz8nxLMQDUDjtf+JwljNeD/YQQeogZQHAajBgx5AwYsNwIA7ar3zTud6NYAAAAASUVORK5CYII=",
};

export const pixelPack: ThemePack = parseThemePack({
  id: PIXEL_PACK_ID,
  name: "Pixel",
  renderMode: "pixel",

  kinds: {
    plan: { label: "Plan", color: "#4f9be0", icon: "note-pencil", assetRef: "node-plan" },
    execute: { label: "Execute", color: "#8b7cff", icon: "lightning", assetRef: "node-execute" },
    review: { label: "Review", color: "#d8a72b", icon: "magnifying-glass", assetRef: "node-review" },
    doc: { label: "Doc", color: "#46b85f", icon: "file-text", assetRef: "node-doc" },
    gate: { label: "Gate", color: "#d8803f", icon: "shield-check", assetRef: "node-gate" },
    context: { label: "Context", color: "#3fc8d6", icon: "stack", assetRef: "node-context" },
    loop: { label: "Loop", color: "#c77dff", icon: "arrows-clockwise", assetRef: "node-loop" },
  },

  statuses: {
    pending: { color: "#646b7a", indicator: "dot" },
    ready: { color: "#4f9be0", indicator: "dot" },
    running: { color: "#ffd23f", indicator: "ring", motionVariant: "pulse" },
    paused: { color: "#9a86ff", indicator: "dot" },
    success: { color: "#3ad16a", indicator: "dot" },
    failed: { color: "#ff5c5c", indicator: "ring", motionVariant: "shake" },
    skipped: { color: "#6b7280", indicator: "dot" },
    blocked: { color: "#ff9a3f", indicator: "dot" },
    queued: { color: "#646b7a", indicator: "dot" },
    starting: { color: "#ffd23f", indicator: "ring", motionVariant: "pulse" },
    completed: { color: "#3ad16a", indicator: "dot" },
    cancelled: { color: "#8b6f9c", indicator: "dot" },
    draft: { color: "#646b7a", indicator: "dot" },
    archived: { color: "#6b7280", indicator: "dot" },
    stale: {
      color: "#ffd23f",
      indicator: "ring",
      frame: "dashed",
      opacity: 0.7,
      motionVariant: "fade",
      label: "Stale — inputs changed since last run",
    },
  },

  edges: {
    flow: { label: "Flow", color: "#8b7cff", strokeWidth: 2, animated: true },
    data: { label: "Data", color: "#3fc8d6", strokeWidth: 2, animated: false },
    "attaches-to": { label: "Attaches", color: "#9aa1ad", strokeWidth: 2, animated: false },
    loop: { label: "Loop", color: "#c77dff", strokeWidth: 2, animated: false },
  },

  background: { kind: "image", assetRef: "tile" },

  motion: {
    enabled: true,
    entrance: {
      initial: { opacity: 0, scale: 0.8 },
      animate: { opacity: 1, scale: 1 },
      // Snappy, linear entrance reads "retro".
      transition: { duration: 0.18, ease: "linear" },
    },
    hover: { y: -2 },
    perStatus: {
      pulse: {
        animate: { opacity: [1, 0.4, 1] },
        transition: { duration: 0.9, repeat: Number.POSITIVE_INFINITY, ease: "linear" },
      },
      shake: {
        animate: { x: [0, -4, 4, -3, 3, 0] },
        transition: { duration: 0.35, ease: "linear" },
      },
      fade: {
        animate: { opacity: [0.7, 0.4, 0.7] },
        transition: { duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "linear" },
      },
    },
  },

  assets: {
    tile: { url: TILE, pixelated: true, width: 16, height: 16 },
    "node-plan": { url: SPRITES.plan, pixelated: true, width: 16, height: 16 },
    "node-execute": { url: SPRITES.execute, pixelated: true, width: 16, height: 16 },
    "node-review": { url: SPRITES.review, pixelated: true, width: 16, height: 16 },
    "node-doc": { url: SPRITES.doc, pixelated: true, width: 16, height: 16 },
    "node-gate": { url: SPRITES.gate, pixelated: true, width: 16, height: 16 },
    "node-context": { url: SPRITES.context, pixelated: true, width: 16, height: 16 },
    "node-loop": { url: SPRITES.loop, pixelated: true, width: 16, height: 16 },
  },
});
