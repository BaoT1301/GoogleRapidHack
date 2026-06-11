import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel, type IEdgeSpec, type INodeSpec } from "../../db/models/graph.model";
import { clearSubgraphProposalsForTest, saveSubgraphProposal } from "../ai/proposal-store";
import type { SubgraphPatch } from "../ai/subgraph-patch";

const createCaller = createCallerFactory(appRouter);
const ME = "test_user_ai";
const OTHER = "test_user_ai_other";

const me = createCaller({ userId: ME });
const other = createCaller({ userId: OTHER });
let originalGeminiApiKey: string | undefined;

function node(id: string, x = 0): INodeSpec {
  return {
    id,
    kind: "execute",
    label: id,
    position: { x, y: 0 },
    status: "pending",
    data: { cli: "fake", prompt: `run ${id}` },
  };
}

function edge(id: string, source: string, target: string): IEdgeSpec {
  return { id, source, target, kind: "flow" };
}

async function createGraph(input?: { nodes?: INodeSpec[]; edges?: IEdgeSpec[] }) {
  return GraphModel.create({
    ownerId: ME,
    name: "AI patch test graph",
    status: "draft",
    baseBranch: "main",
    nodes: input?.nodes ?? [node("a"), node("b", 200)],
    edges: input?.edges ?? [edge("a-b", "a", "b")],
  });
}

beforeAll(async () => {
  await connectDB();
  await GraphModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
});

beforeEach(() => {
  originalGeminiApiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  process.env.ORCH_TEST_CODEX_AVAILABLE = "1";
});

afterEach(async () => {
  delete process.env.ORCH_AI_PATCH_MOCK;
  delete process.env.ORCH_TEST_CODEX_AVAILABLE;
  if (originalGeminiApiKey) process.env.GEMINI_API_KEY = originalGeminiApiKey;
  else delete process.env.GEMINI_API_KEY;
  clearSubgraphProposalsForTest();
  await GraphModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
});

afterAll(async () => {
  await GraphModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await disconnectDB();
});

describe("ai.modelCatalog", () => {
  it("returns exact backend-allowlisted model names including Codex CLI/GPT models", async () => {
    process.env.ORCH_AI_PATCH_MOCK = "1";
    const catalog = await me.ai.modelCatalog();

    const gemini = catalog.providers.find((provider) => provider.provider === "gemini");
    expect(gemini?.models.map((model) => model.id)).toEqual([
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
    ]);
    expect(catalog.providers.find((provider) => provider.provider === "openai")?.models.map((model) => model.id)).toContain("gpt-4.1");
    expect(catalog.providers.find((provider) => provider.provider === "claude")?.models.map((model) => model.id)).toContain("claude-sonnet-4");
    expect(catalog.providers.find((provider) => provider.provider === "codex")?.models.map((model) => model.id)).toEqual([
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4o",
      "gpt-4o-mini",
    ]);
    expect(JSON.stringify(catalog)).not.toMatch(/api[_-]?key|token|secret/i);
  });

  it("rejects disabled/unconfigured and arbitrary model ids", async () => {
    const graph = await createGraph();
    await expect(
      me.ai.proposeSubgraphPatch({
        graphId: String(graph._id),
        selectedNodeIds: ["a"],
        prompt: "fix this",
        provider: "gemini",
        model: "gemini-2.5-pro",
        mode: "fix",
      }),
    ).rejects.toThrow(/not enabled/i);

    process.env.ORCH_AI_PATCH_MOCK = "1";
    await expect(
      me.ai.proposeSubgraphPatch({
        graphId: String(graph._id),
        selectedNodeIds: ["a"],
        prompt: "fix this",
        provider: "gemini",
        model: "gemini-does-not-exist",
        mode: "fix",
      }),
    ).rejects.toThrow(/not allowlisted/i);
  });
});

