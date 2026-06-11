import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel, RunModel } from "../../db/models";
import { sseHub } from "../sse/hub";
import { executeRun } from "./run-executor";

const generatePlanMock = vi.hoisted(() => vi.fn());
vi.mock("../plan/generate-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../plan/generate-plan")>();
  return { ...actual, generatePlan: generatePlanMock };
});

const ex = promisify(execFile);
const ME = "test_user_plan_node";
let repoPath = "";

beforeAll(async () => {
  process.env.ORCH_AUTO_MERGE = "false";
  await connectDB();
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
  repoPath = await mkdtemp(path.join(os.tmpdir(), "plannode-"));
  await ex("git", ["init"], { cwd: repoPath });
  await ex("git", ["config", "user.email", "t@t.co"], { cwd: repoPath });
  await ex("git", ["config", "user.name", "t"], { cwd: repoPath });
  await ex("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repoPath });
});

afterAll(async () => {
  delete process.env.ORCH_AUTO_MERGE;
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
  await rm(repoPath, { recursive: true, force: true });
  await disconnectDB();
});

beforeEach(async () => {
  generatePlanMock.mockReset();
  await GraphModel.deleteMany({ ownerId: ME });
  await RunModel.deleteMany({ ownerId: ME });
});

describe("executeRun Plan node runtime", () => {
  it("blocks and emits context_required when planner returns ContextRequest", async () => {
    generatePlanMock.mockResolvedValue(contextResult());
    const { runId } = await createRun({
      nodes: [planNode("plan", { objective: "Clarify auth" })],
      edges: [],
    });
    const frames = subscribeFrames(runId);

    await executeRun(runId, ME);
    frames.unsubscribe();

    const nodeRuns = await nodeRunsFor(runId);
    expect(nodeRuns.plan.status).toBe("blocked");
    expect(nodeRuns.plan.outputs.plan.status).toBe("context_required");
    expect(nodeRuns.plan.outputs.plan.contextRequest.questions).toHaveLength(1);
    expect(frames.data.some((f) => f.includes('"type":"node.plan.context_required"'))).toBe(true);
  });

  it("persists a graph proposal and does not mutate the graph", async () => {
    generatePlanMock.mockResolvedValue(graphSpecResult());
    const { runId, graphId } = await createRun({
      nodes: [planNode("plan", { objective: "Plan search" })],
      edges: [],
    });

    await executeRun(runId, ME);

    const nodeRuns = await nodeRunsFor(runId);
    expect(nodeRuns.plan.status).toBe("blocked");
    expect(nodeRuns.plan.outputs.plan.status).toBe("proposal_ready");
    expect(nodeRuns.plan.outputs.plan.graphProposal.proposedNodes).toHaveLength(1);

    const graph = await GraphModel.findById(graphId).lean();
    expect(graph?.nodes).toHaveLength(1);
    expect(graph?.nodes[0]?.kind).toBe("plan");
  });

  it("blocks downstream execution by default after proposal output", async () => {
    generatePlanMock.mockResolvedValue(graphSpecResult());
    const { runId } = await createRun({
      nodes: [
        planNode("plan", { objective: "Plan then stop" }),
        executeNode("exec"),
      ],
      edges: [{ id: "e1", source: "plan", target: "exec", kind: "flow" }],
    });

    await executeRun(runId, ME);

    const nodeRuns = await nodeRunsFor(runId);
    expect(nodeRuns.plan.status).toBe("blocked");
    expect(nodeRuns.exec.status).toBe("skipped");
    expect(
      nodeRuns.exec.events.some(
        (event: { payload?: { type?: string; reason?: string } }) =>
          event.payload?.type === "node.skipped" &&
          /Dependency plan/i.test(event.payload.reason ?? ""),
      ),
    ).toBe(true);
  });

  it("allows downstream execution when allowDownstreamAfterProposal is true", async () => {
    generatePlanMock.mockResolvedValue(graphSpecResult());
    const { runId } = await createRun({
      nodes: [
        planNode("plan", {
          objective: "Plan and continue",
          allowDownstreamAfterProposal: true,
        }),
        executeNode("exec"),
      ],
      edges: [{ id: "e1", source: "plan", target: "exec", kind: "flow" }],
    });

    await executeRun(runId, ME);

    const nodeRuns = await nodeRunsFor(runId);
    expect(nodeRuns.plan.status).toBe("success");
    expect(nodeRuns.exec.status).toBe("success");
  });

  it("marks invalid planner output as failed", async () => {
    generatePlanMock.mockResolvedValue({
      provider: "cloud",
      resultType: "graph_spec",
      warnings: ["invalid"],
      rawPreview: { type: "graph_spec", tracks: [] },
      rawResult: { type: "graph_spec", tracks: [] },
    });
    const { runId } = await createRun({
      nodes: [planNode("plan", { objective: "Bad output" })],
      edges: [],
    });

    await executeRun(runId, ME);

    const nodeRuns = await nodeRunsFor(runId);
    expect(nodeRuns.plan.status).toBe("failed");
    expect(nodeRuns.plan.outputs.plan.status).toBe("failed");
    expect(nodeRuns.plan.events.some((e: { payload?: { type?: string } }) => e.payload?.type === "node.plan.failed")).toBe(true);
  });

  it("marks provider errors as failed", async () => {
    generatePlanMock.mockRejectedValue(new Error("planner unavailable"));
    const { runId } = await createRun({
      nodes: [planNode("plan", { objective: "Provider error" })],
      edges: [],
    });

    await executeRun(runId, ME);

    const nodeRuns = await nodeRunsFor(runId);
    expect(nodeRuns.plan.status).toBe("failed");
    expect(nodeRuns.plan.outputs.plan.status).toBe("failed");
  });
});

function planNode(id: string, data: Record<string, unknown>) {
  return {
    id,
    kind: "plan",
    label: "Plan",
    position: { x: 0, y: 0 },
    status: "pending",
    data,
  };
}

function executeNode(id: string) {
  return {
    id,
    kind: "execute",
    label: "Execute",
    position: { x: 1, y: 0 },
    status: "pending",
    data: { cli: "fake" },
  };
}

async function createRun(input: {
  nodes: unknown[];
  edges: Array<{ id: string; source: string; target: string; kind: string }>;
}): Promise<{ runId: string; graphId: string }> {
  const graph = await GraphModel.create({
    ownerId: ME,
    name: "Plan node graph",
    rootRepoPath: repoPath,
    baseBranch: "HEAD",
    nodes: input.nodes,
    edges: input.edges,
  });
  const run = await RunModel.create({
    graphId: String(graph._id),
    ownerId: ME,
    graphSnapshot: graph.toObject(),
    status: "running",
    startedAt: new Date().toISOString(),
    nodeRuns: new Map(),
  });
  return { runId: String(run._id), graphId: String(graph._id) };
}

async function nodeRunsFor(runId: string): Promise<Record<string, any>> {
  const reloaded = await RunModel.findById(runId).lean();
  return reloaded?.nodeRuns as unknown as Record<string, any>;
}

function subscribeFrames(runId: string): { data: string[]; unsubscribe: () => void } {
  const data: string[] = [];
  const unsubscribe = sseHub.subscribe(runId, { write: (frame) => data.push(frame) });
  return { data, unsubscribe };
}

function contextResult() {
  return {
    provider: "cloud",
    resultType: "context_request",
    contextRequest: {
      type: "context_request",
      confidence: 0.4,
      readyToPlan: false,
      codebaseImpact: "Need auth details",
      approaches: [],
      questions: [{ id: "q1", text: "Which OAuth provider?" }],
      missingContext: [],
    },
    warnings: [],
    rawPreview: { type: "context_request" },
    rawResult: { type: "context_request" },
  };
}

function graphSpecResult() {
  return {
    provider: "cloud",
    resultType: "graph_spec",
    graphSpec: {
      type: "graph_spec",
      version: "1.0",
      featureName: "Search",
      sprintNumber: 1,
      tracks: [
        {
          id: "track-1",
          number: 1,
          execution: "SEQUENTIAL",
          persona: "backend_engineer",
          name: "Build API",
          status: "PENDING",
          overview: "Add endpoint.",
          checklist: ["route"],
          dependsOn: [],
        },
      ],
      missingContext: [],
    },
    warnings: [],
    rawPreview: { type: "graph_spec", featureName: "Search" },
    rawResult: { type: "graph_spec" },
  };
}
