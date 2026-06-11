import { ulid } from "ulid";
import type { AppNode } from "@/components/canvas/serialize";

/** Map a React Flow selection payload to the selected node ids (multi-select). */
export function selectionIds(nodes: { id: string }[]): string[] {
  return nodes.map((n) => n.id);
}

/**
 * Which nodes a context-menu action targets: the current multi-selection when
 * the right-clicked node is part of it, otherwise just the right-clicked node.
 */
export function contextTargets(nodeId: string, selectedIds: string[]): string[] {
  return selectedIds.length > 1 && selectedIds.includes(nodeId)
    ? selectedIds
    : [nodeId];
}

/** Clone the given nodes with fresh ulids and an offset position (Duplicate). */
export function duplicateNodes(
  nodes: AppNode[],
  ids: string[],
  offset = 32,
): AppNode[] {
  const set = new Set(ids);
  return nodes
    .filter((n) => set.has(n.id))
    .map((n) => ({
      ...n,
      id: ulid(),
      selected: false,
      position: { x: n.position.x + offset, y: n.position.y + offset },
      data: { ...n.data, status: "pending" as const },
    }));
}
