import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";
import { connectDB, disconnectDB } from "../../db/client";
import { UserSettingsModel } from "../../db/models/settings.model";

// Integration test — requires a local Mongo. Proves P5: the persisted Settings
// `plannerProvider` toggle steers plan.generate server-side (no explicit provider
// in the call), routing to Cloud vs Local.
const createCaller = createCallerFactory(appRouter);
const ME = "test_user_plan_toggle";
const me = createCaller({ userId: ME });

async function setToggle(provider: "cloud" | "local") {
  await UserSettingsModel.findOneAndUpdate(
    { ownerId: ME },
    { $set: { plannerProvider: provider } },
    { upsert: true },
  );
}

beforeAll(async () => {
  await connectDB();
  await UserSettingsModel.deleteMany({ ownerId: ME });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ORCH_PLAN_PROVIDER;
});

afterAll(async () => {
  await UserSettingsModel.deleteMany({ ownerId: ME });
  await disconnectDB();
});

describe("plan.generate honors the persisted Settings toggle (P5)", () => {
  it("toggle=cloud → hits the Cloud Architect API", async () => {
    await setToggle("cloud");
    process.env.LLM_API_URL = "http://llm.test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ type: "graph_spec", version: "1.0", featureName: "x", tracks: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await me.plan.generate({ prompt: "build x" });
    expect(fetchSpy).toHaveBeenCalled();
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/api/v1/plan");
  });

  it("toggle=local → routes to the Local planner, NOT the Cloud API", async () => {
    await setToggle("local");
    process.env.LLM_API_URL = "http://llm.test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );

    // The local planner (kiro-cli) is unavailable in the test env → it throws; we
    // only care that the request did NOT go to the Cloud Architect API.
    await me.plan.generate({ prompt: "build x" }).catch(() => undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
