import { describe, it, expect } from "vitest";
import { extractEdges } from "./mcp-context-resolver";

describe("extractEdges", () => {
  const graph = {
    nodes: [
      { id: "n1", qualifiedName: "AuthService.login", label: "login" },
      { id: "n2", qualifiedName: "SessionStore.create", label: "create" },
      { id: "n3", label: "helper" }, // label-only (no qualifiedName)
    ],
    edges: [
      { source: "n1", target: "n2", type: "calls" },
      { source: "n1", target: "n3", type: "calls" },
    ],
  };

  it("translates node-id edges to name-based {from,to,type}", () => {
    const out = extractEdges(graph);
    expect(out).toContainEqual({ from: "AuthService.login", to: "SessionStore.create", type: "calls" });
    expect(out).toContainEqual({ from: "AuthService.login", to: "helper", type: "calls" });
  });

  it("accepts the graph wrapped under a `graph` key", () => {
    expect(extractEdges({ graph })).toHaveLength(2);
  });

  it("drops edges whose endpoints don't resolve to a node", () => {
    const out = extractEdges({
      nodes: [{ id: "n1", qualifiedName: "A" }],
      edges: [{ source: "n1", target: "missing", type: "calls" }],
    });
    expect(out).toEqual([]);
  });

  it("drops self-edges and malformed entries", () => {
    const out = extractEdges({
      nodes: [{ id: "n1", qualifiedName: "A" }],
      edges: [
        { source: "n1", target: "n1", type: "calls" }, // self
        { source: "n1", type: "calls" }, // no target
        "nonsense",
      ],
    });
    expect(out).toEqual([]);
  });

  it("returns [] for non-object / empty input (best-effort)", () => {
    expect(extractEdges(null)).toEqual([]);
    expect(extractEdges("x")).toEqual([]);
    expect(extractEdges({})).toEqual([]);
  });
});
