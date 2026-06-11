"use client";

import { useCallback } from "react";
import Link from "next/link";
import { ReactFlowProvider } from "@xyflow/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, WarningIcon } from "@phosphor-icons/react";
import { useTRPC } from "@/trpc/client";
import { WorkspaceEditor } from "@/components/canvas/WorkspaceEditor";
import { CanvasThemeProvider } from "@/components/canvas/CanvasThemeProvider";
import type { CanvasConfig } from "@/lib/canvas-theme/config";
import type { ThemePack } from "@/lib/canvas-theme";
import { RepoBadge } from "@/components/canvas/RepoBadge";
import { specToFlow } from "@/components/canvas/serialize";
import type { INodeSpec, IEdgeSpec } from "@/db/models/graph.model";

export function Workspace({
  graphId,
  defaultPersona,
}: {
  graphId: string;
  defaultPersona?: string;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const graph = useQuery(trpc.graphs.getById.queryOptions({ id: graphId }));
  const settings = useQuery(trpc.settings.get.queryOptions());
  const userPacks = useQuery(trpc.themePacks.list.queryOptions());
  const update = useMutation(trpc.graphs.update.mutationOptions());

  const onSave = useCallback(
    async (spec: { nodes: INodeSpec[]; edges: IEdgeSpec[] }) => {
      await update.mutateAsync({
        id: graphId,
        nodes: spec.nodes,
        edges: spec.edges,
      });
      qc.invalidateQueries({ queryKey: trpc.graphs.list.queryKey() });
    },
    [graphId, update, qc, trpc.graphs.list],
  );

  if (graph.isLoading) {
    return <CenterNote>Loading graph…</CenterNote>;
  }
  if (graph.isError || !graph.data) {
    return (
      <CenterNote>
        <WarningIcon size={20} className="text-danger" />
        Graph not found.
        <Link href="/dashboard" className="text-accent hover:underline">
          Back to dashboard
        </Link>
      </CenterNote>
    );
  }

  const { nodes, edges } = specToFlow(
    (graph.data.nodes as INodeSpec[]) ?? [],
    (graph.data.edges as IEdgeSpec[]) ?? [],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-5 py-2.5">
        <Link
          href="/dashboard"
          className="grid h-7 w-7 place-items-center rounded-sm text-faint transition-colors hover:bg-hover hover:text-content"
          aria-label="Back to dashboard"
        >
          <ArrowLeftIcon size={15} />
        </Link>
        <h1 className="text-sm font-semibold tracking-tight text-content">
          {graph.data.name}
        </h1>
        <div className="ml-auto">
          <RepoBadge graphId={graphId} />
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <CanvasThemeProvider
          initialPackId={
            (settings.data as { canvasThemePackId?: string | null } | undefined)
              ?.canvasThemePackId ?? undefined
          }
          initialConfig={
            (settings.data as { canvasConfig?: CanvasConfig } | undefined)
              ?.canvasConfig ?? undefined
          }
          extraPacks={(userPacks.data as ThemePack[] | undefined) ?? undefined}
        >
          <ReactFlowProvider>
            <WorkspaceEditor
              key={graphId}
              graphId={graphId}
              initialNodes={nodes}
              initialEdges={edges}
              defaultPersona={defaultPersona}
              rootRepoPath={graph.data.rootRepoPath}
              planId={(graph.data as { planId?: string }).planId}
              onSave={onSave}
            />
          </ReactFlowProvider>
        </CanvasThemeProvider>
      </div>
    </div>
  );
}

function CenterNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted">
      {children}
    </div>
  );
}
