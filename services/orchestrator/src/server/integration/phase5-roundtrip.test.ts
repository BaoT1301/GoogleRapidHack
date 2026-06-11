import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "../routers/app";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel } from "../../db/models/graph.model";
import type { INodeSpec, IEdgeSpec } from "../../db/models/graph.model";
import { specToFlow, flowToSpec } from "@/components/canvas/serialize";
import { edgeRenderProps } from "@/lib/canvas-theme/apply";
import { classicPack } from "@/lib/canvas-theme/packs/classic";

// Integration test (Track 7, integration_reviewer) — requires local Mongo.
// Verifies the canvas serialization layer round-trips through the REAL GraphSpec
// schema: canvas → flowToSpec → graphs.update → graphs.getById → specToFlow.
const createCaller = createCallerFactory(appRouter);
const ME = "test_user_p5_integration";
const me = createCaller({ userId: ME });

beforeAll(async () => {
  await connectDB();
  await GraphModel.deleteMany({ ownerId: ME });
});

afterAll(async () => {
  await GraphModel.deleteMany({ ownerId: ME });
  await disconnectDB();
});

describe("Phase 5 — canvas ↔ GraphSpec round-trip", () => {
  it("persists canvas nodes/edges and reloads them identically", async () => {
    const specNodes: INodeSpec[] = [
      {
        id: "n_exec",
        kind: "execute",
        label: "Build the API",
        position: { x: 0, y: 0 },
        status: "pending",
        data: { persona: "frontend_architect", cli: "fake", prompt: "do it" },
      },
      {
        id: "n_rev",
        kind: "review",
        label: "Review",
        position: { x: 240, y: 0 },
        status: "pending",
        data: {},
      },
    ];
    const specEdges: IEdgeSpec[] = [
      { id: "e_flow", source: "n_exec", target: "n_rev", kind: "flow", fanInMode: "all-of" },
      { id: "e_data", source: "n_exec", target: "n_rev", kind: "data", outputKey: "out", inputKey: "in" },
    ];

    // Simulate the canvas hydrate → serialize cycle.
    const flow = specToFlow(specNodes, specEdges);
    const saved = flowToSpec(flow.nodes, flow.edges);

    const graph = await me.graphs.create({ name: "Round-trip" });
    const id = String(graph._id);

    const updated = await me.graphs.update({
      id,
      nodes: saved.nodes,
      edges: saved.edges,
    });
    // The Mongoose schema enforces NODE_KINDS / EDGE_KINDS enums on the subdocs.
    expect(updated.nodes).toHaveLength(2);
    expect(updated.edges).toHaveLength(2);

    const loaded = await me.graphs.getById({ id });
    const loadedNodes = loaded.nodes as INodeSpec[];
    const loadedEdges = loaded.edges as IEdgeSpec[];

    // Node fidelity: kinds, labels, positions, kind-specific data.
    const exec = loadedNodes.find((n) => n.id === "n_exec")!;
    expect(exec.kind).toBe("execute");
    expect(exec.label).toBe("Build the API");
    expect(exec.position).toEqual({ x: 0, y: 0 });
    expect(exec.data).toMatchObject({ persona: "frontend_architect", cli: "fake", prompt: "do it" });

    // Edge fidelity: distinct kinds + their kind-specific keys survive.
    const flowEdge = loadedEdges.find((e) => e.kind === "flow")!;
    const dataEdge = loadedEdges.find((e) => e.kind === "data")!;
    expect(flowEdge.fanInMode).toBe("all-of");
    expect(dataEdge.outputKey).toBe("out");
    expect(dataEdge.inputKey).toBe("in");

    // Re-hydrating the loaded spec reproduces the canvas flow graph.
    const rehydrated = specToFlow(loadedNodes, loadedEdges);
    expect(rehydrated.nodes.map((n) => n.id).sort()).toEqual(["n_exec", "n_rev"]);
    // Edge kind survives the round-trip; edge animation is now Theme-Pack-driven
    // (applied via edgeRenderProps in the Canvas layer, no longer baked into the
    // serialized spec). The flow edge animates under the Classic pack.
    const flowEdgeFlow = rehydrated.edges.find((e) => e.data?.kind === "flow");
    expect(flowEdgeFlow).toBeTruthy();
    expect(edgeRenderProps(classicPack, flowEdgeFlow?.data?.kind).animated).toBe(
      true,
    );
  });

  it("spawnChild persists a child sub-graph that round-trips through serialize (Batch 2)", async () => {
    const parent = await me.graphs.create({ name: "Parent for spawn", rootRepoPath: "/r" });
    const parentGraphId = String(parent._id);

    const seed: INodeSpec[] = [
      {
        id: "fix1",
        kind: "execute",
        label: "Fixer",
        position: { x: 12, y: 34 },
        status: "pending",
        data: { persona: "backend_engineer", prompt: "patch it" },
      },
    ];

    const child = await me.graphs.spawnChild({
      parentGraphId,
      parentNodeId: "parent_node_1",
      name: "Spawned fixer",
      nodes: seed,
    });
    const childId = String(child._id);

    // Parent linkage persists on the child.
    const loadedChild = await me.graphs.getById({ id: childId });
    expect(loadedChild.parentGraphId).toBe(parentGraphId);
    expect(loadedChild.parentNodeId).toBe("parent_node_1");

    // The seeded node survives the real GraphSpec schema and round-trips.
    const cNodes = loadedChild.nodes as INodeSpec[];
    const cEdges = loadedChild.edges as IEdgeSpec[];
    const flow = specToFlow(cNodes, cEdges);
    const back = flowToSpec(flow.nodes, flow.edges);
    const fixer = back.nodes.find((n) => n.id === "fix1")!;
    expect(fixer.kind).toBe("execute");
    expect(fixer.position).toEqual({ x: 12, y: 34 });
    expect(fixer.data).toMatchObject({ persona: "backend_engineer", prompt: "patch it" });

    // Idempotency: the parent was not mutated by the spawn.
    const reloadedParent = await me.graphs.getById({ id: parentGraphId });
    expect(reloadedParent.nodes).toHaveLength(0);
  });
});
