export type MergeStatus =
  | "not_requested"
  | "preview_ready"
  | "checks_running"
  | "checks_failed"
  | "merge_ready"
  | "merging"
  | "merged"
  | "conflicted"
  | "failed"
  | "aborted";

export interface MergePreviewRequest {
  rootRepoPath: string;
  runId: string;
  nodeId: string;
  targetBranch: string;
  sourceBranch?: string;
  worktreePath?: string;
}

export interface MergePreviewResponse {
  runId: string;
  nodeId: string;
  targetBranch: string;
  sourceBranch: string;
  worktreePath: string;
  status: MergeStatus;
  filesChanged: string[];
  commits: string[];
  diffStat: string;
  patchPreview: string;
  patchLength: number;
  canMergeCleanly?: boolean;
  hasPendingWorktreeChanges?: boolean;
  pendingWorktreeFiles?: string[];
  warnings: string[];
}

export interface MergeApplyRequest {
  rootRepoPath: string;
  runId: string;
  nodeId: string;
  targetBranch: string;
  sourceBranch?: string;
  worktreePath?: string;
  strategy?: "no-ff" | "squash";
  commitMessage?: string;
  runChecks?: boolean;
}

export interface MergeApplyResponse {
  runId: string;
  nodeId: string;
  targetBranch: string;
  sourceBranch: string;
  mergeBranchName?: string;
  status: MergeStatus;
  mergeCommit?: string;
  conflictFiles?: string[];
  stdoutPreview?: string;
  stderrPreview?: string;
  message: string;
}

export interface MergeAbortRequest {
  rootRepoPath: string;
  targetBranch: string;
  mergeWorktreePath?: string;
}
