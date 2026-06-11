"use client";

import { useQuery } from "@tanstack/react-query";
import { GitBranchIcon, FolderIcon } from "@phosphor-icons/react";
import { useTRPC } from "@/trpc/client";
import type { RepoInfo } from "@/server/graphs/repo-info";

/** Compact basename of a path (last non-empty segment). */
function repoName(path: string): string {
  const parts = path.replace(/\/+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/**
 * VIS-2 — workspace header badge showing the watched repo (auto-detected
 * `rootRepoPath` + git `remote@branch`). Read-only; fed by `graphs.repoInfo`.
 * Absent-safe: renders nothing when the graph has no `rootRepoPath`.
 */
export function RepoBadge({ graphId }: { graphId: string }) {
  const trpc = useTRPC();
  const q = useQuery(
    trpc.graphs.repoInfo.queryOptions({ graphId }, { refetchOnWindowFocus: false }),
  );
  const info = q.data as RepoInfo | undefined;
  if (!info?.rootRepoPath) return null;
  return <RepoBadgeView info={info} />;
}

/** Pure presentational badge (exported for isolated tests). */
export function RepoBadgeView({ info }: { info: RepoInfo }) {
  const branch = info.currentBranch ?? info.baseBranch;
  return (
    <div
      className="flex items-center gap-2 rounded-full border border-border bg-panel/80 px-3 py-1 text-[11px] text-muted backdrop-blur-xl"
      title={info.remoteUrl ?? info.rootRepoPath}
      aria-label={`Watched repository ${repoName(info.rootRepoPath ?? "")} on branch ${branch}`}
    >
      <FolderIcon size={12} className="shrink-0 text-faint" />
      <span className="max-w-[12rem] truncate font-medium text-content">
        {repoName(info.rootRepoPath ?? "")}
      </span>
      {info.isGitRepo ? (
        <span className="flex items-center gap-1 text-faint">
          <GitBranchIcon size={12} className="shrink-0" />
          {branch}
        </span>
      ) : (
        <span className="text-faint">not a git repo</span>
      )}
    </div>
  );
}
