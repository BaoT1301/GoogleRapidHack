import { describe, it, expect } from "vitest";
import {
  computeInputHashes,
  deriveVisualStates,
  type VisNode,
  type VisEdge,
} from "./node-visual-state";

function node(
  id: string,
  status: string,
  extra: Partial<VisNode["data"]> = {},
): VisNode {
  return {
    id,
    data: { kind: "execute", label: id, status, data: {}, ...extra },
  };
}

describe("computeInputHashes", () => {
  it("is stable regardless of node/edge ordering and ignores status & position", () => {
    const a = node("a", "success");
    const b = node("b", "running");
    const edges: VisEdge[] = [{ source: "a", target: "b" }];

    const h1 = computeInputHashes([a, b], edges);
    // Reorder + change runtime status — input hash must be unchanged.
    const h2 = computeInputHashes(
      [{ ...b, data: { ...b.data, status: "failed" } }, a],
      [{ source: "a", target: "b" }],
    );
    expect(h2.a).toBe(h1.a);
    expect(h2.b).toBe(h1.b);
  });

  it("changes a downstream node's hash when an upstream node's config changes", () => {
    const edges: VisEdge[] = [{ source: "a", target: "b" }];
    const base = computeInputHashes([node("a", "success"), node("b", "success")], edges);
    const changed = computeInputHashes(
      [node("a", "success", { data: { x: 1 } }), node("b", "success")],
      edges,
    );
    expect(changed.b).not.toBe(base.b); // upstream change propagates
    expect(changed.a).not.toBe(base.a);
  });
});

describe("deriveVisualStates", () => {
  const edges: VisEdge[] = [{ source: "a", target: "b" }];

  it("returns nothing without a baseline", () => {
    const nodes = [node("a", "success"), node("b", "success")];
    expect(deriveVisualStates(nodes, edges, null)).toEqual({});
  });

  it("marks no node stale when inputs are unchanged since the baseline", () => {
    const nodes = [node("a", "success"), node("b", "success")];
    const baseline = computeInputHashes(nodes, edges);
    expect(deriveVisualStates(nodes, edges, baseline)).toEqual({});
  });

  it("marks a succeeded node stale when its OWN config changed", () => {
    const before = [node("a", "success"), node("b", "success")];
    const baseline = computeInputHashes(before, edges);
    const after = [node("a", "success"), node("b", "success", { label: "edited" })];
    expect(deriveVisualStates(after, edges, baseline)).toEqual({ b: "stale" });
  });

  it("marks a succeeded node stale when an UPSTREAM input changed", () => {
    const before = [node("a", "success"), node("b", "success")];
    const baseline = computeInputHashes(before, edges);
    // Edit upstream `a`; downstream `b` (still success) becomes stale.
    const after = [node("a", "success", { data: { v: 2 } }), node("b", "success")];
    const derived = deriveVisualStates(after, edges, baseline);
    expect(derived.b).toBe("stale");
    expect(derived.a).toBe("stale"); // a's own input changed too
  });

  it("never marks pending/running/failed nodes stale", () => {
    const before = [node("a", "success"), node("b", "running")];
    const baseline = computeInputHashes(before, edges);
    const after = [
      node("a", "success", { data: { v: 9 } }),
      node("b", "running", { label: "x" }),
    ];
    const derived = deriveVisualStates(after, edges, baseline);
    expect(derived.b).toBeUndefined(); // running is not success-like
    expect(derived.a).toBe("stale");
  });

  it("ignores nodes absent from the baseline (added after the run)", () => {
    const baseline = computeInputHashes([node("a", "success")], []);
    const after = [node("a", "success"), node("c", "success", { label: "new" })];
    const derived = deriveVisualStates(after, [], baseline);
    expect(derived.c).toBeUndefined();
  });
});
