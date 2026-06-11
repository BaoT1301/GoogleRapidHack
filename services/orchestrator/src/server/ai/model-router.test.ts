import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getModelCatalog, type ModelCatalogResponse } from "./model-catalog";
import { routeModel } from "./model-router";

const catalog: ModelCatalogResponse = {
  providers: [
    {
      provider: "gemini",
      label: "Gemini",
      configured: true,
      enabled: true,
      models: [
        { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", configured: true, enabled: true },
        { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", configured: true, enabled: true },
      ],
    },
    {
      provider: "openai",
      label: "OpenAI",
      configured: true,
      enabled: true,
      models: [
        { id: "gpt-4.1", label: "GPT-4.1", configured: true, enabled: true },
        { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", configured: true, enabled: true },
      ],
    },
    {
      provider: "claude",
      label: "Claude",
      configured: false,
      enabled: false,
      models: [],
    },
    {
      provider: "codex",
      label: "Codex CLI / GPT",
      configured: true,
      enabled: true,
      models: [
        { id: "gpt-4.1", label: "GPT-4.1 via Codex CLI", configured: true, enabled: true },
        { id: "gpt-4.1-mini", label: "GPT-4.1 Mini via Codex CLI", configured: true, enabled: true },
      ],
    },
  ],
};

describe("model-router", () => {
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.LLM_API_URL;
    delete process.env.LLM_PROXY_URL;
    delete process.env.ORCH_CODEX_MODEL_ROUTER;
    delete process.env.ORCH_PLAN_MODEL;
    delete process.env.ORCH_TEST_KIRO_AVAILABLE;
    delete process.env.ORCH_TEST_CODEX_AVAILABLE;
  });

  it("auto chooses local Codex CLI/GPT for graph patches", () => {
    expect(routeModel({ taskType: "graph_patch", provider: "auto", model: "auto", catalog })).toMatchObject({
      provider: "codex",
      model: "gpt-4.1",
      automatic: true,
    });
  });

  it("auto chooses fast configured model for docs and quick fixes", () => {
    expect(routeModel({ taskType: "docs", catalog })).toMatchObject({
      provider: "codex",
      model: "gpt-4.1-mini",
      automatic: true,
    });
    expect(routeModel({ taskType: "quick_fix", catalog })).toMatchObject({
      provider: "codex",
      model: "gpt-4.1-mini",
    });
  });

  it("falls back when the preferred model is unavailable", () => {
    const fallbackCatalog: ModelCatalogResponse = {
      providers: catalog.providers.map((provider) =>
        provider.provider === "codex"
          ? {
              ...provider,
              enabled: false,
              models: provider.models.map((model) => ({ ...model, enabled: false })),
            }
          : provider,
      ),
    };
    expect(routeModel({ taskType: "graph_patch", catalog: fallbackCatalog })).toMatchObject({
      provider: "gemini",
      model: "gemini-2.5-pro",
    });
  });

  it("uses Codex for code editing only when configured", () => {
    process.env.ORCH_CODEX_MODEL_ROUTER = "1";
    expect(routeModel({ taskType: "code_editing", catalog })).toMatchObject({
      provider: "codex",
      model: "gpt-4.1",
      reason: expect.stringMatching(/Codex/i),
    });
  });

  it("manual override validates backend allowlist and enabled state", () => {
    expect(routeModel({
      taskType: "graph_patch",
      provider: "openai",
      model: "gpt-4.1",
      catalog,
    })).toMatchObject({
      provider: "openai",
      model: "gpt-4.1",
      automatic: false,
    });

    expect(() =>
      routeModel({
        taskType: "graph_patch",
        provider: "openai",
        model: "made-up-model",
        catalog,
      }),
    ).toThrow(/not allowlisted/i);
  });

  it("planning auto selects cloud when configured and local otherwise", () => {
    process.env.ORCH_TEST_KIRO_AVAILABLE = "1";
    process.env.LLM_API_URL = "http://llm.test";
    expect(routeModel({ taskType: "planning", provider: "auto", model: "auto", catalog })).toMatchObject({
      provider: "cloud",
      model: "gemini-2.5-pro",
    });

    delete process.env.LLM_API_URL;
    expect(routeModel({ taskType: "planning", provider: "auto", model: "auto", catalog })).toMatchObject({
      provider: "local",
      model: "local-planner-default",
    });
  });

  it("planning falls back to cloud when local is missing but cloud is configured", () => {
    process.env.ORCH_TEST_KIRO_AVAILABLE = "0";
    process.env.LLM_API_URL = "http://llm.test";
    expect(routeModel({ taskType: "planning", provider: "auto", model: "auto", catalog })).toMatchObject({
      provider: "cloud",
      model: "gemini-2.5-pro",
    });
  });

  it("planning throws PRECONDITION_FAILED when neither cloud is configured nor local is available", () => {
    process.env.ORCH_TEST_KIRO_AVAILABLE = "0";
    delete process.env.LLM_API_URL;
    delete process.env.LLM_PROXY_URL;
    expect(() =>
      routeModel({ taskType: "planning", provider: "auto", model: "auto", catalog }),
    ).toThrow(/No planning provider is available/i);
  });

  it("planning manual selection throws PRECONDITION_FAILED when local is unavailable", () => {
    process.env.ORCH_TEST_KIRO_AVAILABLE = "0";
    expect(() =>
      routeModel({ taskType: "planning", provider: "local", model: "auto", catalog }),
    ).toThrow(/Local planner \(kiro-cli\) is not installed or configured/i);
  });

  it("planning manual selection succeeds when local is available", () => {
    process.env.ORCH_TEST_KIRO_AVAILABLE = "1";
    expect(
      routeModel({ taskType: "planning", provider: "local", model: "auto", catalog }),
    ).toMatchObject({
      provider: "local",
      model: "local-planner-default",
      automatic: false,
    });
  });

  describe("Claude routing and manual selection", () => {
    let savedMock: string | undefined;

    beforeEach(() => {
      savedMock = process.env.ORCH_AI_PATCH_MOCK;
      process.env.ORCH_AI_PATCH_MOCK = "1";
    });

    afterEach(() => {
      delete process.env.ORCH_TEST_CLAUDE_AVAILABLE;
      if (savedMock) process.env.ORCH_AI_PATCH_MOCK = savedMock;
      else delete process.env.ORCH_AI_PATCH_MOCK;
    });

    it("model catalog disables Claude when not configured/available", () => {
      process.env.ORCH_TEST_CLAUDE_AVAILABLE = "0";
      const cat = getModelCatalog();
      const claude = cat.providers.find((p) => p.provider === "claude")!;
      expect(claude.configured).toBe(false);
      expect(claude.enabled).toBe(false);
      expect(claude.disabledReason).toContain("not installed or authenticated");
    });

    it("model catalog enables Claude when configured/available", () => {
      process.env.ORCH_TEST_CLAUDE_AVAILABLE = "1";
      const cat = getModelCatalog();
      const claude = cat.providers.find((p) => p.provider === "claude")!;
      expect(claude.configured).toBe(true);
      expect(claude.enabled).toBe(true);
      expect(claude.disabledReason).toBeUndefined();
    });

    it("auto router skips Claude when unavailable", () => {
      process.env.ORCH_TEST_CLAUDE_AVAILABLE = "0";
      const res = routeModel({ taskType: "graph_patch", provider: "auto", model: "auto", catalog });
      expect(res.provider).not.toBe("claude");
      expect(res.provider).toBe("codex");
    });

    it("manual override validates Claude model allowlist", () => {
      process.env.ORCH_TEST_CLAUDE_AVAILABLE = "1";
      const res = routeModel({ taskType: "graph_patch", provider: "claude", model: "claude-sonnet-4" });
      expect(res.provider).toBe("claude");
      expect(res.model).toBe("claude-sonnet-4");

      expect(() =>
        routeModel({ taskType: "graph_patch", provider: "claude", model: "claude-unallowlisted-model" })
      ).toThrow(/model is not allowlisted/i);
    });

    it("manual override throws PRECONDITION_FAILED when Claude is unavailable", () => {
      process.env.ORCH_TEST_CLAUDE_AVAILABLE = "0";
      expect(() =>
        routeModel({ taskType: "graph_patch", provider: "claude", model: "claude-sonnet-4" })
      ).toThrow(/Claude provider is not available/i);
    });
  });
});
