import { describe, expect, it, vi } from "vitest";
import { AgenticArchitectProvider, type GenerateTurnFn } from "./agentic-architect-provider";
import type { PlanGenerateInput } from "./types";

const GRAPH_SPEC = `<!-- orch:plan -->
{"type":"graph_spec","version":"1.0","featureName":"Rate limiting","tracks":[
  {"id":"t1","number":1,"persona":"backend_engineer","name":"Middleware","checklist":["create middleware"]}
]}
<!-- /orch:plan -->`;

const input: PlanGenerateInput = {
  prompt: "Add per-user rate limiting",
  messages: [],
  approved: true,
};

/** A scripted generateTurn that returns queued responses and records the messages. */
function scripted(responses: Awaited<ReturnType<GenerateTurnFn>>[]) {
  const seen: { system: string; messages: { role: string; content: string }[] }[] = [];
  const fn = vi.fn(async (turn: Parameters<GenerateTurnFn>[0]) => {
    seen.push({ system: turn.system, messages: turn.messages.map((m) => ({ ...m })) });
    return responses.shift() ?? { kind: "text", text: GRAPH_SPEC };
  }) as unknown as GenerateTurnFn;
  return { fn, seen };
}

describe("AgenticArchitectProvider", () => {
  it("runs the loop: tool_call → local query_codebase → final graph_spec", async () => {
    const { fn, seen } = scripted([
      { kind: "tool_calls", calls: [{ name: "query_codebase", args: { query: "auth" } }] },
      { kind: "text", text: GRAPH_SPEC },
    ]);
    const queryCodebase = vi.fn(async () => ({
      symbols: ["authenticate — src/auth.ts"],
      files: ["src/auth.ts"],
    }));

    const provider = new AgenticArchitectProvider({ queryCodebase, generateTurn: fn });
    const result = (await provider.generate(input)) as { type: string; featureName: string };

    expect(result.type).toBe("graph_spec");
    expect(result.featureName).toBe("Rate limiting");
    // The tool was answered locally with the model's query…
    expect(queryCodebase).toHaveBeenCalledWith("auth", undefined);
    // …and the result was fed back into the conversation before the final turn.
    const finalTurnMsgs = seen[1].messages.map((m) => m.content).join("\n");
    expect(finalTurnMsgs).toContain("query_codebase result");
    expect(finalTurnMsgs).toContain("authenticate — src/auth.ts");
    // The tool was advertised to the model.
    expect(seen[0].system).toContain("query_codebase");
  });

  it("is bounded — never loops forever when the model keeps calling tools", async () => {
    const alwaysTool = (async () => ({
      kind: "tool_calls" as const,
      calls: [{ name: "query_codebase", args: { query: "x" } }],
    })) as unknown as GenerateTurnFn;
    const queryCodebase = vi.fn(async () => ({ symbols: [], files: [] }));

    const provider = new AgenticArchitectProvider({
      queryCodebase,
      generateTurn: alwaysTool,
      maxIterations: 2,
      maxToolCalls: 3,
    });

    await expect(provider.generate(input)).rejects.toThrow(/no usable plan/i);
    expect(queryCodebase.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("retries within budget when the model's JSON is invalid, then succeeds", async () => {
    const { fn } = scripted([
      { kind: "text", text: "not a plan" },
      { kind: "text", text: GRAPH_SPEC },
    ]);
    const provider = new AgenticArchitectProvider({
      queryCodebase: async () => ({ symbols: [], files: [] }),
      generateTurn: fn,
    });
    const result = (await provider.generate(input)) as { type: string };
    expect(result.type).toBe("graph_spec");
  });
});
