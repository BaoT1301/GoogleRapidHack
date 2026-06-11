import { describe, expect, it } from "vitest";
import {
  CircuitBreaker,
  DEFAULT_BREAKER_THRESHOLD,
  normalizeError,
  shouldHalt,
  signatureKey,
} from "./circuit-breaker";

describe("circuit-breaker — shouldHalt (SEC-4)", () => {
  it("halts after 3 identical consecutive failures", () => {
    const sigs = [
      { nodeKind: "execute", error: "exit:1" },
      { nodeKind: "execute", error: "exit:1" },
      { nodeKind: "execute", error: "exit:1" },
    ];
    expect(shouldHalt(sigs)).toBe(true);
  });

  it("does NOT halt on mixed errors", () => {
    const sigs = [
      { nodeKind: "execute", error: "exit:1" },
      { nodeKind: "execute", error: "timeout" },
      { nodeKind: "execute", error: "exit:1" },
    ];
    expect(shouldHalt(sigs)).toBe(false);
  });

  it("does NOT halt on identical errors of DIFFERENT node kinds", () => {
    const sigs = [
      { nodeKind: "execute", error: "boom" },
      { nodeKind: "review", error: "boom" },
      { nodeKind: "doc", error: "boom" },
    ];
    expect(shouldHalt(sigs)).toBe(false);
  });

  it("does NOT halt with fewer than threshold failures", () => {
    expect(
      shouldHalt([
        { nodeKind: "execute", error: "exit:1" },
        { nodeKind: "execute", error: "exit:1" },
      ]),
    ).toBe(false);
  });

  it("only considers the MOST RECENT threshold (consecutive) failures", () => {
    // Two early identical, then a distinct, then three identical → trips on the tail.
    const sigs = [
      { nodeKind: "execute", error: "old" },
      { nodeKind: "execute", error: "old" },
      { nodeKind: "execute", error: "different" },
      { nodeKind: "execute", error: "exit:1" },
      { nodeKind: "execute", error: "exit:1" },
      { nodeKind: "execute", error: "exit:1" },
    ];
    expect(shouldHalt(sigs)).toBe(true);
  });

  it("treats numerically-different but structurally-identical errors as the same", () => {
    const sigs = [
      { nodeKind: "execute", error: "timeout after 1000ms" },
      { nodeKind: "execute", error: "timeout after 2000ms" },
      { nodeKind: "execute", error: "timeout after 9999ms" },
    ];
    expect(shouldHalt(sigs)).toBe(true);
  });

  it("threshold <= 0 disables the breaker", () => {
    const sigs = [
      { nodeKind: "execute", error: "x" },
      { nodeKind: "execute", error: "x" },
      { nodeKind: "execute", error: "x" },
    ];
    expect(shouldHalt(sigs, 0)).toBe(false);
  });

  it("exposes a default threshold of 3", () => {
    expect(DEFAULT_BREAKER_THRESHOLD).toBe(3);
  });
});

describe("circuit-breaker — normalizeError / signatureKey", () => {
  it("masks digits and long hex and lowercases", () => {
    expect(normalizeError("Exit 42 at deadBEEFdeadBEEF")).toBe("exit # at #");
  });

  it("handles null/undefined safely", () => {
    expect(normalizeError(undefined)).toBe("");
    expect(normalizeError(null)).toBe("");
  });

  it("signatureKey combines normalized kind + error", () => {
    expect(signatureKey({ nodeKind: "Execute", error: "Exit:1" })).toBe(
      "execute::exit:#",
    );
    expect(signatureKey({ nodeKind: "", error: "x" })).toBe("unknown::x");
  });
});

describe("circuit-breaker — CircuitBreaker class", () => {
  it("trips on the 3rd identical failure and stays tripped", () => {
    const breaker = new CircuitBreaker();
    expect(breaker.record({ nodeKind: "execute", error: "exit:1" })).toBe(false);
    expect(breaker.tripped).toBe(false);
    expect(breaker.record({ nodeKind: "execute", error: "exit:1" })).toBe(false);
    expect(breaker.record({ nodeKind: "execute", error: "exit:1" })).toBe(true);
    expect(breaker.tripped).toBe(true);
    expect(breaker.reason()).toContain("circuit breaker");
    expect(breaker.reason()).toContain("execute::exit:#");
  });

  it("does not trip on interleaved distinct failures", () => {
    const breaker = new CircuitBreaker();
    breaker.record({ nodeKind: "execute", error: "a" });
    breaker.record({ nodeKind: "execute", error: "b" });
    breaker.record({ nodeKind: "execute", error: "a" });
    expect(breaker.tripped).toBe(false);
  });

  it("honors a custom threshold", () => {
    const breaker = new CircuitBreaker(2);
    expect(breaker.record({ nodeKind: "doc", error: "scope" })).toBe(false);
    expect(breaker.record({ nodeKind: "doc", error: "scope" })).toBe(true);
  });
});
