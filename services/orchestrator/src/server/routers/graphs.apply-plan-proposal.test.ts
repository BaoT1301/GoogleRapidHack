import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel, type IEdgeSpec, type INodeSpec } from "../../db/models/graph.model";
import { RunModel } from "../../db/models/run.model";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";

const createCaller = createCallerFactory(appRouter);
const ME = "test_user_plan_apply";
const OTHER = "test_user_plan_apply_other";
const me = createCaller({ userId: ME });
const other = createCaller({ userId: OTHER });

beforeAll(async () => {
  await connectDB();
  await GraphModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await RunModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
});

afterAll(async () => {
  await GraphModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await RunModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await disconnectDB();
});

describe("graphs.applyPlanNodeProposal", () => {
  it("requires confirm true", async () => {
    await expect(
      me.graphs.applyPlanNodeProposal({
        graphId: "graph",
        runId: "run",
        nodeId: "plan",
        confirm: false,
      } as never),
    ).rejects.toThrow();
  });

  it("rejects wrong owner", async () => {
    const { graphId, runId } = await seedGraphAndRun();

    await expect(
      other.graphs.applyPlanNodeProposal({
        graphId,
        runId,
        nodeId: "plan",
        confirm: true,
      }),
    ).rejects.toThrow("graph not found");
  });

  it("rejects missing run or node", async () => {
    const graph = await GraphModel.create({
      ownerId: ME,
      name: "Missing run",
      baseBranch: "main",
      nodes: [planNode()],
      edges: [],
      status: "draft",
    });

    await expect(
      me.graphs.applyPlanNodeProposal({
        graphId: String(graph._id),
        runId: new Types.ObjectId().toHexString(),
        nodeId: "plan",
        confirm: true,
      }),
    ).rejects.toThrow("run not found");

    const runId = new Types.ObjectId().toHexString();
    await RunModel.create({
      _id: runId,
      graphId: String(graph._id),
      ownerId: ME,
      graphSnapshot: { nodes: [planNode()], edges: [] },
      nodeRuns: new Map(),
      status: "running",
    });

    await expect(
      me.graphs.applyPlanNodeProposal({
        graphId: String(graph._id),
        runId,
        nodeId: "plan",
        confirm: true,
      }),
    ).rejects.toThrow("node run not found");
  });

  it("rejects non-Plan or missing proposals", async () => {
    const graph = await GraphModel.create({
      ownerId: ME,
      name: "Bad plan output",
      baseBranch: "main",
      nodes: [planNode()],
      edges: [],
      status: "draft",
    });
    const runId = new Types.ObjectId().toHexString();
    await RunModel.create({
      _id: runId,
      graphId: String(graph._id),
      ownerId: ME,
      graphSnapshot: { nodes: [planNode()], edges: [] },
      nodeRuns: new Map([
        ["plan", { nodeId: "plan", status: "blocked", attempt: 0, events: [], outputs: { plan: { kind: "execute" } } }],
      ]),
      status: "running",
    });

    await expect(
      me.graphs.applyPlanNodeProposal({
        graphId: String(graph._id),
        runId,
        nodeId: "plan",
        confirm: true,
      }),
    ).rejects.toThrow("node does not contain Plan output");

    await RunModel.updateOne(
      { _id: runId, ownerId: ME },
      { $set: { "nodeRuns.plan.outputs.plan": { kind: "plan", status: "proposal_ready" } } },
    );

    await expect(
      me.graphs.applyPlanNodeProposal({
        graphId: String(graph._id),
        runId,
        nodeId: "plan",
        confirm: true,
      }),
    ).rejects.toThrow("Plan output has no graph proposal");
  });

  it("rejects invalid proposals and flow cycles", async () => {
    const { graphId, runId } = await seedGraphAndRun({
      currentEdges: [{ id: "flow_ab", source: "node_a", target: "node_b", kind: "flow" }],
      proposedEdges: [{ id: "flow_ba", source: "node_b", target: "node_a", kind: "flow" }],
    });

    await expect(
      me.graphs.applyPlanNodeProposal({
        graphId,
        runId,
        nodeId: "plan",
        confirm: true,
      }),
    ).rejects.toThrow("That would create a cycle");
  });

  it("applies a valid proposal additively and marks the Plan output applied", async () => {
    const { graphId, runId } = await seedGraphAndRun();

    const updated = await me.graphs.applyPlanNodeProposal({
      graphId,
      runId,
      nodeId: "plan",
      confirm: true,
    });

    expect(updated.nodes.map((node) => node.id)).toEqual(["plan", "node_a", "node_b"]);
    expect(updated.edges.map((edge) => edge.id)).toEqual(["edge_ab"]);

    const run = await RunModel.findOne({ _id: runId, ownerId: ME }).lean();
    const nodeRun = (run?.nodeRuns as Record<string, { outputs?: Record<string, unknown>; events?: unknown[] }>).plan;
    const planOutput = nodeRun.outputs?.plan as Record<string, unknown>;
    expect(planOutput.applied).toBe(true);
    expect(planOutput.appliedGraphId).toBe(graphId);
    expect(typeof planOutput.appliedAt).toBe("string");
    expect(nodeRun.events?.some((event) => {
      const payload = (event as { payload?: { type?: string } }).payload;
      return payload?.type === "node.plan.applied";
    })).toBe(true);
  });
});

