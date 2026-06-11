// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getLastUsedAgent,
  saveLastUsedAgent,
  getLastUsedModel,
  saveLastUsedModel,
} from "./last-used-agent";

describe("last-used-agent storage helper", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns null when no agent has been saved", () => {
    expect(getLastUsedAgent()).toBeNull();
  });

  it("saves and retrieves a valid agent", () => {
    saveLastUsedAgent("claude");
    expect(getLastUsedAgent()).toBe("claude");

    saveLastUsedAgent("kiro");
    expect(getLastUsedAgent()).toBe("kiro");
  });

  it("ignores saving invalid agents", () => {
    saveLastUsedAgent("unsupported-agent");
    expect(getLastUsedAgent()).toBeNull();

    saveLastUsedAgent("fake"); // fake is not in the VALID_AGENTS list
    expect(getLastUsedAgent()).toBeNull();
  });

  it("ignores invalid values stored directly in localStorage", () => {
    window.localStorage.setItem("orchestrator:lastUsedAgent", "hacker-agent");
    expect(getLastUsedAgent()).toBeNull();
  });

  it("saves and retrieves models per provider", () => {
    saveLastUsedModel("gemini", "gemini-2.5-pro");
    expect(getLastUsedModel("gemini")).toBe("gemini-2.5-pro");

    saveLastUsedModel("claude", "claude-sonnet-4");
    expect(getLastUsedModel("claude")).toBe("claude-sonnet-4");
    
    // gemini model is preserved
    expect(getLastUsedModel("gemini")).toBe("gemini-2.5-pro");
  });

  it("handles parse errors gracefully", () => {
    window.localStorage.setItem("orchestrator:lastUsedModelByProvider", "{invalid-json}");
    expect(getLastUsedModel("gemini")).toBeNull();
  });
});