describe("ai selected-subgraph patch contract", () => {
  it("validates selected nodes and does not mutate the graph during proposal generation", async () => {
    process.env.ORCH_AI_PATCH_MOCK = "1";
    const graph = await createGraph();

    await expect(
      me.ai.proposeSubgraphPatch({
        graphId: String(graph._id),
        selectedNodeIds: ["missing"],
        prompt: "fix this",
        provider: "gemini",
        model: "gemini-2.5-pro",
        mode: "fix",
      }),
    ).rejects.toThrow(/selected node not found/i);

    const before = await GraphModel.findById(graph._id).lean();
    const proposal = await me.ai.proposeSubgraphPatch({
      graphId: String(graph._id),
      selectedNodeIds: ["a"],
      prompt: "make this robust",
      provider: "gemini",
      model: "gemini-2.5-pro",
      mode: "improve",
    });
    const after = await GraphModel.findById(graph._id).lean();

    expect(proposal.patch.operations).toHaveLength(1);
    expect(after?.nodes).toEqual(before?.nodes);
    expect(after?.edges).toEqual(before?.edges);
  });

  it("auto-selects an enabled provider/model for graph patch proposals", async () => {
    process.env.ORCH_AI_PATCH_MOCK = "1";
    const graph = await createGraph();

    const proposal = await me.ai.proposeSubgraphPatch({
      graphId: String(graph._id),
      selectedNodeIds: ["a"],
      prompt: "make this robust",
      provider: "auto",
      model: "auto",
      mode: "improve",
    });

    expect(proposal).toMatchObject({
      provider: "codex",
      model: "gpt-4.1",
      modelSelection: {
        automatic: true,
        taskType: "graph_patch",
        reason: expect.stringMatching(/Codex CLI/i),
      },
    });
  });

  it("requires confirm true before applying a stored proposal", async () => {
    process.env.ORCH_AI_PATCH_MOCK = "1";
    const graph = await createGraph();
    const proposal = await me.ai.proposeSubgraphPatch({
      graphId: String(graph._id),
      selectedNodeIds: ["a"],
      prompt: "add tests",
      provider: "gemini",
      model: "gemini-2.5-pro",
      mode: "expand",
    });

    await expect(
      me.ai.applySubgraphPatch({
        graphId: String(graph._id),
        proposalId: proposal.proposalId,
        confirm: false,
      } as never),
    ).rejects.toThrow();
  });

  it("applies only after confirm and only for the owning user", async () => {
    process.env.ORCH_AI_PATCH_MOCK = "1";
    const graph = await createGraph();
    const proposal = await me.ai.proposeSubgraphPatch({
      graphId: String(graph._id),
      selectedNodeIds: ["a"],
      prompt: "improve error handling",
      provider: "gemini",
      model: "gemini-2.5-pro",
      mode: "improve",
    });

    await expect(
      other.ai.applySubgraphPatch({
        graphId: String(graph._id),
        proposalId: proposal.proposalId,
        confirm: true,
      }),
    ).rejects.toThrow("NOT_FOUND");

    const updated = await me.ai.applySubgraphPatch({
      graphId: String(graph._id),
      proposalId: proposal.proposalId,
      confirm: true,
    });
    const updatedNode = updated.nodes.find((entry) => entry.id === "a");
    expect(updatedNode?.notes).toContain("improve error handling");
    expect(updatedNode?.data.aiImprovementMode).toBe("improve");
  });

  it("rejects invalid node/edge references during apply", async () => {
    const graph = await createGraph();
    const badNodePatch: SubgraphPatch = {
      graphId: String(graph._id),
      selectedNodeIds: ["a"],
      summary: "bad",
      operations: [{ type: "updateNode", nodeId: "missing", patch: { label: "bad" } }],
      warnings: [],
    };
    const proposal = saveSubgraphProposal({
      ownerId: ME,
      graphId: String(graph._id),
      provider: "gemini",
      model: "gemini-2.5-pro",
      patch: badNodePatch,
    });

    await expect(
      me.ai.applySubgraphPatch({
        graphId: String(graph._id),
        proposalId: proposal.proposalId,
        confirm: true,
      }),
    ).rejects.toThrow(/node not found/i);
  });

  it("rejects cycle-producing patches", async () => {
    const graph = await createGraph({
      nodes: [node("a"), node("b", 200), node("c", 400)],
      edges: [edge("a-b", "a", "b"), edge("b-c", "b", "c")],
    });
    const cyclePatch: SubgraphPatch = {
      graphId: String(graph._id),
      selectedNodeIds: ["a", "b", "c"],
      summary: "cycle",
      operations: [{ type: "addEdge", edge: edge("c-a", "c", "a") }],
      warnings: [],
    };
    const proposal = saveSubgraphProposal({
      ownerId: ME,
      graphId: String(graph._id),
      provider: "gemini",
      model: "gemini-2.5-pro",
      patch: cyclePatch,
    });

    await expect(
      me.ai.applySubgraphPatch({
        graphId: String(graph._id),
        proposalId: proposal.proposalId,
        confirm: true,
      }),
    ).rejects.toThrow(/cycle/i);
  });
});
