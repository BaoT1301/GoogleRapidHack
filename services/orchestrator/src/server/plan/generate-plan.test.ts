import { TRPCError } from "@trpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePlan } from "./generate-plan";
import type { PlanProvider } from "./types";

function provider(raw: unknown): PlanProvider {
  return {
    name: "cloud",
    generate: vi.fn(async () => raw),
    health: vi.fn(async () => ({ status: "ok" })),
  };
}

describe("generatePlan internal planner service", () => {
  afterEach(() => {
    delete process.env.LLM_API_URL;
    delete process.env.LLM_PROXY_URL;
    delete process.env.ORCH_PLAN_MODEL;
  });

  it("normalizes ContextRequest output for approved=false flows", async () => {
    const raw = {
      type: "context_request",
      confidence: 0.6,
      readyToPlan: false,
      codebaseImpact: "Touches auth.",
      approaches: [{ name: "A", pros: ["simple"], cons: [] }],
      questions: [{ id: "q1", text: "Which provider?", category: "scope" }],
      missingContext: [],
    };

    const result = await generatePlan(
      { prompt: "add auth", approved: false, source: "plan_panel" },
      { selectProvider: () => provider(raw) },
    );

    expect(result.resultType).toBe("context_request");
    expect(result.contextRequest).toMatchObject({ type: "context_request", confidence: 0.6 });
    expect(result.rawResult).toBe(raw);
    expect(result.warnings).toEqual([]);
  });

  it("normalizes GraphSpec output for approved=true flows", async () => {
    const raw = {
      type: "graph_spec",
      version: "1.0",
      featureName: "Search",
      sprintNumber: 1,
      tracks: [
        {
          id: "track-1",
          number: 1,
          execution: "SEQUENTIAL",
          persona: "backend_engineer",
          name: "Build API",
          status: "PENDING",
          overview: "Add endpoint.",
          checklist: ["route"],
          dependsOn: [],
        },
      ],
      missingContext: [],
    };

    const result = await generatePlan(
      { prompt: "build search", approved: true, source: "plan_node_runtime" },
      { selectProvider: () => provider(raw) },
    );

    expect(result.provider).toBe("cloud");
    expect(result.resultType).toBe("graph_spec");
    expect(result.graphSpec).toMatchObject({ type: "graph_spec", featureName: "Search" });
    expect(result.rawResult).toBe(raw);
  });

  it("can be called directly for plan_node_runtime with sanitized context deps", async () => {
    const generate = vi.fn(async () => ({ type: "context_request", questions: [] }));
    const p: PlanProvider = { name: "local", generate, health: vi.fn() };

    await generatePlan(
      {
        prompt: "plan runtime node",
        provider: "local",
        source: "plan_node_runtime",
        codebaseContext: { repoSummary: "client hint" },
      },
      {
        selectProvider: () => p,
        resolveContext: async () => ({ repoSummary: "server context" }),
      },
    );

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "plan runtime node",
        approved: false,
        messages: [],
        codebaseContext: { repoSummary: "server context" },
      }),
    );
  });

  it("auto-routes planning to the configured cloud planner and reports selected model", async () => {
    process.env.LLM_API_URL = "http://llm.test";
    const generate = vi.fn(async () => ({ type: "context_request", questions: [] }));
    const p: PlanProvider = { name: "cloud", generate, health: vi.fn() };

    const result = await generatePlan(
      { prompt: "plan runtime node", provider: "auto", model: "auto", source: "plan_node_runtime" },
      { selectProvider: () => p },
    );

    expect(result.provider).toBe("cloud");
    expect(result.model).toBe("gemini-2.5-pro");
    expect(result.warnings).toContain("Auto selected the configured Cloud planner for planning tasks.");
  });

  it("rejects arbitrary manual planning model ids before provider invocation", async () => {
    const generate = vi.fn(async () => ({ type: "context_request", questions: [] }));
    const p: PlanProvider = { name: "cloud", generate, health: vi.fn() };

    await expect(
      generatePlan(
        { prompt: "plan runtime node", provider: "cloud", model: "not-real-model" },
        { selectProvider: () => p },
      ),
    ).rejects.toThrow(/not allowlisted/i);
    expect(generate).not.toHaveBeenCalled();
  });


  it("normalizes provider errors without leaking implementation objects", async () => {
    const p: PlanProvider = {
      name: "cloud",
      generate: vi.fn(async () => {
        throw new Error("network down");
      }),
      health: vi.fn(),
    };

    await expect(
      generatePlan({ prompt: "x" }, { selectProvider: () => p }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: 'Planner provider "cloud" failed: network down',
    });
  });

  it("preserves existing TRPC errors from providers", async () => {
    const p: PlanProvider = {
      name: "cloud",
      generate: vi.fn(async () => {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "limited" });
      }),
      health: vi.fn(),
    };

    await expect(
      generatePlan({ prompt: "x" }, { selectProvider: () => p }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: "limited" });
  });
});
