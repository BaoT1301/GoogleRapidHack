"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";

/**
 * Project Readiness — a single, honest checklist of whether a project is ready to plan:
 * is the repo a git tree, is the codebase indexed (counts + source), are embeddings
 * present, and is the KB up to date with the repo. It surfaces the `kb.status` health
 * warnings (no more silent/empty KB) and offers a one-click re-sync. This is the
 * onboarding anchor: at a glance the user knows what's ready and what to do next.
 */
type Status = {
  repo: { isGitRepo: boolean };
  kb: {
    synced: boolean;
    source?: string;
    fileCount: number;
    symbolCount: number;
    vectorCount: number;
    indexedAt: string | Date | null;
    stale: boolean;
  };
  ok: boolean;
  warnings: string[];
};

export function ProjectReadiness({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const statusQ = useQuery(trpc.kb.status.queryOptions({ projectId }));
  const status = statusQ.data as Status | undefined;

  const syncMut = useMutation(
    trpc.kb.sync.mutationOptions({
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: trpc.kb.status.queryKey({ projectId }) });
        qc.invalidateQueries({ queryKey: trpc.kb.get.queryKey({ projectId }) });
      },
    }),
  );

  return (
    <div className="rounded-xl border border-border bg-panel/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-content">Project readiness</span>
        <button
          onClick={() => syncMut.mutate({ projectId })}
          disabled={syncMut.isPending}
          className="rounded-md border border-border bg-content/5 px-3 py-1 text-xs text-content hover:bg-content/10 disabled:opacity-50"
        >
          {syncMut.isPending ? "Syncing…" : status?.kb.synced ? "Re-sync" : "Sync now"}
        </button>
      </div>

      {statusQ.isLoading && <div className="text-xs text-faint">Checking…</div>}

      {statusQ.isError && (
        <div className="text-xs text-red-400">
          {(statusQ.error as { message?: string })?.message ?? "Could not load readiness"}
        </div>
      )}

      {status && (
        <div className="space-y-1.5">
          <Row
            ok={status.repo.isGitRepo}
            warn
            label="Git repository"
            detail={status.repo.isGitRepo ? undefined : "not a git repo — change detection off"}
          />
          <Row
            ok={status.kb.synced && status.kb.symbolCount > 0}
            label="Codebase indexed"
            detail={
              status.kb.synced
                ? `${status.kb.fileCount} files · ${status.kb.symbolCount} symbols${
                    status.kb.source ? ` · ${status.kb.source}` : ""
                  }`
                : "not synced yet"
            }
          />
          <Row
            ok={status.kb.vectorCount > 0}
            warn
            label="Embeddings"
            detail={
              status.kb.vectorCount > 0
                ? `${status.kb.vectorCount} vectors`
                : "none — keyword-only search"
            }
          />
          <Row
            ok={!status.kb.stale}
            warn
            label="Up to date"
            detail={
              status.kb.stale
                ? "re-sync needed"
                : status.kb.indexedAt
                  ? `synced ${new Date(status.kb.indexedAt).toLocaleString()}`
                  : undefined
            }
          />

          {status.warnings.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-border pt-2">
              {status.warnings.map((w, i) => (
                <li key={i} className="text-[11px] text-amber-400/90">
                  • {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {syncMut.isError && (
        <div className="mt-2 text-xs text-red-400">
          {(syncMut.error as { message?: string })?.message ?? "Sync failed"}
        </div>
      )}
    </div>
  );
}

/** One checklist line. `ok` → green; else amber when `warn`, red otherwise. */
function Row({
  ok,
  warn,
  label,
  detail,
}: {
  ok: boolean;
  warn?: boolean;
  label: string;
  detail?: string;
}) {
  const color = ok ? "bg-emerald-400" : warn ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden />
      <span className="text-content">{label}</span>
      {detail && <span className="text-faint">— {detail}</span>}
    </div>
  );
}
