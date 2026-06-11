/**
 * Pure assembler for USER custom theme packs. Takes a base pack and a draft of
 * overrides (per-kind color + sprite, background, renderMode, motion on/off) and
 * produces a fully validated {@link ThemePack}. Framework/DB-free so the builder
 * UI, the server router, and tests all share one source of truth.
 *
 * Imported assets are referenced by their capability URL (`/api/assets/<id>`);
 * this helper wires them into `pack.assets` under stable keys and points the
 * relevant `assetRef`s at them. The pack `id` is a placeholder here — the server
 * assigns the real (ulid) id on persist.
 */
import type { NodeKind } from "@/db/models/graph.model";
import { NODE_KINDS } from "@/lib/graph-constants";
import {
  parseThemePack,
  VISUAL_STATUSES,
  type ThemePack,
  type VisualStatus,
  type BackgroundFilterConfig,
} from "./schema";

export type CustomBackgroundKind = "dots" | "lines" | "cross" | "image" | "none";

export interface CustomKindOverride {
  /** Hex/CSS color for the kind. */
  color?: string;
  /**
   * Imported sprite for the kind:
   *  - a capability URL (`/api/assets/<id>`) sets/replaces the sprite,
   *  - `null` explicitly CLEARS an existing sprite (edit mode),
   *  - `undefined` leaves whatever the base pack had (create mode).
   */
  assetUrl?: string | null;
  /** Render the sprite with crisp pixel edges. */
  pixelated?: boolean;
}

/**
 * Per-NODE-STATE override: a color and/or an imported sprite/gif overlay shown
 * on nodes in that status. Same `assetUrl` set/clear/inherit semantics as
 * {@link CustomKindOverride}.
 */
export interface CustomStatusOverride {
  color?: string;
  assetUrl?: string | null;
  pixelated?: boolean;
}

/**
 * Maps each user-facing "core" state to the full set of {@link VisualStatus}
 * keys it represents. In the builder's SIMPLE mode, editing a core state writes
 * the same look to its runtime aliases (e.g. `starting` mirrors `running`,
 * `completed` mirrors `success`, `queued` mirrors `pending`) so live runs stay
 * visually consistent without the user theming every internal state.
 */
export const STATUS_ALIAS_GROUPS: Record<string, VisualStatus[]> = {
  pending: ["pending", "queued"],
  running: ["running", "starting"],
  success: ["success", "completed"],
  failed: ["failed"],
  skipped: ["skipped"],
  cancelled: ["cancelled"],
};

/** The six core states surfaced by default in the builder (simple mode). */
export const CORE_STATUSES = Object.keys(STATUS_ALIAS_GROUPS) as VisualStatus[];

export interface CustomPackDraft {
  name: string;
  basePackId: string;
  renderMode?: "vector" | "pixel";
  motionEnabled?: boolean;
  background?: {
    kind: CustomBackgroundKind;
    /** Capability URL for an `image` background. */
    assetUrl?: string;
    pixelated?: boolean;
    /** Visual filters/tint for an `image` background (Task: bg filters). */
    filter?: BackgroundFilterConfig;
  };
  kinds?: Partial<Record<NodeKind, CustomKindOverride>>;
  /** Per-state color + sprite overrides, keyed by VisualStatus. */
  statuses?: Partial<Record<VisualStatus, CustomStatusOverride>>;
}

/** Placeholder id used before the server assigns the persisted ulid. */
export const DRAFT_PACK_ID = "__draft__";

/**
 * Assemble + validate a custom pack from a base pack and draft overrides.
 * Throws (via zod) if the result is not a valid ThemePack.
 */
export function buildCustomPack(
  base: ThemePack,
  draft: CustomPackDraft,
): ThemePack {
  // Deep clone so we never mutate the base (built-in) pack.
  const next: ThemePack = structuredClone(base);

  next.id = DRAFT_PACK_ID;
  next.name = draft.name;
  if (draft.renderMode) next.renderMode = draft.renderMode;
  if (draft.motionEnabled !== undefined) {
    next.motion = { ...next.motion, enabled: draft.motionEnabled };
  }

  const assets: ThemePack["assets"] = { ...next.assets };

  // Per-kind overrides: color + optional imported sprite.
  for (const kind of NODE_KINDS) {
    const ov = draft.kinds?.[kind];
    if (!ov) continue;
    const kindVisual = { ...next.kinds[kind] };
    if (ov.color !== undefined) kindVisual.color = ov.color;
    if (ov.assetUrl) {
      const key = `kind-${kind}`;
      assets[key] = { url: ov.assetUrl, pixelated: ov.pixelated ?? false };
      kindVisual.assetRef = key;
    } else if (ov.assetUrl === null && kindVisual.assetRef) {
      // Explicit clear (edit mode): drop the sprite + its now-unreferenced asset.
      delete assets[kindVisual.assetRef];
      delete kindVisual.assetRef;
    }
    next.kinds[kind] = kindVisual;
  }

  // Per-status overrides: color + optional imported sprite/gif overlay.
  for (const status of VISUAL_STATUSES) {
    const ov = draft.statuses?.[status];
    if (!ov) continue;
    const statusVisual = { ...next.statuses[status] };
    if (ov.color !== undefined) statusVisual.color = ov.color;
    if (ov.assetUrl) {
      const key = `status-${status}`;
      assets[key] = { url: ov.assetUrl, pixelated: ov.pixelated ?? false };
      statusVisual.assetRef = key;
    } else if (ov.assetUrl === null && statusVisual.assetRef) {
      // Explicit clear (edit mode): drop the sprite + its now-unreferenced asset.
      delete assets[statusVisual.assetRef];
      delete statusVisual.assetRef;
    }
    next.statuses[status] = statusVisual;
  }

  // Background override.
  if (draft.background) {
    const bg = { ...next.background, kind: draft.background.kind };
    if (draft.background.kind === "image" && draft.background.assetUrl) {
      assets.bg = {
        url: draft.background.assetUrl,
        pixelated: draft.background.pixelated ?? false,
      };
      bg.assetRef = "bg";
    } else {
      delete bg.assetRef;
    }
    // Visual filters/tint travel with the background (kept even for non-image
    // kinds is harmless — only the image layer reads them at render time).
    if (draft.background.filter) {
      bg.filter = draft.background.filter;
    } else {
      delete bg.filter;
    }
    next.background = bg;
  }

  next.assets = assets;

  // Validate the assembled result (throws on any contract violation).
  return parseThemePack(next);
}
