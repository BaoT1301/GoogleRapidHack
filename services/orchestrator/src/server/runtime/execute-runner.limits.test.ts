import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExecuteRunner } from "./execute-runner";
import { ProcessManager } from "./process-manager";
import { InMemoryRunRepository } from "./run-repository";
import type { RuntimeEvent } from "./types";

describe("ExecuteRunner circuit breaker limits", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    for (const tempRoot of tempRoots.splice(0)) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("truncates patch preview while preserving patchLength", async () => {
    const rootRepoPath = await mkdtemp(path.join(os.tmpdir(), "runner-limits-"));
    tempRoots.push(rootRepoPath);
    const worktreePath = path.join(rootRepoPath, ".orchestrator", "worktrees", "run_patch", "node_patch");
    const patch = `diff --git a/big.md b/big.md\n${"x".repeat(20_000)}`;
    const repository = new InMemoryRunRepository();
    repository.createRun({
      runId: "run_patch",
      source: "graph",
      nodeIds: ["node_patch"],
    });

    const runner = new ExecuteRunner(
      createStubWorktreeManager(worktreePath, "agent/run_patch/node_patch", patch, ["big.md"]),
      new StubProcessManager({
        exitCode: 0,
        stdoutText: `<!-- orch:output -->\n{"summary":"ok","filesChanged":["big.md"],"status":"ready_for_review"}`,
        stderrText: "",
        cancelled: false,
        timedOut: false,
        outputLimitExceeded: false,
      }),
      repository,
    );

    const result = await runner.run({
      ownerId: "owner_patch",
      runId: "run_patch",
      nodeId: "node_patch",
      rootRepoPath,
      baseRef: "HEAD",
      prompt: "Create a big patch",
      cli: "fake",
    });

    const patchEvent = repository.getRun("run_patch")?.events.find(
      (event): event is RuntimeEvent & { payload: { patchPreview: string; patchLength: number } } =>
        event.type === "node.patch",
    );

    expect(result.status).toBe("success");
    expect(result.patchLength).toBe(patch.length);
    expect(patchEvent?.payload.patchLength).toBe(patch.length);
    expect(Buffer.byteLength(patchEvent?.payload.patchPreview ?? "", "utf8")).toBeLessThanOrEqual(8 * 1024);
  });

  it("marks timeout results failed and emits node.failed reason timeout", async () => {
    const rootRepoPath = await mkdtemp(path.join(os.tmpdir(), "runner-timeout-"));
    tempRoots.push(rootRepoPath);
    const repository = createRepository("run_timeout", "node_timeout");
    const runner = new ExecuteRunner(
      createStubWorktreeManager(
        path.join(rootRepoPath, ".orchestrator", "worktrees", "run_timeout", "node_timeout"),
        "agent/run_timeout/node_timeout",
        "",
        [],
      ),
      new StubProcessManager({
        exitCode: null,
        stdoutText: "",
        stderrText: "",
        cancelled: true,
        timedOut: true,
        outputLimitExceeded: false,
      }),
      repository,
    );

    const result = await runner.run({
      ownerId: "owner_timeout",
      runId: "run_timeout",
      nodeId: "node_timeout",
      rootRepoPath,
      baseRef: "HEAD",
      prompt: "Timeout",
      cli: "fake",
      timeoutMs: 1_000,
    });

    expect(result.status).toBe("failed");
    expect(repository.getRun("run_timeout")?.events.some((event) =>
      event.type === "node.failed" && event.payload.reason === "timeout"
    )).toBe(true);
  });

  it("marks hard output limit results failed", async () => {
    const rootRepoPath = await mkdtemp(path.join(os.tmpdir(), "runner-output-limit-"));
    tempRoots.push(rootRepoPath);
    const repository = createRepository("run_output_limit", "node_output_limit");
    const runner = new ExecuteRunner(
      createStubWorktreeManager(
        path.join(rootRepoPath, ".orchestrator", "worktrees", "run_output_limit", "node_output_limit"),
        "agent/run_output_limit/node_output_limit",
        "",
        [],
      ),
      new StubProcessManager({
        exitCode: null,
        stdoutText: "x".repeat(128),
        stderrText: "",
        cancelled: true,
        timedOut: false,
        outputLimitExceeded: true,
        outputLimitReason: "stdout_limit_exceeded",
      }),
      repository,
    );

    const result = await runner.run({
      ownerId: "owner_output_limit",
      runId: "run_output_limit",
      nodeId: "node_output_limit",
      rootRepoPath,
      baseRef: "HEAD",
      prompt: "Output limit",
      cli: "fake",
    });

    expect(result.status).toBe("failed");
    expect(repository.getRun("run_output_limit")?.events.some((event) =>
      event.type === "node.failed" && event.payload.reason === "output_limit_exceeded"
    )).toBe(true);
  });

  it("caps persisted event payloads emitted by subprocess streaming", async () => {
    const rootRepoPath = await mkdtemp(path.join(os.tmpdir(), "runner-event-cap-"));
    tempRoots.push(rootRepoPath);
    const repository = createRepository("run_event_cap", "node_event_cap");
    const runner = new ExecuteRunner(
      createStubWorktreeManager(
        path.join(rootRepoPath, ".orchestrator", "worktrees", "run_event_cap", "node_event_cap"),
        "agent/run_event_cap/node_event_cap",
        "",
        [],
      ),
      new StubProcessManager({
        exitCode: 0,
        stdoutText: `<!-- orch:output -->\n{"summary":"ok","filesChanged":[],"status":"ready_for_review"}`,
        stderrText: "",
        cancelled: false,
        timedOut: false,
        outputLimitExceeded: false,
        emittedEvents: [{
          type: "node.stdout",
          runId: "run_event_cap",
          nodeId: "node_event_cap",
          timestamp: new Date().toISOString(),
          payload: { line: "x".repeat(40_000) },
        }],
      }),
      repository,
    );

    const result = await runner.run({
      ownerId: "owner_event_cap",
      runId: "run_event_cap",
      nodeId: "node_event_cap",
      rootRepoPath,
      baseRef: "HEAD",
      prompt: "Emit large stdout event",
      cli: "fake",
    });

    const stdoutEvent = repository.getRun("run_event_cap")?.events.find((event) =>
      event.type === "node.stdout" && event.nodeId === "node_event_cap"
    );

    expect(result.status).toBe("success");
    expect(stdoutEvent?.payload).toEqual(expect.objectContaining({
      truncated: true,
      originalPayloadBytes: expect.any(Number),
      preview: expect.any(String),
    }));
    expect(Buffer.byteLength(JSON.stringify(stdoutEvent?.payload ?? {}), "utf8")).toBeLessThanOrEqual(17 * 1024);
  });
});

