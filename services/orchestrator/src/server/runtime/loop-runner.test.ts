import { describe, expect, it } from "vitest";
import {
  resolveLoopChildGraphId,
  clampMaxIterations,
  DEFAULT_MAX_ITERATIONS,
  MAX_ITERATIONS_HARD_CAP,
} from "./loop-runner";

describe("clampMaxIterations", () => {
  it("defaults bogus/absent values", () => {
    expect(clampMaxIterations(undefined)).toBe(DEFAULT_MAX_ITERATIONS);
    expect(clampMaxIterations(0)).toBe(DEFAULT_MAX_ITERATIONS);
    expect(clampMaxIterations(-5)).toBe(DEFAULT_MAX_ITERATIONS);
    expect(clampMaxIterations("nope")).toBe(DEFAULT_MAX_ITERATIONS);
  });
  it("honors valid values and floors fractions", () => {
    expect(clampMaxIterations(2)).toBe(2);
    expect(clampMaxIterations(5)).toBe(5);
    expect(clampMaxIterations(2.9)).toBe(2);
    expect(clampMaxIterations("4")).toBe(4);
  });
  it("hard-caps at MAX_ITERATIONS_HARD_CAP", () => {
    expect(clampMaxIterations(1000)).toBe(MAX_ITERATIONS_HARD_CAP);
  });
});

describe("resolveLoopChildGraphId", () => {
  const loop = { id: "lp", kind: "loop" as const };

  it("reads data.childGraphId on the loop node", () => {
    expect(
      resolveLoopChildGraphId({ ...loop, data: { childGraphId: "g123" } }, [], []),
    ).toBe("g123");
  });
  it("reads data.graphId as a fallback key", () => {
    expect(resolveLoopChildGraphId({ ...loop, data: { graphId: "g9" } }, [], [])).toBe("g9");
  });
  it("resolves via a loop/attaches-to edge to a node carrying childGraphId", () => {
    const nodes = [loop, { id: "ref", kind: "context", data: { childGraphId: "gX" } }];
    expect(
      resolveLoopChildGraphId(loop, nodes, [{ source: "lp", target: "ref", kind: "loop" }]),
    ).toBe("gX");
    expect(
      resolveLoopChildGraphId(loop, nodes, [{ source: "ref", target: "lp", kind: "attaches-to" }]),
    ).toBe("gX");
  });
  it("ignores flow edges and returns undefined when nothing resolves", () => {
    const nodes = [loop, { id: "ref", kind: "context", data: { childGraphId: "gX" } }];
    expect(
      resolveLoopChildGraphId(loop, nodes, [{ source: "lp", target: "ref", kind: "flow" }]),
    ).toBeUndefined();
    expect(resolveLoopChildGraphId(loop, [loop], [])).toBeUndefined();
  });
});
