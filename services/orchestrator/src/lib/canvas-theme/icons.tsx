"use client";

/**
 * Icon registry — resolves a schema {@link IconName} string to a Phosphor icon
 * component. Kept separate from `schema.ts` so the schema stays React/Phosphor
 * free (importable by server + tests). The canvas resolves vector icons through
 * `iconForName()`; pixel/image packs use `assetRef` instead and never touch this.
 */
import type { ComponentType } from "react";
import {
  NotePencilIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  FileTextIcon,
  ShieldCheckIcon,
  StackIcon,
  ArrowsClockwiseIcon,
  GraphIcon,
  CubeIcon,
  SparkleIcon,
  type IconProps,
} from "@phosphor-icons/react";
import type { IconName } from "./schema";

export const ICON_REGISTRY: Record<IconName, ComponentType<IconProps>> = {
  "note-pencil": NotePencilIcon,
  lightning: LightningIcon,
  "magnifying-glass": MagnifyingGlassIcon,
  "file-text": FileTextIcon,
  "shield-check": ShieldCheckIcon,
  stack: StackIcon,
  "arrows-clockwise": ArrowsClockwiseIcon,
  graph: GraphIcon,
  cube: CubeIcon,
  sparkle: SparkleIcon,
};

/** Resolve an icon name to its component. Falls back to `cube` if unknown. */
export function iconForName(
  name: IconName | undefined,
): ComponentType<IconProps> {
  return (name && ICON_REGISTRY[name]) || ICON_REGISTRY.cube;
}
