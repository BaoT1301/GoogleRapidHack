import { afterEach, describe, expect, it } from "vitest";
import {
  CloudArchitectProvider,
  LocalCliArchitectProvider,
  resolvePlanProviderName,
  selectPlanProvider,
} from "./index";

/**
 * Integration seam (Track 6): the provider-switch ↔ contract boundary.
 * Proves the Settings toggle / env / default resolve to the correct PlanProvider
 * so `plan.generate({ provider })` routes Cloud vs Local as intended (Cloud default).
 */
describe("plan provider selection seam", () => {
  const saved = process.env.ORCH_PLAN_PROVIDER;
  afterEach(() => {
    if (saved === undefined) delete process.env.ORCH_PLAN_PROVIDER;
    else process.env.ORCH_PLAN_PROVIDER = saved;
  });

  it("resolves explicit request first (cloud/local)", () => {
    expect(resolvePlanProviderName("local")).toBe("local");
    expect(resolvePlanProviderName("cloud")).toBe("cloud");
  });

  it("falls back to ORCH_PLAN_PROVIDER env, then Cloud default", () => {
    delete process.env.ORCH_PLAN_PROVIDER;
    expect(resolvePlanProviderName(undefined)).toBe("cloud"); // default

    process.env.ORCH_PLAN_PROVIDER = "local";
    expect(resolvePlanProviderName(undefined)).toBe("local");

    process.env.ORCH_PLAN_PROVIDER = "garbage";
    expect(resolvePlanProviderName(undefined)).toBe("cloud"); // unknown → safe Cloud default
  });

  it("honors the persisted user setting (toggle) over env, under an explicit request (P5)", () => {
    delete process.env.ORCH_PLAN_PROVIDER;
    // No explicit request → the user's saved toggle wins.
    expect(resolvePlanProviderName(undefined, "local")).toBe("local");
    expect(resolvePlanProviderName(undefined, "cloud")).toBe("cloud");
    // An explicit request still beats the saved toggle.
    expect(resolvePlanProviderName("cloud", "local")).toBe("cloud");
    // User toggle beats the env override.
    process.env.ORCH_PLAN_PROVIDER = "local";
    expect(resolvePlanProviderName(undefined, "cloud")).toBe("cloud");
    // No request + no toggle → env, then default.
    expect(resolvePlanProviderName(undefined, undefined)).toBe("local");
  });

  it("instantiates the matching provider implementation", () => {
    expect(selectPlanProvider("cloud")).toBeInstanceOf(CloudArchitectProvider);
    expect(selectPlanProvider("local")).toBeInstanceOf(LocalCliArchitectProvider);
    expect(selectPlanProvider("cloud").name).toBe("cloud");
    expect(selectPlanProvider("local").name).toBe("local");
  });
});
