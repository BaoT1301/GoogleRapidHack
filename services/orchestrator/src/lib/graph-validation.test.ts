import { describe, expect, it } from "vitest";
import {
  validateConnection,
  wouldCreateCycle,
  type MinEdge,
} from "@/lib/graph-validation";

const flow = (source: string, target: string): MinEdge => ({
  source,
  target,
  kind: "flow",
});

describe("wouldCreateCycle", () => {
  it("detects a direct back-edge (B→A when A→B exists)", () => {
    expect(wouldCreateCycle([flow("a", "b")], "b", "a")).toBe(true);
  });

  it("detects a transitive cycle (C→A when A→B→C exists)", () => {
    const edges = [flow("a", "b"), flow("b", "c")];
    expect(wouldCreateCycle(edges, "c", "a")).toBe(true);
  });

  it("allows a DAG edge that does not close a loop", () => {
    const edges = [flow("a", "b"), flow("a", "c")];
    expect(wouldCreateCycle(edges, "b", "c")).toBe(false);
  });

  it("ignores non-flow edges when computing reachability", () => {
    const edges: MinEdge[] = [
      { source: "a", target: "b", kind: "data" },
      { source: "b", target: "c", kind: "data" },
    ];
    // No flow path b→…→a exists, so a flow edge c→a is fine.
    expect(wouldCreateCycle(edges, "c", "a")).toBe(false);
  });

  it("treats a self-edge as a cycle", () => {
    expect(wouldCreateCycle([], "a", "a")).toBe(true);
  });
});

describe("validateConnection", () => {
  it("rejects self-connections", () => {
    const r = validateConnection({ source: "a", target: "a" }, []);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/itself/);
  });

  it("rejects duplicate edges of the same kind", () => {
    const r = validateConnection({ source: "a", target: "b" }, [flow("a", "b")]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/already exists/);
  });

  it("rejects flow edges that would create a cycle", () => {
    const r = validateConnection({ source: "b", target: "a" }, [flow("a", "b")]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cycle/);
  });

  it("accepts a valid new flow edge", () => {
    expect(validateConnection({ source: "a", target: "c" }, [flow("a", "b")])).toEqual({
      ok: true,
    });
  });

  it("allows a data edge that mirrors an existing flow edge (different kind)", () => {
    const r = validateConnection({ source: "a", target: "b", kind: "data" }, [
      flow("a", "b"),
    ]);
    expect(r.ok).toBe(true);
  });
});
