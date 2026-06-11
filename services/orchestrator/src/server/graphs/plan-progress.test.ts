import { describe, expect, it } from "vitest";
import {
  rollupSprintStatus,
  buildSprintProgress,
  currentSprintNumber,
} from "./plan-progress";

describe("rollupSprintStatus (PLAN-5)", () => {
  it("returns pending for an empty / no-run sprint", () => {
    expect(rollupSprintStatus([])).toBe("pending");
    expect(rollupSprintStatus(["pending", "pending"])).toBe("pending");
  });

  it("running wins over everything (a live sprint)", () => {
    expect(rollupSprintStatus(["success", "running", "failed"])).toBe("running");
    expect(rollupSprintStatus(["queued", "pending"])).toBe("running");
  });

  it("failed beats blocked/success when nothing is running", () => {
    expect(rollupSprintStatus(["success", "failed", "blocked"])).toBe("failed");
  });

  it("blocked when a gate blocked and nothing failed/running", () => {
    expect(rollupSprintStatus(["success", "blocked"])).toBe("blocked");
  });

  it("success when all nodes are success (skips don't fail it)", () => {
    expect(rollupSprintStatus(["success", "success"])).toBe("success");
    expect(rollupSprintStatus(["success", "skipped"])).toBe("success");
  });

  it("skipped when every node is skipped", () => {
    expect(rollupSprintStatus(["skipped", "skipped"])).toBe("skipped");
  });

  it("pending for a partially-started mix with nothing active", () => {
    expect(rollupSprintStatus(["success", "pending"])).toBe("pending");
  });
});

describe("buildSprintProgress (PLAN-5)", () => {
  const nodes = [
    { id: "a", label: "Build" },
    { id: "b", label: "Test" },
  ];

  it("maps node-run statuses; missing node → pending; hasRun reflects run state", () => {
    const sp = buildSprintProgress({
      graphId: "g1",
      name: "Feature — Sprint 1",
      sprintNumber: 1,
      sprintName: "Foundations",
      nodes,
      nodeRuns: { a: { status: "success" } }, // b has no run entry
    });
    expect(sp.hasRun).toBe(true);
    expect(sp.nodes).toEqual([
      { nodeId: "a", label: "Build", status: "success" },
      { nodeId: "b", label: "Test", status: "pending" },
    ]);
    // success + pending → pending (not finished)
    expect(sp.status).toBe("pending");
  });

  it("degrades gracefully when there is no run", () => {
    const sp = buildSprintProgress({
      graphId: "g2",
      name: "Sprint 2",
      sprintNumber: 2,
      nodes,
      nodeRuns: undefined,
    });
    expect(sp.hasRun).toBe(false);
    expect(sp.status).toBe("pending");
    expect(sp.nodes.every((n) => n.status === "pending")).toBe(true);
  });
});

describe("currentSprintNumber (PLAN-5)", () => {
  it("is the first not-yet-done sprint", () => {
    const sprints = [
      { graphId: "g1", name: "", sprintNumber: 1, status: "success" as const, hasRun: true, nodes: [] },
      { graphId: "g2", name: "", sprintNumber: 2, status: "running" as const, hasRun: true, nodes: [] },
      { graphId: "g3", name: "", sprintNumber: 3, status: "pending" as const, hasRun: false, nodes: [] },
    ];
    expect(currentSprintNumber(sprints)).toBe(2);
  });

  it("is undefined when every sprint is done", () => {
    const sprints = [
      { graphId: "g1", name: "", sprintNumber: 1, status: "success" as const, hasRun: true, nodes: [] },
      { graphId: "g2", name: "", sprintNumber: 2, status: "skipped" as const, hasRun: true, nodes: [] },
    ];
    expect(currentSprintNumber(sprints)).toBeUndefined();
  });
});
