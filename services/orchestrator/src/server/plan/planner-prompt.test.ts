import { describe, expect, it } from "vitest";
import { buildPlannerPrompt, formatCodebaseContext } from "./planner-prompt";
import type { PlanGenerateInput } from "./types";

/**
 * PLAN-2 (Track 2, Local): the Local planner user message must carry the
 * server-resolved `codebaseContext` as a clearly-delimited UNTRUSTED data section
 * when present, stay absent-safe when not, and NEVER carry persona-impersonation
 * text (the persona lives in the orch-planner agent system prompt).
 */
const base: PlanGenerateInput = { prompt: "Add OAuth login", messages: [], approved: false };

describe("buildPlannerPrompt — codebaseContext (PLAN-2, Local)", () => {
  it("injects a delimited untrusted-data section when context is present", () => {
    const prompt = buildPlannerPrompt({
      ...base,
      codebaseContext: {
        repoSummary: "tRPC monolith.",
        files: ["src/server/routers/plan.ts"],
        symbols: ["planRouter"],
      },
    });
    expect(prompt).toContain("## Codebase context");
    expect(prompt).toContain("UNTRUSTED repo data");
    expect(prompt).toContain("<<<CODEBASE_CONTEXT");
    expect(prompt).toContain("tRPC monolith.");
    expect(prompt).toContain("src/server/routers/plan.ts");
    expect(prompt).toContain("planRouter");
    // Still carries the feature request + mode, never a persona impersonation.
    expect(prompt).toContain("Add OAuth login");
    expect(prompt).not.toMatch(/you are product_architect/i);
  });

  it("omits the section when no context is supplied (absent-safe)", () => {
    const prompt = buildPlannerPrompt(base);
    expect(prompt).not.toContain("CODEBASE_CONTEXT");
    expect(prompt).toContain("Add OAuth login");
  });

  it("formatCodebaseContext is a no-op for absent/empty input", () => {
    expect(formatCodebaseContext(undefined)).toBe("");
    expect(formatCodebaseContext({})).toBe("");
  });
});