async function seedGraphAndRun(input?: {
  currentEdges?: IEdgeSpec[];
  proposedEdges?: IEdgeSpec[];
}): Promise<{ graphId: string; runId: string }> {
  const currentNodes = [planNode(), nodeA(), nodeB()];
  const currentEdges = input?.currentEdges ?? [];
  const proposedNodes = input?.currentEdges ? [] : [nodeA(), nodeB()];
  const proposedEdges = input?.proposedEdges ?? [{ id: "edge_ab", source: "node_a", target: "node_b", kind: "flow" as const }];

  const graph = await GraphModel.create({
    ownerId: ME,
    name: `Plan apply ${Date.now()} ${Math.random()}`,
    baseBranch: "main",
    nodes: input?.currentEdges ? currentNodes : [planNode()],
    edges: currentEdges,
    status: "draft",
  });
  const runId = new Types.ObjectId().toHexString();
  await RunModel.create({
    _id: runId,
    graphId: String(graph._id),
    ownerId: ME,
    graphSnapshot: { nodes: graph.nodes, edges: graph.edges },
    nodeRuns: new Map([
      [
        "plan",
        {
          nodeId: "plan",
          status: "blocked",
          attempt: 0,
          events: [],
          outputs: {
            plan: {
              kind: "plan",
              status: "proposal_ready",
              provider: "cloud",
              objective: "Improve graph",
              prompt: "Add execute nodes",
              resultType: "graph_spec",
              warnings: [],
              generatedAt: new Date().toISOString(),
              graphProposal: {
                proposedNodes,
                proposedEdges,
                rawGraphSpecPreview: { preview: true },
              },
            },
          },
        },
      ],
    ]),
    status: "running",
  });

  return { graphId: String(graph._id), runId };
}

function planNode(): INodeSpec {
  return {
    id: "plan",
    kind: "plan",
    label: "Plan",
    position: { x: 0, y: 0 },
    status: "pending",
    data: { objective: "Improve graph", prompt: "Add execute nodes" },
  };
}

function nodeA(): INodeSpec {
  return {
    id: "node_a",
    kind: "execute",
    label: "A",
    position: { x: 220, y: 0 },
    status: "pending",
    data: { cli: "fake", prompt: "A" },
  };
}

function nodeB(): INodeSpec {
  return {
    id: "node_b",
    kind: "execute",
    label: "B",
    position: { x: 440, y: 0 },
    status: "pending",
    data: { cli: "fake", prompt: "B" },
  };
}