class StubProcessManager extends ProcessManager {
  constructor(
    private readonly result: {
      exitCode: number | null;
      stdoutText: string;
      stderrText: string;
      cancelled: boolean;
      timedOut: boolean;
      outputLimitExceeded: boolean;
      outputLimitReason?: string;
      emittedEvents?: RuntimeEvent[];
    },
  ) {
    super();
  }

  override async startProcess(input: Parameters<ProcessManager["startProcess"]>[0]): Promise<{
    exitCode: number | null;
    stdoutText: string;
    stderrText: string;
    cancelled: boolean;
    timedOut: boolean;
    outputLimitExceeded: boolean;
    outputLimitReason?: string;
  }> {
    for (const event of this.result.emittedEvents ?? []) {
      input.onEvent(event);
    }

    return this.result;
  }
}

function createStubWorktreeManager(
  worktreePath: string,
  branchName: string,
  patch: string,
  changedFiles: string[],
) {
  return {
    ensureOrchestratorGitignore: async () => undefined,
    createWorktree: async () => ({
      worktreePath,
      branchName,
      baseRef: "HEAD",
    }),
    getDiff: async () => patch,
    getChangedFiles: async () => changedFiles,
    listChangedPaths: async () => changedFiles,
    removeWorktree: async () => ({
      status: "noop" as const,
      worktreeRemoved: false,
      branchDeleted: false,
    }),
  };
}

function createRepository(runId: string, nodeId: string): InMemoryRunRepository {
  const repository = new InMemoryRunRepository();
  repository.createRun({
    runId,
    source: "graph",
    nodeIds: [nodeId],
  });
  return repository;
}
