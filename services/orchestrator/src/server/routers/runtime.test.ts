import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";

const mocks = vi.hoisted(() => {
  class MockRuntimeCleanupConflictError extends Error {}
  return {
    findOne: vi.fn(),
    updateOne: vi.fn(),
    inspect: vi.fn(),
    cleanup: vi.fn(),
    previewMergedCleanup: vi.fn(),
    applyMergedCleanup: vi.fn(),
    applyMerge: vi.fn(),
    MockRuntimeCleanupConflictError,
  };
});

vi.mock("@/db/client", () => ({
  connectDB: vi.fn(async () => undefined),
}));

vi.mock("@/db/models/run.model", () => ({
  EVENT_LEVELS: ["info", "warn", "error", "tool", "stdout", "stderr"],
  RunModel: {
    findOne: mocks.findOne,
    updateOne: mocks.updateOne,
  },
}));

vi.mock("../runtime/git-merge-coordinator", () => ({
  GitMergeCoordinator: vi.fn().mockImplementation(() => ({
    applyMerge: mocks.applyMerge,
  })),
}));

vi.mock("../runtime/runtime-storage-manager", () => ({
  RuntimeCleanupConflictError: mocks.MockRuntimeCleanupConflictError,
  RuntimeStorageManager: vi.fn().mockImplementation(() => ({
    inspect: mocks.inspect,
    cleanup: mocks.cleanup,
    previewMergedCleanup: mocks.previewMergedCleanup,
    applyMergedCleanup: mocks.applyMergedCleanup,
  })),
}));

vi.mock("../runtime/run-executor", () => ({
  sharedProcessManager: {
    getProcessState: vi.fn(() => "not_found"),
  },
}));

vi.mock("../runtime/cli-capabilities", () => ({
  getAllCliCapabilities: vi.fn(async () => ({
    fake: { available: true, command: "node", verified: true },
    codex: {
      available: true,
      command: "codex",
      version: "codex-cli test-version",
      verified: true,
      warnings: ["probe required for model compatibility"],
    },
    kiro: { available: false, command: "kiro-cli", experimental: true, verified: false },
    gemini: {
      available: true,
      command: "gemini",
      version: "0.45.1",
      verified: true,
      requiresApiKey: true,
    },
    claude: { available: false, command: "claude", verified: false },
  })),
}));

vi.mock("../runtime/codex-probe", () => ({
  runCodexProbe: vi.fn(async (cwd: string) => ({
    ok: true,
    classification: "authenticated",
    marker: "AGENT_LOOM_CODEX_PROBE_OK",
    stdoutPreview: `probe:${cwd}`,
    stderrPreview: "",
  })),
}));

const createCaller = createCallerFactory(appRouter);

