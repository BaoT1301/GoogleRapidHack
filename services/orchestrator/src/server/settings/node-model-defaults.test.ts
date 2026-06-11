import { describe, expect, it } from "vitest";
import {
  resolveNodeModelId,
  resolveNodeMcpStartupPolicy,
  type NodeModelDefaults,
} from "./node-model-defaults";

const defaults: NodeModelDefaults = {
  defaultModelByNodeType: { execute: "claude-sonnet-4", review: "gpt-4.1" },
  mcpStartupPolicy: "best-effort",
};

describe("resolveNodeModelId (MODEL-1)", () => {
  it("uses the node's explicit data.model (highest precedence)", () => {
    expect(
      resolveNodeModelId({ kind: "execute", data: { model: "gemini-2.5-pro" } }, defaults),
    ).toBe("gemini-2.5-pro");
  });

  it("falls back to the per-node-type default when the node omits a model", () => {
    expect(resolveNodeModelId({ kind: "execute", data: {} }, defaults)).toBe("claude-sonnet-4");
    expect(resolveNodeModelId({ kind: "review", data: {} }, defaults)).toBe("gpt-4.1");
  });

  it("returns undefined when neither node nor default has a model (CLI default)", () => {
    expect(resolveNodeModelId({ kind: "doc", data: {} }, defaults)).toBeUndefined();
  });

  it("ignores a blank node data.model and falls back to the default", () => {
    expect(resolveNodeModelId({ kind: "execute", data: { model: "  " } }, defaults)).toBe(
      "claude-sonnet-4",
    );
  });
});

describe("resolveNodeMcpStartupPolicy (MCP-RESILIENCE)", () => {
  it("uses the node's explicit data.mcpStartupPolicy", () => {
    expect(
      resolveNodeMcpStartupPolicy({ data: { mcpStartupPolicy: "require" } }, defaults),
    ).toBe("require");
  });

  it("falls back to the owner default when the node omits a policy", () => {
    expect(resolveNodeMcpStartupPolicy({ data: {} }, defaults)).toBe("best-effort");
    expect(
      resolveNodeMcpStartupPolicy({ data: {} }, { ...defaults, mcpStartupPolicy: "require" }),
    ).toBe("require");
  });

  it("ignores an invalid node policy value", () => {
    expect(
      resolveNodeMcpStartupPolicy({ data: { mcpStartupPolicy: "bogus" } }, defaults),
    ).toBe("best-effort");
  });
});
