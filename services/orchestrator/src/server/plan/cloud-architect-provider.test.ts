import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudArchitectProvider } from "./cloud-architect-provider";
import type { PlanGenerateInput } from "./types";

/**
 * PLAN-1 (Track 1) cross-service forwarding proof. The Cloud provider already
 * `JSON.stringify(input)`s the whole body, so the additive `codebaseContext`
 * rides along unchanged when present — and the body is byte-for-byte identical
 * to the pre-Sprint-5 forwarder when it is absent (§2 / §8a back-compat).
 */
describe("CloudArchitectProvider.generate forwards codebaseContext additively", () => {
  const savedUrl = process.env.LLM_API_URL;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.LLM_API_URL = "https://architect.test";
    fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ type: "context_request" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedUrl === undefined) delete process.env.LLM_API_URL;
    else process.env.LLM_API_URL = savedUrl;
  });

  function sentBody(): Record<string, unknown> {
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    return JSON.parse(init.body as string) as Record<string, unknown>;
  }

  const base: PlanGenerateInput = { prompt: "Add auth", messages: [], approved: false };

  it("includes codebaseContext in the upstream body when present", async () => {
    await new CloudArchitectProvider().generate({
      ...base,
      codebaseContext: { repoSummary: "Next.js monolith", files: ["a.ts"] },
    });
    const body = sentBody();
    expect(body.codebaseContext).toEqual({ repoSummary: "Next.js monolith", files: ["a.ts"] });
    expect(body.prompt).toBe("Add auth");
  });

  it("omits codebaseContext entirely when absent (byte-for-byte back-compat)", async () => {
    await new CloudArchitectProvider().generate(base);
    const body = sentBody();
    expect("codebaseContext" in body).toBe(false);
    expect(body).toEqual({ prompt: "Add auth", messages: [], approved: false });
  });
});
