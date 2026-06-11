/**
 * Per-user canvas appearance overrides applied on top of the selected Theme
 * Pack. Pure + framework-free so the provider and tests share one source of
 * truth. Mirrors `ICanvasConfig` in `db/models/settings.model.ts`.
 */
import type { ThemePack } from "./schema";

export interface CanvasConfig {
  /** Master motion on/off — overrides the pack's `motion.enabled`. */
  motionEnabled?: boolean;
  /** Override the pack's canvas background style. */
  backgroundKind?: "dots" | "lines" | "cross" | "none";
}

/**
 * Return a pack with the user's config overrides applied. Returns the SAME
 * reference when there's nothing to override (cheap for memoization).
 */
export function applyCanvasConfig(
  pack: ThemePack,
  config: CanvasConfig | null | undefined,
): ThemePack {
  if (!config || (config.motionEnabled === undefined && !config.backgroundKind)) {
    return pack;
  }
  let next = pack;
  if (config.motionEnabled !== undefined) {
    next = { ...next, motion: { ...next.motion, enabled: config.motionEnabled } };
  }
  // The per-user grid override (dots/lines/cross/none) only applies to
  // grid-style packs. An `image` background is an explicit, more-specific
  // choice authored in the pack builder (with its own asset + filters), so it
  // always wins over the generic grid override — otherwise selecting a custom
  // image-background pack would silently fall back to a grid for any user who
  // had ever set the background override.
  if (config.backgroundKind && pack.background.kind !== "image") {
    next = {
      ...next,
      background: { ...next.background, kind: config.backgroundKind },
    };
  }
  return next;
}
