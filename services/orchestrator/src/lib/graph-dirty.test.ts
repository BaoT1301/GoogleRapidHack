import { describe, it, expect } from "vitest";
import { specKey } from "./graph-dirty";
import type { AppNode, AppEdge } from "@/components/canvas/serialize";

function node(over: Partial<AppNode> = {}): AppNode {
  return {
    id: "n1",
    type: "graphNode",
    position: { x: 10, y: 20 },
    data: { kind: "execute", label: "Build", status: "pending", data: {} },
    ...over,
  } as AppNode;
}

describe("specKey", () => {
  it("is stable across selection-only changes", () => {
    const a = specKey([node({ selected: false } as Partial<AppNode>)], []);
    const b = specKey([node({ selected: true } as Partial<AppNode>)], []);
    expect(a).toBe(b);
  });

  it("ignores runtime status changes (no dirty on live run colouring)", () => {
    const a = specKey([node()], []);
    const b = specKey(
      [node({ data: { kind: "execute", label: "Build", status: "running", data: {} } })],
      [],
    );
    expect(a).toBe(b);
  });

  it("ignores measured dimensions", () => {
    const a = specKey([node()], []);
    const b = specKey(
      [node({ width: 240, height: 80, measured: { width: 240, height: 80 } } as Partial<AppNode>)],
      [],
    );
    expect(a).toBe(b);
  });

  it("changes when an authored field changes (label)", () => {
    const a = specKey([node()], []);
    const b = specKey([node({ data: { kind: "execute", label: "Deploy", status: "pending", data: {} } })], []);
    expect(a).not.toBe(b);
  });

  it("changes when position changes", () => {
    const a = specKey([node()], []);
    const b = specKey([node({ position: { x: 99, y: 20 } })], []);
    expect(a).not.toBe(b);
  });

  it("ignores the UI-derived visualStatus (stale never marks the graph dirty)", () => {
    const a = specKey([node()], []);
    const b = specKey(
      [
        node({
          data: {
            kind: "execute",
            label: "Build",
            status: "pending",
            data: {},
            visualStatus: "stale",
          },
        }),
      ],
      [],
    );
    expect(a).toBe(b);
  });

  it("changes when an edge is added", () => {
    const n2 = node({ id: "n2" });
    const a = specKey([node(), n2], []);
    const edge: AppEdge = {
      id: "e1",
      source: "n1",
      target: "n2",
      data: { kind: "flow" },
    } as AppEdge;
    const b = specKey([node(), n2], [edge]);
    expect(a).not.toBe(b);
  });
});
