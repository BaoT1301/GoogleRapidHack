import { afterEach, describe, expect, it } from "vitest";
import { resolveKiroAuthMode, checkCliCapability } from "./cli-capabilities";

// CLI-1: prefer host login; KIRO_API_KEY is an optional fallback only.
describe("resolveKiroAuthMode (Kiro auth, owner choice C)", () => {
  it("host-login only → available, authMode host-login", () => {
    const r = resolveKiroAuthMode({ installed: true, hostLoggedIn: true, apiKeyPresent: false });
    expect(r.available).toBe(true);
    expect(r.authMode).toBe("host-login");
    expect(r.requiresApiKey).toBe(false);
  });

  it("api-key only → available, authMode api-key (fallback)", () => {
    const r = resolveKiroAuthMode({ installed: true, hostLoggedIn: false, apiKeyPresent: true });
    expect(r.available).toBe(true);
    expect(r.authMode).toBe("api-key");
    expect(r.requiresApiKey).toBe(false);
  });

  it("neither → unavailable, authMode unauthenticated, actionable fix", () => {
    const r = resolveKiroAuthMode({ installed: true, hostLoggedIn: false, apiKeyPresent: false });
    expect(r.available).toBe(false);
    expect(r.authMode).toBe("unauthenticated");
    expect(r.suggestedFix).toMatch(/kiro-cli login/);
  });

  it("not installed → unavailable (does NOT hard-fail solely on missing key)", () => {
    const r = resolveKiroAuthMode({ installed: false, hostLoggedIn: false, apiKeyPresent: false });
    expect(r.available).toBe(false);
    expect(r.authMode).toBe("unauthenticated");
  });

  it("host login wins even when a key is also present", () => {
    const r = resolveKiroAuthMode({ installed: true, hostLoggedIn: true, apiKeyPresent: true });
    expect(r.authMode).toBe("host-login");
  });
});

describe("checkKiroCapability mock overrides", () => {
  afterEach(() => {
    delete process.env.ORCH_TEST_KIRO_AVAILABLE;
  });

  it("returns available and host-login when ORCH_TEST_KIRO_AVAILABLE is 1", async () => {
    process.env.ORCH_TEST_KIRO_AVAILABLE = "1";
    const res = await checkCliCapability("kiro");
    expect(res.available).toBe(true);
    expect(res.authMode).toBe("host-login");
    expect(res.version).toContain("mock");
  });

  it("returns unavailable and unauthenticated when ORCH_TEST_KIRO_AVAILABLE is 0", async () => {
    process.env.ORCH_TEST_KIRO_AVAILABLE = "0";
    const res = await checkCliCapability("kiro");
    expect(res.available).toBe(false);
    expect(res.authMode).toBe("unauthenticated");
    expect(res.note).toMatch(/not found/i);
    expect(res.suggestedFix).toMatch(/kiro-cli login/i);
  });
});
