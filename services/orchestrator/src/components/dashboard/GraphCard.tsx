"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  DownloadSimpleIcon,
  ArchiveIcon,
  TrashIcon,
  type IconProps,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";
import type { GraphListItem } from "@/trpc/types";
import type { NodeKind } from "@/db/models/graph.model";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tooltip } from "@/components/ui/Tooltip";
import { GraphThumbnail } from "@/components/dashboard/GraphThumbnail";
import { cn } from "@/lib/cn";

function timeAgo(value: unknown): string {
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) return "";
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  const units: [number, string][] = [
    [60, "s"],
    [60, "m"],
    [24, "h"],
    [7, "d"],
  ];
  let v = secs;
  let unit = "s";
  for (const [step, label] of units) {
    if (Math.abs(v) < step) break;
    v = Math.round(v / step);
    unit = label;
  }
  return `${v}${unit} ago`;
}

/** A labelled, always-visible card action. Wrapped in a Tooltip so the icon's
 *  meaning is discoverable on hover/focus without crowding the card with text. */
function CardAction({
  label,
  icon: Icon,
  onClick,
  danger,
}: {
  label: string;
  icon: ComponentType<IconProps>;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={(e) => {
          // Defensive: actions live outside the <Link>, but stop bubbling so a
          // future wrapping click target can't hijack the action.
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-sm text-faint",
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          danger
            ? "hover:bg-danger/10 hover:text-danger"
            : "hover:bg-hover hover:text-content",
        )}
      >
        <Icon size={16} />
      </button>
    </Tooltip>
  );
}

export function GraphCard({
  graph,
  onExport,
  onArchive,
  onDelete,
}: {
  graph: GraphListItem;
  onExport: (g: GraphListItem) => void;
  onArchive: (g: GraphListItem) => void;
  onDelete: (g: GraphListItem) => void;
}) {
  const id = String((graph as { _id: unknown })._id);
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const nodeCount = nodes.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="group rounded-lg border border-border bg-raised p-1.5 transition-colors hover:border-border-strong"
    >
      <div className="overflow-hidden rounded-md bg-panel-raised">
        {/* Clickable preview + summary — the whole upper area opens the graph. */}
        <Link href={`/dashboard/${id}`} className="block">
          <GraphThumbnail
            nodes={nodes.map((n) => ({
              id: n.id,
              kind: n.kind as NodeKind,
              position: n.position,
            }))}
            edges={edges.map((e) => ({ source: e.source, target: e.target }))}
            className="h-28 w-full rounded-none border-0 border-b border-border transition-opacity group-hover:opacity-90"
          />
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="truncate text-sm font-semibold tracking-tight text-content">
                {graph.name}
              </h3>
              <StatusBadge status={graph.status} />
            </div>
            <p className="mt-2 font-mono text-xs text-faint">
              {nodeCount} node{nodeCount === 1 ? "" : "s"} ·{" "}
              {timeAgo(graph.updatedAt)}
            </p>
          </div>
        </Link>

        {/* Always-visible, labelled action bar. */}
        <div className="flex items-center gap-1 border-t border-border px-3 py-2">
          <CardAction
            label="Export graph"
            icon={DownloadSimpleIcon}
            onClick={() => onExport(graph)}
          />
          <CardAction
            label="Archive graph"
            icon={ArchiveIcon}
            onClick={() => onArchive(graph)}
          />
          <CardAction
            label="Delete graph"
            icon={TrashIcon}
            onClick={() => onDelete(graph)}
            danger
          />
        </div>
      </div>
    </motion.div>
  );
}
