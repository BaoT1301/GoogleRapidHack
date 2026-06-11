import { describe, expect, it } from "vitest";
import { executeRunSnapshot } from "./run-executor";
import { InMemoryRunRepository } from "./run-repository";
import type { ExecuteRunnerInput, ExecuteRunnerSummary } from "./execute-runner";
import type { RuntimeEvent } from "./types";

describe("executeRunSnapshot scheduler wiring", () => {
  it("runs B only after A succeeds for A -> B flow edges", async () => {
    const order: string[] = [];
    const repo = createRepo("run_order");

    await executeRunSnapshot({
      runId: "run_order",
      ownerId: "owner_1",
      graphId: "graph_1",
      snapshot: {
        rootRepoPath: "/tmp/repo",
        baseBranch: "main",
        nodes: [executeNode("a"), executeNode("b")],
        edges: [{ source: "a", target: "b", kind: "flow" }],
      },
      runner: {
        run: async (input) => {
          order.push(input.nodeId);
          return summary(input, "success");
        },
      },
      runRepository: repo,
    });

    expect(order).toEqual(["a", "b"]);
  });

  it("skips downstream nodes when an upstream node fails", async () => {
    const published: RuntimeEvent[] = [];
    const repo = createRepo("run_skip");

    const result = await executeRunSnapshot({
      runId: "run_skip",
      ownerId: "owner_1",
      graphId: "graph_1",
      snapshot: {
        rootRepoPath: "/tmp/repo",
        baseBranch: "main",
        nodes: [executeNode("a"), executeNode("b")],
        edges: [{ source: "a", target: "b", kind: "flow" }],
      },
      runner: {
        run: async (input) => summary(input, input.nodeId === "a" ? "failed" : "success"),
      },
      runRepository: repo,
      publish: (_runId, event) => published.push(event),
    });

    expect(result.anyFailed).toBe(true);
    expect(result.results.map((entry) => [entry.node.id, entry.status])).toEqual([
      ["a", "failed"],
      ["b", "skipped"],
    ]);
    expect(published).toContainEqual(expect.objectContaining({
      type: "node.skipped",
      nodeId: "b",
      payload: {
        reason: "Dependency a did not complete successfully",
        upstreamNodeId: "a",
      },
    }));
    expect(repo.getRun("run_skip")?.events).toContainEqual(expect.objectContaining({
      type: "node.skipped",
      nodeId: "b",
      payload: {
        reason: "Dependency a did not complete successfully",
        upstreamNodeId: "a",
      },
    }));
    expect(repo.getRun("run_skip")?.nodeRuns.b?.status).toBe("skipped");
  });

  it("runs independent nodes in parallel up to max concurrency", async () => {
    const repo = createRepo("run_parallel");
    let active = 0;
    let maxActive = 0;

    await executeRunSnapshot({
      runId: "run_parallel",
      ownerId: "owner_1",
      graphId: "graph_1",
      maxConcurrency: 2,
      snapshot: {
        rootRepoPath: "/tmp/repo",
        baseBranch: "main",
        nodes: [
          executeNode("a"),
          executeNode("b"),
          executeNode("c"),
          executeNode("d"),
        ],
        edges: [],
      },
      runner: {
        run: async (input) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay(5);
          active -= 1;
          return summary(input, "success");
        },
      },
      runRepository: repo,
    });

    expect(maxActive).toBe(2);
  });
});

function createRepo(runId: string): InMemoryRunRepository {
  const repo = new InMemoryRunRepository();
  repo.createRun({
    runId,
    source: "graph",
    nodeIds: [],
  });
  return repo;
}

function executeNode(id: string) {
  return {
    id,
    kind: "execute",
    label: id,
    data: {
      cli: "fake",
      prompt: `Run ${id}`,
    },
  };
}

function summary(
  input: ExecuteRunnerInput,
  status: ExecuteRunnerSummary["status"],
): ExecuteRunnerSummary {
  return {
    runId: input.runId,
    nodeId: input.nodeId,
    status,
    worktreePath: `/tmp/repo/.orchestrator/worktrees/${input.runId}/${input.nodeId}`,
    branchName: `agent/${input.runId}/${input.nodeId}`,
    exitCode: status === "success" ? 0 : 1,
    patchLength: status === "success" ? 1 : 0,
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
