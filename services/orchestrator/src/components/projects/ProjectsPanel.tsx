"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { ProjectReadiness } from "@/components/projects/ProjectReadiness";

/**
 * Projects + Codebase-KB panel (Cloud Infra demo surface).
 *
 * Drives the whole pipeline from the UI against the shipped procedures:
 *   create project → kb.sync (repo → DB, owner-scoped) → view the stored KB →
 *   kb.query (relevance retrieval) → plan.generate(projectId) (plan from the KB).
 * Isolated route (/dashboard/projects); does not touch the canvas.
 */
export function ProjectsPanel() {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const projectsQ = useQuery(trpc.projects.list.queryOptions());
  const projects = (projectsQ.data ?? []) as Array<{
    projectId: string;
    name: string;
    rootRepoPath?: string;
  }>;

  const [name, setName] = useState("");
  const [rootRepoPath, setRootRepoPath] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const refetchProjects = () =>
    qc.invalidateQueries({ queryKey: trpc.projects.list.queryKey() });

  const createMut = useMutation(
    trpc.projects.create.mutationOptions({
      onSuccess: (p: { projectId: string }) => {
        setName("");
        setRootRepoPath("");
        setSelected(p.projectId);
        void refetchProjects();
      },
    }),
  );

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-1 text-lg font-semibold text-content">Projects &amp; Codebase KB</h1>
      <p className="mb-6 text-xs text-muted">
        Throw a repo at it → its structural context is synced to the DB (scoped to you)
        → planning reasons from it.
      </p>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[20rem_1fr]">
        {/* Left: create + list */}
        <div className="space-y-4">
          <form
            className="space-y-2 rounded-xl border border-border bg-panel/60 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) {
                createMut.mutate({
                  name: name.trim(),
                  rootRepoPath: rootRepoPath.trim() || undefined,
                });
              }
            }}
          >
            <div className="text-xs font-medium text-content">New project</div>
            <input
              className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-content"
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs text-content"
              placeholder="Repo path (absolute) — optional"
              value={rootRepoPath}
              onChange={(e) => setRootRepoPath(e.target.value)}
            />
            <button
              type="submit"
              disabled={createMut.isPending || !name.trim()}
              className="w-full rounded-md border border-border bg-content/5 px-2 py-1 text-sm text-content hover:bg-content/10 disabled:opacity-50"
            >
              {createMut.isPending ? "Creating…" : "Create project"}
            </button>
          </form>

          <div className="rounded-xl border border-border bg-panel/60 p-2">
            <div className="px-2 py-1 text-xs font-medium text-muted">Your projects</div>
            {projects.length === 0 && (
              <div className="px-2 py-3 text-xs text-faint">No projects yet.</div>
            )}
            {projects.map((p) => (
              <button
                key={p.projectId}
                onClick={() => setSelected(p.projectId)}
                className={`block w-full truncate rounded-md px-2 py-1.5 text-left text-sm ${
                  selected === p.projectId
                    ? "bg-content/10 text-content"
                    : "text-muted hover:bg-content/5"
                }`}
                title={p.rootRepoPath}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Right: selected project detail */}
        <div>
          {selected ? (
            <ProjectDetail projectId={selected} />
          ) : (
            <div className="rounded-xl border border-border bg-panel/60 p-8 text-center text-sm text-faint">
              Select or create a project to sync its codebase and plan.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectDetail({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const kbQ = useQuery(trpc.kb.get.queryOptions({ projectId }));
  const kb = kbQ.data as
    | {
        source: string;
        repoSummary?: string;
        files?: string[];
        symbols?: string[];
        stats?: { fileCount?: number; symbolCount?: number; languages?: string[] };
        indexedAt?: string | Date;
      }
    | null
    | undefined;

  const syncMut = useMutation(
    trpc.kb.sync.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: trpc.kb.get.queryKey({ projectId }) }),
    }),
  );

  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const queryQ = useQuery(
    trpc.kb.query.queryOptions(
      { projectId, query: submitted },
      { enabled: submitted.length > 0 },
    ),
  );
  const hits = queryQ.data as
    | { found: boolean; symbols: string[]; files: string[] }
    | undefined;

  const [prompt, setPrompt] = useState("");
  const planMut = useMutation(trpc.plan.generate.mutationOptions());

  return (
    <div className="space-y-4">
      {/* Readiness checklist — repo/KB/embeddings/staleness + warnings + re-sync. */}
      <ProjectReadiness projectId={projectId} />

      {/* Sync */}
      <div className="rounded-xl border border-border bg-panel/60 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-content">Codebase KB</span>
          <button
            onClick={() => syncMut.mutate({ projectId })}
            disabled={syncMut.isPending}
            className="rounded-md border border-border bg-content/5 px-3 py-1 text-xs text-content hover:bg-content/10 disabled:opacity-50"
          >
            {syncMut.isPending ? "Syncing…" : "Sync repo → DB"}
          </button>
        </div>
        {syncMut.isError && (
          <div className="text-xs text-red-400">
            {(syncMut.error as { message?: string })?.message ?? "Sync failed"}
          </div>
        )}
        {kb ? (
          <div className="space-y-1 text-xs text-muted">
            <div>
              <span className="text-faint">source:</span> {kb.source} ·{" "}
              <span className="text-faint">files:</span> {kb.stats?.fileCount ?? kb.files?.length ?? 0} ·{" "}
              <span className="text-faint">symbols:</span> {kb.symbols?.length ?? 0}
              {kb.stats?.languages?.length ? ` · ${kb.stats.languages.join(", ")}` : ""}
            </div>
            {kb.indexedAt && (
              <div className="text-faint">
                last synced: {new Date(kb.indexedAt).toLocaleString()}
              </div>
            )}
            {kb.repoSummary && (
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-content/5 p-2 text-[11px] text-content">
                {kb.repoSummary}
              </pre>
            )}
          </div>
        ) : (
          <div className="text-xs text-faint">Not synced yet — click “Sync repo → DB”.</div>
        )}
      </div>

      {/* query_codebase */}
      <div className="rounded-xl border border-border bg-panel/60 p-4">
        <div className="mb-2 text-sm font-medium text-content">query_codebase (retrieval)</div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-content"
            placeholder="e.g. auth, billing, scheduler…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setSubmitted(query.trim())}
          />
          <button
            onClick={() => setSubmitted(query.trim())}
            className="rounded-md border border-border bg-content/5 px-3 py-1 text-xs text-content hover:bg-content/10"
          >
            Search
          </button>
        </div>
        {hits && (
          <div className="mt-2 space-y-1 text-xs text-muted">
            <div className="text-faint">{hits.symbols.length} symbols · {hits.files.length} files</div>
            {hits.symbols.slice(0, 12).map((s) => (
              <div key={s} className="truncate text-content">{s}</div>
            ))}
          </div>
        )}
      </div>

      {/* Plan */}
      <div className="rounded-xl border border-border bg-panel/60 p-4">
        <div className="mb-2 text-sm font-medium text-content">Plan from this codebase</div>
        <textarea
          className="mb-2 w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-content"
          rows={2}
          placeholder="What do you want to build? (uses the synced KB as context)"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button
          onClick={() => prompt.trim() && planMut.mutate({ prompt: prompt.trim(), projectId })}
          disabled={planMut.isPending || !prompt.trim()}
          className="rounded-md border border-border bg-content/5 px-3 py-1 text-xs text-content hover:bg-content/10 disabled:opacity-50"
        >
          {planMut.isPending ? "Planning…" : "Generate plan"}
        </button>
        {planMut.isError && (
          <div className="mt-2 text-xs text-red-400">
            {(planMut.error as { message?: string })?.message ?? "Plan failed"}
          </div>
        )}
        {planMut.data != null && (
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-content/5 p-2 text-[11px] text-content">
            {JSON.stringify(planMut.data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
