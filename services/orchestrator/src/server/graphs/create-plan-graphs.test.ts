import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel } from "../../db/models/graph.model";
import { createPlanGraphs } from "./create-plan-graphs";
import { planToGraphSpec } from "../../lib/plan-map";

const ME = "test_user_plan4";

beforeAll(async () => {
  await connectDB();
  await GraphModel.deleteMany({ ownerId: ME });
});

afterAll(async () => {
  await GraphModel.deleteMany({ ownerId: ME });
  await disconnectDB();
});

const currentSpec = planToGraphSpec({
  type: "graph_spec",
  tracks: [
    { id: "t1", number: 1, execution: "SEQUENTIAL", name: "Build API", dependsOn: [] },
    { id: "t2", number: 2, execution: "SEQUENTIAL", name: "Wire UI", dependsOn: ["t1"] },
  ],
});

describe("createPlanGraphs (PLAN-4)", () => {
  it("creates ONE linked graph per sprint, all sharing a generated planId", async () => {
    const res = await createPlanGraphs({
      ownerId: ME,
      featureName: "Auth platform",
      currentSprint: 2,
      currentSpec,
      sprints: [
        { number: 1, name: "Foundations", tasks: ["schema", "session"] },
        { number: 2, name: "OAuth providers", tasks: ["google", "github"] },
        { number: 3, name: "Hardening", tasks: ["rate limit"] },
      ],
      rootRepoPath: "/repo",
      baseBranch: "develop",
    });

    expect(res.planId).toBeTruthy();
    expect(res.graphs).toHaveLength(3);
    // Returned in ascending sprint order.
    expect(res.graphs.map((g) => g.sprintNumber)).toEqual([1, 2, 3]);

    const graphs = await GraphModel.find({ ownerId: ME, planId: res.planId })
      .sort({ sprintNumber: 1 })
      .lean();
    expect(graphs).toHaveLength(3);
    expect(graphs.every((g) => g.planId === res.planId)).toBe(true);
    expect(graphs.every((g) => g.ownerId === ME)).toBe(true);
    expect(graphs.every((g) => g.rootRepoPath === "/repo")).toBe(true);
    expect(graphs.every((g) => g.baseBranch === "develop")).toBe(true);
    expect(graphs.map((g) => g.sprintName)).toEqual([
      "Foundations",
      "OAuth providers",
      "Hardening",
    ]);
  });

  it("the current sprint carries the full mapped topology; others are chained from tasks", async () => {
    const res = await createPlanGraphs({
      ownerId: ME,
      featureName: "Feature X",
      currentSprint: 1,
      currentSpec,
      sprints: [
        { number: 1, name: "Now", tasks: ["ignored when current"] },
        { number: 2, name: "Later", tasks: ["a", "b", "c"] },
      ],
    });

    const byNumber = new Map(
      (await GraphModel.find({ ownerId: ME, planId: res.planId }).lean()).map((g) => [
        g.sprintNumber,
        g,
      ]),
    );

    // Current sprint (1) = the mapped tracks topology (2 execute nodes + a flow edge).
    const current = byNumber.get(1)!;
    expect(current.nodes).toHaveLength(currentSpec.nodes.length);
    expect(current.nodes.map((n) => n.label).sort()).toEqual(["Build API", "Wire UI"]);

    // Later sprint (2) = chained execute nodes from its task list.
    const later = byNumber.get(2)!;
    expect(later.nodes).toHaveLength(3);
    expect(later.nodes.map((n) => n.label)).toEqual(["a", "b", "c"]);
    expect(later.edges.filter((e) => e.kind === "flow")).toHaveLength(2);
  });

  it("is owner-scoped (graphs are tagged with the caller's ownerId)", async () => {
    const res = await createPlanGraphs({
      ownerId: ME,
      featureName: "Scoped",
      currentSprint: 1,
      currentSpec: { nodes: [], edges: [] },
      sprints: [{ number: 1, name: "Solo", tasks: [] }],
    });
    const g = await GraphModel.findOne({ planId: res.planId }).lean();
    expect(g!.ownerId).toBe(ME);
  });
});