describe("runtime router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  });

  const ownedRun = {
    _id: "run_1",
    ownerId: "runtime_user",
    graphSnapshot: { rootRepoPath: "/tmp/repo" },
    nodeRuns: {
      node_1: {
        nodeId: "node_1",
        status: "success",
        worktreePath: "/tmp/repo/.orchestrator/worktrees/run_1/node_1",
        branchName: "agent/run_1/node_1",
        outputs: {
          merge: {
            apply: {
              status: "merged",
              targetBranch: "main",
              sourceBranch: "agent/run_1/node_1",
              strategy: "squash",
              appliedAt: "2026-06-07T00:00:00.000Z",
              mergeCommit: "abc123",
            },
          },
        },
      },
    },
  };

  it("returns passive CLI capabilities to authenticated users", async () => {
    const caller = createCaller({ userId: "runtime_user" });

    const capabilities = await caller.runtime.cliCapabilities();

    expect(capabilities.codex.command).toBe("codex");
    expect(capabilities.codex.version).toBe("codex-cli test-version");
  });

  it("keeps Codex probe behind an explicit mutation", async () => {
    const caller = createCaller({ userId: "runtime_user" });

    const result = await caller.runtime.probeCodex({ cwd: "/tmp/repo" });

    expect(result).toMatchObject({
      ok: true,
      classification: "authenticated",
    });
    expect(result.stdoutPreview).toBe("probe:/tmp/repo");
  });

  it("requires authentication", async () => {
    const caller = createCaller({ userId: null });

    await expect(caller.runtime.cliCapabilities()).rejects.toThrow("UNAUTHORIZED");
  });

  it("inspects storage for an owned run using the snapshot root repo path", async () => {
    mocks.findOne.mockReturnValueOnce({ lean: vi.fn(async () => ownedRun) });
    mocks.inspect.mockResolvedValueOnce({
      rootRepoPath: "/tmp/repo",
      orchestratorRoot: "/tmp/repo/.orchestrator",
      disk: { freeBytes: 10, totalBytes: 20, warningLevel: "ok" },
      totals: {
        runtimeBytes: 0,
        agentWorktreeBytes: 0,
        mergeWorktreeBytes: 0,
        tempBytes: 0,
        agentWorktreeCount: 0,
        mergeWorktreeCount: 0,
      },
      runs: [],
    });
    const caller = createCaller({ userId: "runtime_user" });

    await expect(caller.runtime.storageInspect({ runId: "run_1" })).resolves.toMatchObject({
      rootRepoPath: "/tmp/repo",
    });
    expect(mocks.findOne).toHaveBeenCalledWith({ _id: "run_1", ownerId: "runtime_user" });
    expect(mocks.inspect).toHaveBeenCalledWith("/tmp/repo");
  });

  it("cleans only an owned run and maps active cleanup to conflict", async () => {
    mocks.findOne.mockReturnValueOnce({ lean: vi.fn(async () => ownedRun) });
    mocks.cleanup.mockRejectedValueOnce(new mocks.MockRuntimeCleanupConflictError("still running"));
    const caller = createCaller({ userId: "runtime_user" });

    await expect(
      caller.runtime.cleanup({
        scope: "node",
        runId: "run_1",
        nodeId: "node_1",
        confirm: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "still running" });
    expect(mocks.cleanup).toHaveBeenCalledWith({
      rootRepoPath: "/tmp/repo",
      scope: "node",
      runId: "run_1",
      nodeId: "node_1",
      confirm: true,
      discardAgentChanges: undefined,
      discardMergeResults: undefined,
    });
  });

  it("requires nodeId for node cleanup", async () => {
    mocks.findOne.mockReturnValueOnce({ lean: vi.fn(async () => ownedRun) });
    const caller = createCaller({ userId: "runtime_user" });

    await expect(
      caller.runtime.cleanup({
        scope: "node",
        runId: "run_1",
        confirm: true,
      }),
    ).rejects.toThrow("nodeId is required");
  });

  it("previews merged cleanup for an owned run without trusting client ownerId", async () => {
    mocks.findOne.mockReturnValueOnce({ lean: vi.fn(async () => ownedRun) });
    mocks.previewMergedCleanup.mockResolvedValueOnce({
      status: "preview_ready",
      checks: [{ name: "merge proof", passed: true }],
      runId: "run_1",
      nodeId: "node_1",
      targetBranch: "main",
      sourceBranch: "agent/run_1/node_1",
      worktreePath: "/tmp/repo/.orchestrator/worktrees/run_1/node_1",
      wouldRemoveWorktree: true,
      wouldDeleteBranch: true,
      wouldRemoveMergeWorktrees: false,
      warnings: [],
      message: "ready",
    });
    const caller = createCaller({ userId: "runtime_user" });

    const result = await caller.runtime.cleanupMergedPreview({
      runId: "run_1",
      nodeId: "node_1",
      targetBranch: "main",
    });

    expect(result).toMatchObject({ status: "preview_ready", wouldDeleteBranch: true });
    expect(mocks.findOne).toHaveBeenCalledWith({ _id: "run_1", ownerId: "runtime_user" });
    expect(mocks.previewMergedCleanup).toHaveBeenCalledWith({
      ownerId: "runtime_user",
      rootRepoPath: "/tmp/repo",
      runId: "run_1",
      nodeId: "node_1",
      targetBranch: "main",
      sourceBranch: "agent/run_1/node_1",
      worktreePath: "/tmp/repo/.orchestrator/worktrees/run_1/node_1",
      nodeStatus: "success",
      merge: {
        status: "merged",
        targetBranch: "main",
        sourceBranch: "agent/run_1/node_1",
        strategy: "squash",
        appliedAt: "2026-06-07T00:00:00.000Z",
        mergeCommit: "abc123",
        conflictFiles: undefined,
      },
      discardMergeResults: undefined,
      forceBranchDelete: undefined,
    });
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { _id: "run_1", ownerId: "runtime_user" },
      expect.objectContaining({
        $set: expect.objectContaining({
          "nodeRuns.node_1.outputs.cleanup.status": "preview_ready",
        }),
      }),
    );
  });

  it("applies merged cleanup for an owned run and persists compact result metadata", async () => {
    mocks.findOne.mockReturnValueOnce({ lean: vi.fn(async () => ownedRun) });
    mocks.applyMergedCleanup.mockResolvedValueOnce({
      status: "cleaned",
      checks: [{ name: "merge proof", passed: true }],
      runId: "run_1",
      nodeId: "node_1",
      targetBranch: "main",
      sourceBranch: "agent/run_1/node_1",
      worktreePath: "/tmp/repo/.orchestrator/worktrees/run_1/node_1",
      removedWorktree: true,
      deletedBranch: true,
      removedMergeWorktrees: [],
      deletedMergeBranches: [],
      warnings: [],
      message: "cleaned",
    });
    const caller = createCaller({ userId: "runtime_user" });

    const result = await caller.runtime.cleanupMergedApply({
      runId: "run_1",
      nodeId: "node_1",
      targetBranch: "main",
      confirm: true,
    });

    expect(result).toMatchObject({ status: "cleaned", removedWorktree: true, deletedBranch: true });
    expect(mocks.applyMergedCleanup).toHaveBeenCalledWith({
      ownerId: "runtime_user",
      rootRepoPath: "/tmp/repo",
      runId: "run_1",
      nodeId: "node_1",
      targetBranch: "main",
      sourceBranch: "agent/run_1/node_1",
      worktreePath: "/tmp/repo/.orchestrator/worktrees/run_1/node_1",
      nodeStatus: "success",
      merge: {
        status: "merged",
        targetBranch: "main",
        sourceBranch: "agent/run_1/node_1",
        strategy: "squash",
        appliedAt: "2026-06-07T00:00:00.000Z",
        mergeCommit: "abc123",
        conflictFiles: undefined,
      },
      discardMergeResults: undefined,
      forceBranchDelete: undefined,
      confirm: true,
    });
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { _id: "run_1", ownerId: "runtime_user" },
      expect.objectContaining({
        $set: expect.objectContaining({
          "nodeRuns.node_1.outputs.cleanup.status": "cleaned",
          "nodeRuns.node_1.outputs.cleanup.removedWorktree": true,
          "nodeRuns.node_1.outputs.cleanup.deletedBranch": true,
        }),
      }),
    );
  });

  it("requires explicit confirmation before merged cleanup apply", async () => {
    const caller = createCaller({ userId: "runtime_user" });

    await expect(
      caller.runtime.cleanupMergedApply({
        runId: "run_1",
        nodeId: "node_1",
        targetBranch: "main",
      } as never),
    ).rejects.toThrow();
    expect(mocks.applyMergedCleanup).not.toHaveBeenCalled();
  });

  it("promotes one node worktree through the merge coordinator with explicit confirmation", async () => {
    mocks.findOne.mockReturnValueOnce({ lean: vi.fn(async () => ownedRun) });
    mocks.applyMerge.mockResolvedValueOnce({
      runId: "run_1",
      nodeId: "node_1",
      targetBranch: "main",
      sourceBranch: "agent/run_1/node_1",
      status: "merged",
      mergeCommit: "abc123",
      message: "merged in isolated worktree",
    });
    const caller = createCaller({ userId: "runtime_user" });

    const result = await caller.runtime.promoteNodeWorktree({
      runId: "run_1",
      nodeId: "node_1",
      targetBranch: "main",
      strategy: "squash",
      confirm: true,
    });

    expect(result).toMatchObject({ status: "merged", mergeCommit: "abc123" });
    expect(mocks.applyMerge).toHaveBeenCalledWith({
      rootRepoPath: "/tmp/repo",
      runId: "run_1",
      nodeId: "node_1",
      targetBranch: "main",
      sourceBranch: "agent/run_1/node_1",
      worktreePath: "/tmp/repo/.orchestrator/worktrees/run_1/node_1",
      strategy: "squash",
      commitMessage: undefined,
      runChecks: undefined,
    });
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { _id: "run_1", ownerId: "runtime_user" },
      expect.objectContaining({
        $set: expect.objectContaining({
          "nodeRuns.node_1.outputs.promotion": expect.objectContaining({
            status: "merged",
            mergeCommit: "abc123",
          }),
        }),
      }),
    );
  });

  it("requires explicit confirmation before promotion", async () => {
    const caller = createCaller({ userId: "runtime_user" });

    await expect(
      caller.runtime.promoteNodeWorktree({
        runId: "run_1",
        nodeId: "node_1",
        targetBranch: "main",
        strategy: "squash",
      } as never),
    ).rejects.toThrow();
    expect(mocks.applyMerge).not.toHaveBeenCalled();
  });
});
