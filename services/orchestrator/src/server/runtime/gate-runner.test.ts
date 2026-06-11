import { describe, expect, it } from "vitest";
import { resolveGate, resolveGateFanInMode } from "./gate-runner";

describe("resolveGateFanInMode", () => {
  it("defaults to all-of with no any-of incoming edge", () => {
    const mode = resolveGateFanInMode("G", [
      { source: "A", target: "G", kind: "flow" },
      { source: "B", target: "G", kind: "flow" },
    ]);
    expect(mode).toBe("all-of");
  });

  it("is any-of when an incoming flow edge is marked any-of", () => {
    const mode = resolveGateFanInMode("G", [
      { source: "A", target: "G", kind: "flow", fanInMode: "any-of" },
      { source: "B", target: "G", kind: "flow" },
    ]);
    expect(mode).toBe("any-of");
  });

  it("ignores non-flow edges and edges targeting other nodes", () => {
    const mode = resolveGateFanInMode("G", [
      { source: "A", target: "G", kind: "data", fanInMode: "any-of" }, // not flow
      { source: "B", target: "OTHER", kind: "flow", fanInMode: "any-of" }, // other node
    ]);
    expect(mode).toBe("all-of");
  });
});

describe("resolveGate", () => {
  it("all-of passes only when every upstream succeeded", () => {
    expect(
      resolveGate({
        fanInMode: "all-of",
        upstreams: [
          { nodeId: "A", status: "success" },
          { nodeId: "B", status: "success" },
        ],
      }).status,
    ).toBe("success");
  });

  it("all-of is blocked when any upstream failed or was skipped", () => {
    const failed = resolveGate({
      fanInMode: "all-of",
      upstreams: [
        { nodeId: "A", status: "success" },
        { nodeId: "B", status: "failed" },
      ],
    });
    expect(failed.status).toBe("blocked");
    expect(failed.succeededCount).toBe(1);
    expect(failed.upstreamCount).toBe(2);

    expect(
      resolveGate({
        fanInMode: "all-of",
        upstreams: [
          { nodeId: "A", status: "success" },
          { nodeId: "B", status: "skipped" },
        ],
      }).status,
    ).toBe("blocked");
  });

  it("any-of passes on the first upstream success even if others fail", () => {
    const res = resolveGate({
      fanInMode: "any-of",
      upstreams: [
        { nodeId: "A", status: "success" },
        { nodeId: "B", status: "failed" },
      ],
    });
    expect(res.status).toBe("success");
    expect(res.succeededCount).toBe(1);
  });

  it("any-of is blocked only when every upstream failed/skipped", () => {
    expect(
      resolveGate({
        fanInMode: "any-of",
        upstreams: [
          { nodeId: "A", status: "failed" },
          { nodeId: "B", status: "skipped" },
        ],
      }).status,
    ).toBe("blocked");
  });

  it("a gate with no gated upstreams is blocked with a clear reason", () => {
    const allOf = resolveGate({ fanInMode: "all-of", upstreams: [] });
    const anyOf = resolveGate({ fanInMode: "any-of", upstreams: [] });
    expect(allOf.status).toBe("blocked");
    expect(anyOf.status).toBe("blocked");
    expect(allOf.reason).toMatch(/no incoming flow predecessors/i);
  });
});
