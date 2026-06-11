"use client";

import {
  ArrowBendUpRightIcon,
  GitBranchIcon,
  PencilSimpleIcon,
  PlusCircleIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { CanvasSubgraphPatch, CanvasSubgraphPatchOperation } from "./graphPatch";

const GROUPS: Array<{
  type: CanvasSubgraphPatchOperation["type"];
  label: string;
  icon: React.ReactNode;
  tone: string;
}> = [
  {
    type: "updateNode",
    label: "Updated nodes",
    icon: <PencilSimpleIcon size={14} />,
    tone: "border-accent/25 bg-accent/5 text-accent",
  },
  {
    type: "addNode",
    label: "Added nodes",
    icon: <PlusCircleIcon size={14} />,
    tone: "border-success/25 bg-success/5 text-success",
  },
  {
    type: "deleteNode",
    label: "Deleted nodes",
    icon: <TrashIcon size={14} />,
    tone: "border-danger/25 bg-danger/5 text-danger",
  },
  {
    type: "addEdge",
    label: "Added edges",
    icon: <GitBranchIcon size={14} />,
    tone: "border-success/25 bg-success/5 text-success",
  },
  {
    type: "deleteEdge",
    label: "Deleted edges",
    icon: <TrashIcon size={14} />,
    tone: "border-danger/25 bg-danger/5 text-danger",
  },
  {
    type: "updateEdge",
    label: "Updated edges",
    icon: <ArrowBendUpRightIcon size={14} />,
    tone: "border-accent/25 bg-accent/5 text-accent",
  },
];

export function GraphPatchPreview({
  patch,
  provider,
  model,
  modelReason,
  className,
}: {
  patch: CanvasSubgraphPatch;
  provider: string;
  model: string;
  modelReason?: string;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-surface/70 p-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            Proposal preview
          </p>
          <h3 className="mt-1 text-sm font-semibold text-content">{patch.summary}</h3>
          {patch.rationale && (
            <p className="mt-1 text-xs leading-relaxed text-muted">{patch.rationale}</p>
          )}
        </div>
        <span className="shrink-0 rounded-full border border-border bg-panel px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-faint">
          {provider} · {model}
        </span>
      </div>
      {modelReason && (
        <p className="mt-2 rounded-md border border-accent/20 bg-accent/5 px-2 py-1.5 text-[11px] leading-relaxed text-muted">
          {modelReason}
        </p>
      )}

      {patch.warnings.length > 0 && (
        <div className="mt-3 space-y-1 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
          {patch.warnings.map((warning) => (
            <p key={warning} className="flex gap-2">
              <WarningIcon className="mt-0.5 shrink-0" size={13} /> {warning}
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {GROUPS.map((group) => {
          const operations = patch.operations.filter((operation) => operation.type === group.type);
          if (operations.length === 0) return null;
          return (
            <div key={group.type} className={cn("rounded-md border p-2", group.tone)}>
              <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-content">
                {group.icon}
                {group.label}
                <span className="ml-auto text-[10px] text-faint">{operations.length}</span>
              </div>
              <ul className="space-y-1 text-xs text-muted">
                {operations.map((operation, index) => (
                  <li key={`${operation.type}-${index}`} className="rounded bg-black/20 px-2 py-1">
                    {describeOperation(operation)}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function describeOperation(operation: CanvasSubgraphPatchOperation): string {
  switch (operation.type) {
    case "updateNode":
      return `Update node ${operation.nodeId}`;
    case "addNode":
      return `Add node ${operation.node.id} · ${operation.node.label}`;
    case "deleteNode":
      return `Delete node ${operation.nodeId}${operation.reason ? ` · ${operation.reason}` : ""}`;
    case "addEdge":
      return `Add ${operation.edge.kind} edge ${operation.edge.source} → ${operation.edge.target}`;
    case "deleteEdge":
      return `Delete edge ${operation.edgeId}${operation.reason ? ` · ${operation.reason}` : ""}`;
    case "updateEdge":
      return `Update edge ${operation.edgeId}`;
  }
}
