import { describe, expect, it } from "vitest";
import type { AppEdge, AppNode } from "@/components/canvas/serialize";
import {
  applySubgraphPatchToCanvas,
  type CanvasSubgraphPatch,
} from "@/components/canvas/graphPatch";
import {
  createUndoSnapshot,
  popUndoSnapshot,
  pushUndoSnapshot,
} from "@/components/canvas/undoStack";

function node(id: string, x = 0): AppNode {
  return {
    id,
    type: "graphNode",
    position: { x, y: 0 },
    data: {
      kind: "execute",
      label: id,
      status: "pending",
      data: { prompt: `run ${id}` },
    },
  };
}

function edge(id: string, source: string, target: string): AppEdge {
  return {
    id,
    source,
    target,
    data: { kind: "flow" },
    animated: true,
  };
}

function patch(operations: CanvasSubgraphPatch["operations"]): CanvasSubgraphPatch {
  return {
    graphId: "graph_1",
    selectedNodeIds: ["a"],
    summary: "test patch",
    operations,
    warnings: ["review before applying"],
  };
}

describe("applySubgraphPatchToCanvas", () => {
  it("applies updateNode patches and reports changed node ids", () => {
    const result = applySubgraphPatchToCanvas({
      nodes: [node("a")],
      edges: [],
      patch: patch([
        {
          type: "updateNode",
          nodeId: "a",
          patch: {
            label: "Improved A",
            position: { x: 42 },
            data: { prompt: "new prompt" },
          },
        },
      ]),
    });

    expect(result.nodes[0].data.label).toBe("Improved A");
    expect(result.nodes[0].position).toEqual({ x: 42, y: 0 });
    expect(result.nodes[0].data.data.prompt).toBe("new prompt");
    expect(result.changedNodeIds).toEqual(["a"]);
    expect(result.warnings).toEqual(["review before applying"]);
  });

  it("adds nodes and edges and reports animation ids", () => {
    const result = applySubgraphPatchToCanvas({
      nodes: [node("a")],
      edges: [],
      patch: patch([
        {
          type: "addNode",
          node: {
            id: "b",
            kind: "execute",
            label: "B",
            position: { x: 120, y: 0 },
            data: { prompt: "run b" },
          },
        },
        {
          type: "addEdge",
          edge: { id: "a-b", source: "a", target: "b", kind: "flow" },
        },
      ]),
    });

    expect(result.nodes.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(result.edges.map((entry) => entry.id)).toEqual(["a-b"]);
    expect(result.addedNodeIds).toEqual(["b"]);
    expect(result.addedEdgeIds).toEqual(["a-b"]);
  });

  it("deleteNode removes connected edges and reports removed ids", () => {
    const result = applySubgraphPatchToCanvas({
      nodes: [node("a"), node("b")],
      edges: [edge("a-b", "a", "b")],
      patch: patch([{ type: "deleteNode", nodeId: "b" }]),
    });

    expect(result.nodes.map((entry) => entry.id)).toEqual(["a"]);
    expect(result.edges).toEqual([]);
    expect(result.removedNodeIds).toEqual(["b"]);
    expect(result.removedEdgeIds).toEqual(["a-b"]);
  });

  it("rejects invalid operations and duplicate node ids", () => {
    expect(() =>
      applySubgraphPatchToCanvas({
        nodes: [node("a")],
        edges: [],
        patch: patch([{ type: "updateNode", nodeId: "missing", patch: { label: "x" } }]),
      }),
    ).toThrow(/missing node/i);

    expect(() =>
      applySubgraphPatchToCanvas({
        nodes: [node("a")],
        edges: [],
        patch: patch([
          {
            type: "addNode",
            node: { id: "a", kind: "execute", label: "Duplicate", data: {} },
          },
        ]),
      }),
    ).toThrow(/duplicate node/i);
  });

  it("rejects edges with missing endpoints", () => {
    expect(() =>
      applySubgraphPatchToCanvas({
        nodes: [node("a")],
        edges: [],
        patch: patch([
          {
            type: "addEdge",
            edge: { id: "a-b", source: "a", target: "b", kind: "flow" },
          },
        ]),
      }),
    ).toThrow(/missing endpoint/i);
  });

  it("rejects flow-edge cycles", () => {
    expect(() =>
      applySubgraphPatchToCanvas({
        nodes: [node("a"), node("b"), node("c")],
        edges: [edge("a-b", "a", "b"), edge("b-c", "b", "c")],
        patch: patch([
          {
            type: "addEdge",
            edge: { id: "c-a", source: "c", target: "a", kind: "flow" },
          },
        ]),
      }),
    ).toThrow(/cycle/i);
  });
});

describe("canvas AI patch undo stack", () => {
  it("restores exact previous nodes/edges and reports reverse animation ids", () => {
    const beforeNodes = [node("a")];
    const beforeEdges: AppEdge[] = [];
    const snapshot = createUndoSnapshot({
      nodes: beforeNodes,
      edges: beforeEdges,
      proposalId: "proposal_1",
      now: new Date("2026-06-07T00:00:00.000Z"),
    });
    const stack = pushUndoSnapshot([], snapshot);

    const after = applySubgraphPatchToCanvas({
      nodes: beforeNodes,
      edges: beforeEdges,
      patch: patch([
        { type: "updateNode", nodeId: "a", patch: { label: "Changed" } },
        {
          type: "addNode",
          node: { id: "b", kind: "execute", label: "B", data: {} },
        },
        { type: "addEdge", edge: { id: "a-b", source: "a", target: "b", kind: "flow" } },
      ]),
    });

    const { stack: nextStack, undo } = popUndoSnapshot({
      stack,
      currentNodes: after.nodes,
      currentEdges: after.edges,
    });

    expect(nextStack).toEqual([]);
    expect(undo?.nodes).toEqual(beforeNodes);
    expect(undo?.edges).toEqual(beforeEdges);
    expect(undo?.snapshot).toMatchObject({
      reason: "ai_subgraph_patch",
      proposalId: "proposal_1",
      timestamp: "2026-06-07T00:00:00.000Z",
    });
    expect(undo?.changedNodeIds).toEqual(["a"]);
    expect(undo?.removedNodeIds).toEqual(["b"]);
    expect(undo?.removedEdgeIds).toEqual(["a-b"]);
  });
});
