import { afterEach, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";

const createCaller = createCallerFactory(appRouter);
const me = createCaller({ userId: "u_plan" });

describe("plan.generate forwarder", () => {
  afterEach(() => vi.restoreAllMocks());

  it("forwards prompt/approved/messages and returns the top-level body as-is", async () => {
    delete process.env.LLM_PROXY_URL;
    process.env.LLM_API_URL = "http://llm.test";
    process.env.LLM_SERVICE_TOKEN = "tok123";
    // Top-level GraphSpec body — no { data, meta } envelope.
    const body = {
      type: "graph_spec",
      version: "1.0",
      featureName: "X",
      tracks: [{ id: "t1", number: 1 }],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await me.plan.generate({
      prompt: "build X",
      approved: true,
      messages: [{ role: "user", content: "use OAuth" }],
    });
    expect(res).toEqual(body);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://llm.test/api/v1/plan");
    expect(init).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Service-Token": "tok123" }),
      }),
    );
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.approved).toBe(true);
    expect(sent.messages).toEqual([{ role: "user", content: "use OAuth" }]);
    expect(sent.prompt).toBe("build X");
  });

  it("throws when the LLM API returns a non-2xx", async () => {
    process.env.LLM_API_URL = "http://llm.test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("err", { status: 500 }),
    );
    await expect(me.plan.generate({ prompt: "x" })).rejects.toThrow();
  });

  it("maps upstream 429 to TOO_MANY_REQUESTS with a retry message", async () => {
    process.env.LLM_API_URL = "http://llm.test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "RATE_LIMITED" }), { status: 429 }),
    );
    await expect(me.plan.generate({ prompt: "x" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });
});

describe("plan.health probe", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports ok + echoes the model, never the token value", async () => {
    process.env.LLM_API_URL = "http://llm.test";
    process.env.LLM_SERVICE_TOKEN = "secret-tok";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", model: "gemini-2.5-pro" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const h = await me.plan.health();
    expect(h).toMatchObject({
      configured: true,
      tokenPresent: true,
      apiUrl: "http://llm.test",
      reachable: true,
      status: "ok",
      model: "gemini-2.5-pro",
    });
    expect(JSON.stringify(h)).not.toContain("secret-tok");
  });

  it("reports not_configured when LLM_API_URL is unset", async () => {
    delete process.env.LLM_API_URL;
    delete process.env.LLM_PROXY_URL;
    const h = await me.plan.health();
    expect(h).toMatchObject({
      configured: false,
      reachable: false,
      status: "not_configured",
    });
  });

  it("maps a 429 health response to rate_limited", async () => {
    process.env.LLM_API_URL = "http://llm.test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 429 }),
    );
    const h = await me.plan.health();
    expect(h).toMatchObject({ reachable: false, status: "rate_limited" });
  });

  it("reports unreachable when the probe throws", async () => {
    process.env.LLM_API_URL = "http://llm.test";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const h = await me.plan.health();
    expect(h).toMatchObject({ reachable: false, status: "unreachable" });
  });
});
