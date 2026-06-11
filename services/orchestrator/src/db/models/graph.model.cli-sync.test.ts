import { describe, expect, it } from "vitest";
import { SUPPORTED_CLIS as MODEL_CLIS } from "./graph.model";
import { SUPPORTED_CLIS as RUNTIME_CLIS } from "../../server/runtime/types";

describe("CLI-2 — graph model cli enum stays in sync with the runtime", () => {
  it("the model's local SUPPORTED_CLIS equals the runtime's canonical set", () => {
    expect([...MODEL_CLIS].sort()).toEqual([...RUNTIME_CLIS].sort());
  });
});
