"use client";

import { useRef, useState, useEffect } from "react";
import { motion } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PlusIcon,
  UploadSimpleIcon,
  GraphIcon,
} from "@phosphor-icons/react";
import { useTRPC } from "@/trpc/client";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { GraphCard } from "@/components/dashboard/GraphCard";
import { CreateGraphDialog } from "@/components/dashboard/CreateGraphDialog";
import { SetupWizard } from "@/components/setup/SetupWizard";
import { EmptyState } from "@/components/ui/EmptyState";
import { isSetupComplete } from "@/lib/first-run";
import { downloadGraphSpec, parseGraphSpec } from "@/lib/graph-io";
import type { GraphListItem } from "@/trpc/types";

export function DashboardView() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<GraphListItem | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Open the first-run wizard once, client-side, when setup isn't complete.
  useEffect(() => {
    if (!isSetupComplete()) setWizardOpen(true);
  }, []);

  const graphs = useQuery(trpc.graphs.list.queryOptions());
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: trpc.graphs.list.queryKey() });

  const archive = useMutation(
    trpc.graphs.archive.mutationOptions({
      onSuccess: invalidate,
      onError: () => toast("Failed to archive graph", "error"),
    }),
  );
  const del = useMutation(
    trpc.graphs.delete.mutationOptions({
      onSuccess: () => {
        invalidate();
        setPendingDelete(null);
        toast("Graph deleted", "success");
      },
      onError: () => toast("Failed to delete graph", "error"),
    }),
  );
  const create = useMutation(trpc.graphs.create.mutationOptions());
  const update = useMutation(trpc.graphs.update.mutationOptions());

  async function onImportFile(file: File) {
    try {
      const spec = parseGraphSpec(await file.text());
      const g = await create.mutateAsync({
        name: spec.name,
        description: spec.description,
        rootRepoPath: spec.rootRepoPath,
        baseBranch: spec.baseBranch,
      });
      await update.mutateAsync({
        id: String((g as { _id: unknown })._id),
        nodes: spec.nodes,
        edges: spec.edges,
      });
      invalidate();
      toast(`Imported "${spec.name}"`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const list = graphs.data ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-content">
            Graphs
          </h1>
          <p className="mt-1 text-sm text-muted">
            Visual workflows for AI software engineering.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportFile(f);
              e.target.value = "";
            }}
          />
          <Button variant="ghost" onClick={() => fileRef.current?.click()}>
            <UploadSimpleIcon size={15} /> Import
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon size={15} weight="bold" /> New graph
          </Button>
        </div>
      </header>

      {graphs.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-60 animate-pulse rounded-lg border border-border bg-raised"
            />
          ))}
        </div>
      ) : list.length === 0 ? (
        <GraphsEmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((g) => (
            <GraphCard
              key={String((g as { _id: unknown })._id)}
              graph={g}
              onExport={downloadGraphSpec}
              onArchive={(x) =>
                archive.mutate({ id: String((x as { _id: unknown })._id) })
              }
              onDelete={setPendingDelete}
            />
          ))}
        </div>
      )}

      <CreateGraphDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <SetupWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete graph"
      >
        <p className="text-sm text-muted">
          Permanently delete{" "}
          <span className="text-content">{pendingDelete?.name}</span>? This
          cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPendingDelete(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={del.isPending}
            onClick={() =>
              pendingDelete &&
              del.mutate({
                id: String((pendingDelete as { _id: unknown })._id),
              })
            }
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function GraphsEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-xl border border-dashed border-border py-24"
    >
      <EmptyState
        icon={<GraphIcon size={24} weight="duotone" />}
        title="No graphs yet"
        description="Create a graph to start composing nodes on the canvas, or import an existing GraphSpec."
        action={
          <Button onClick={onCreate}>
            <PlusIcon size={15} weight="bold" /> New graph
          </Button>
        }
      />
    </motion.div>
  );
}
