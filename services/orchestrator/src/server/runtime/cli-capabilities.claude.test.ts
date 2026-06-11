import { afterEach, describe, expect, it } from "vitest";
import { resolveClaudeAuthMode, checkCliCapability, checkClaudeAvailableSync } from "./cli-capabilities";

describe("resolveClaudeAuthMode (Claude auth)", () => {
  it("host-login only → available, authMode host-login", () => {
    const r = resolveClaudeAuthMode({ installed: true, hostLoggedIn: true, apiKeyPresent: false });
    expect(r.available).toBe(true);
    expect(r.authMode).toBe("host-login");
    expect(r.requiresApiKey).toBe(false);
  });

  it("api-key only → available, authMode api-key (fallback)", () => {
    const r = resolveClaudeAuthMode({ installed: true, hostLoggedIn: false, apiKeyPresent: true });
    expect(r.available).toBe(true);
    expect(r.authMode).toBe("api-key");
    expect(r.requiresApiKey).toBe(false);
  });

  it("neither → unavailable, authMode unauthenticated, suggested fix hint", () => {
    const r = resolveClaudeAuthMode({ installed: true, hostLoggedIn: false, apiKeyPresent: false });
    expect(r.available).toBe(false);
    expect(r.authMode).toBe("unauthenticated");
    expect(r.suggestedFix).toMatch(/claude auth login/);
  });

  it("not installed → unavailable", () => {
    const r = resolveClaudeAuthMode({ installed: false, hostLoggedIn: false, apiKeyPresent: false });
    expect(r.available).toBe(false);
    expect(r.authMode).toBe("unauthenticated");
  });
});

describe("checkClaudeCapability mock overrides", () => {
  afterEach(() => {
    delete process.env.ORCH_TEST_CLAUDE_AVAILABLE;
  });

  it("returns available and host-login when ORCH_TEST_CLAUDE_AVAILABLE is 1", async () => {
    process.env.ORCH_TEST_CLAUDE_AVAILABLE = "1";
    const res = await checkCliCapability("claude");
    expect(res.available).toBe(true);
    expect(res.authMode).toBe("host-login");
    expect(res.version).toContain("mock");
  });

  it("returns unavailable and unauthenticated when ORCH_TEST_CLAUDE_AVAILABLE is 0", async () => {
    process.env.ORCH_TEST_CLAUDE_AVAILABLE = "0";
    const res = await checkCliCapability("claude");
    expect(res.available).toBe(false);
    expect(res.authMode).toBe("unauthenticated");
    expect(res.note).toMatch(/not found/i);
    expect(res.suggestedFix).toMatch(/claude auth login/i);
  });
});

describe("checkClaudeAvailableSync mock overrides", () => {
  afterEach(() => {
    delete process.env.ORCH_TEST_CLAUDE_AVAILABLE;
  });

  it("returns true when ORCH_TEST_CLAUDE_AVAILABLE is 1", () => {
    process.env.ORCH_TEST_CLAUDE_AVAILABLE = "1";
    expect(checkClaudeAvailableSync()).toBe(true);
  });

  it("returns false when ORCH_TEST_CLAUDE_AVAILABLE is 0", () => {
    process.env.ORCH_TEST_CLAUDE_AVAILABLE = "0";
    expect(checkClaudeAvailableSync()).toBe(false);
  });
});
