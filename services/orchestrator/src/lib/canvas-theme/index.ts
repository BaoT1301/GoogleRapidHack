/**
 * Theme pack registry — the catalog of built-in packs the canvas can switch
 * between. Custom/game-asset packs (pixel, vector) are registered here as they
 * land (Task 12). `getPack` always resolves to a valid pack, falling back to
 * Classic so the canvas can never end up unthemed.
 */
import type { ThemePack } from "./schema";
import { classicPack, CLASSIC_PACK_ID } from "./packs/classic";
import { pixelPack } from "./packs/pixel";
import { auroraPack } from "./packs/aurora";

export { CLASSIC_PACK_ID } from "./packs/classic";
export { PIXEL_PACK_ID } from "./packs/pixel";
export { AURORA_PACK_ID } from "./packs/aurora";
export const DEFAULT_PACK_ID = CLASSIC_PACK_ID;

/** All built-in packs, keyed by id. */
export const THEME_PACKS: Record<string, ThemePack> = {
  [classicPack.id]: classicPack,
  [auroraPack.id]: auroraPack,
  [pixelPack.id]: pixelPack,
};

/** Resolve a pack id to a pack, falling back to the default (Classic). */
export function getPack(id: string | undefined | null): ThemePack {
  return (id && THEME_PACKS[id]) || THEME_PACKS[DEFAULT_PACK_ID];
}

/** Lightweight list for selectors (id + display name). */
export function listPacks(): { id: string; name: string }[] {
  return Object.values(THEME_PACKS).map((p) => ({ id: p.id, name: p.name }));
}

export type { ThemePack } from "./schema";
