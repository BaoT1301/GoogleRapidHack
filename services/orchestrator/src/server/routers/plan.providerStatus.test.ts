import { afterEach, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";
import type { CliCapability } from "../runtime/cli-capabilities";

// Control the Local planner's kiro probe deterministically.
const kiroCap = vi.fn<() => Promise<CliCapability>>();
vi.mock("../runtime/cli-capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtime/cli-capabilities")>();
  return { ...actual, checkCliCapability: () => kiroCap() };
});

const createCaller = createCallerFactory(appRouter);
const me = createCaller({ userId: "u_ps" });

describe("plan.providerStatus (PLAN-8b dual-provider readiness)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports Cloud reachable + Local signed-in, never echoing the token", async () => {
    process.env.LLM_API_URL = "http://llm.test";
    process.env.LLM_SERVICE_TOKEN = "secret-tok";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", model: "gemini-2.5-pro" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    kiroCap.mockResolvedValue({
      available: true,
      command: "kiro-cli",
      authMode: "host-login",
      note: "Signed in via host login.",
    });

    const res = await me.plan.providerStatus();
    expect(res.cloud).toMatchObject({ status: "ok", reachable: true });
    expect(res.local).toMatchObject({ provider: "local", available: true, status: "ready", authMode: "host-login" });
    expect(JSON.stringify(res)).not.toContain("secret-tok");
  });

  it("reports Cloud not_configured + Local not_installed", async () => {
    delete process.env.LLM_API_URL;
    delete process.env.LLM_PROXY_URL;
    kiroCap.mockResolvedValue({
      available: false,
      command: "kiro-cli",
      authMode: "unauthenticated",
      note: "Kiro CLI not found",
      suggestedFix: "Install kiro-cli",
    });

    const res = await me.plan.providerStatus();
    expect(res.cloud).toMatchObject({ status: "not_configured" });
    expect(res.local).toMatchObject({ status: "not_installed", available: false });
  });
});
