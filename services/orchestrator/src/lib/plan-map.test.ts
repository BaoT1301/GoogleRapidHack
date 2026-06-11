import { describe, expect, it } from "vitest";
import { planToGraphSpec, sprintTasksToGraphSpec } from "@/lib/plan-map";

function track(over: Record<string, unknown>) {
  return {
    id: "t",
    number: 1,
    execution: "SEQUENTIAL",
    persona: "backend_engineer",
    name: "Track",
    status: "PENDING",
    overview: "o",
    checklist: ["a"],
    dependsOn: [],
    ...over,
  };
}

describe("planToGraphSpec", () => {
  it("maps each track to an execute node carrying persona + checklist", () => {
    const { nodes } = planToGraphSpec({
      type: "graph_spec",
      tracks: [
        track({
          id: "t1",
          name: "Build API",
          persona: "backend_engineer",
          checklist: ["write route", "add test"],
        }),
      ],
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("execute");
    expect(nodes[0].label).toBe("Build API");
    expect(nodes[0].data.persona).toBe("backend_engineer");
    expect(nodes[0].data.checklist).toEqual(["write route", "add test"]);
  });

  it("chains SEQUENTIAL tracks via flow edges (dependsOn → flow)", () => {
    const { edges } = planToGraphSpec({
      tracks: [
        track({ id: "t1", number: 1, dependsOn: [] }),
        track({ id: "t2", number: 2, dependsOn: ["t1"] }),
        track({ id: "t3", number: 3, dependsOn: ["t2"] }),
      ],
    });
    const flow = edges.filter((e) => e.kind === "flow");
    expect(flow).toHaveLength(2);
    expect(flow).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "t1", target: "t2", kind: "flow" }),
        expect.objectContaining({ source: "t2", target: "t3", kind: "flow" }),
      ]),
    );
  });

  it("converges PARALLEL tracks sharing a dependency into a gate node", () => {
    const { nodes, edges } = planToGraphSpec({
      tracks: [
        track({ id: "t1", number: 1, execution: "SEQUENTIAL", dependsOn: [] }),
        track({ id: "t2", number: 2, execution: "PARALLEL", dependsOn: ["t1"] }),
        track({ id: "t3", number: 3, execution: "PARALLEL", dependsOn: ["t1"] }),
      ],
    });
    const gate = nodes.find((n) => n.kind === "gate");
    expect(gate).toBeTruthy();
    const intoGate = edges.filter((e) => e.target === gate!.id);
    expect(intoGate.map((e) => e.source).sort()).toEqual(["t2", "t3"]);
    expect(intoGate.every((e) => e.kind === "flow")).toBe(true);
  });

  it("emits a loop back-edge when a dependsOn points back to an ancestor", () => {
    const { edges } = planToGraphSpec({
      tracks: [
        track({ id: "t1", number: 1, dependsOn: [] }),
        track({ id: "t2", number: 2, dependsOn: ["t1"] }),
        // t1 depends on t2 → would close the t1→t2 chain into a cycle → loop.
        track({ id: "t1b", number: 3, dependsOn: [] }),
      ],
    });
    // Build a deliberate cycle: re-map with a back reference.
    const { edges: e2 } = planToGraphSpec({
      tracks: [
        track({ id: "a", number: 1, dependsOn: ["b"] }),
        track({ id: "b", number: 2, dependsOn: ["a"] }),
      ],
    });
    expect(edges.length).toBeGreaterThanOrEqual(1);
    const loop = e2.filter((e) => e.kind === "loop");
    const flow = e2.filter((e) => e.kind === "flow");
    expect(flow).toHaveLength(1);
    expect(loop).toHaveLength(1);
    // The back reference is the loop edge.
    expect(loop[0]).toMatchObject({ kind: "loop" });
  });

  it("returns empty nodes/edges for a spec with no tracks", () => {
    expect(planToGraphSpec({ type: "graph_spec" })).toEqual({
      nodes: [],
      edges: [],
    });
    expect(planToGraphSpec(null)).toEqual({ nodes: [], edges: [] });
  });
});

describe("sprintTasksToGraphSpec (PLAN-4)", () => {
  it("maps a task-name list to chained execute nodes joined by flow edges", () => {
    const { nodes, edges } = sprintTasksToGraphSpec(["schema", "session", "oauth"]);
    expect(nodes).toHaveLength(3);
    expect(nodes.every((n) => n.kind === "execute")).toBe(true);
    expect(nodes.map((n) => n.label)).toEqual(["schema", "session", "oauth"]);
    const flow = edges.filter((e) => e.kind === "flow");
    expect(flow).toHaveLength(2);
    expect(flow[0]).toMatchObject({ source: nodes[0].id, target: nodes[1].id });
    expect(flow[1]).toMatchObject({ source: nodes[1].id, target: nodes[2].id });
  });

  it("numbers nodes 1..n and lays them out left-to-right", () => {
    const { nodes } = sprintTasksToGraphSpec(["a", "b"]);
    expect(nodes[0].data.number).toBe(1);
    expect(nodes[1].data.number).toBe(2);
    expect(nodes[1].position.x).toBeGreaterThan(nodes[0].position.x);
  });

  it("drops blank/non-string task names and is empty-safe", () => {
    const { nodes, edges } = sprintTasksToGraphSpec(["  ", "real", ""]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].label).toBe("real");
    expect(edges).toHaveLength(0);
    expect(sprintTasksToGraphSpec([])).toEqual({ nodes: [], edges: [] });
  });
});
