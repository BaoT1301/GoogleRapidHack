import { afterEach, describe, expect, it } from "vitest";
import {
  __resetSecretsForTest,
  redactSecrets,
  registerSecret,
  subprocessKeyEnv,
} from "./secret-redaction";

afterEach(() => __resetSecretsForTest());

describe("redactSecrets (no-leak guard)", () => {
  it("masks a registered secret value anywhere in an event payload", () => {
    const KEY = "sk-live-abcdef0123456789";
    registerSecret(KEY);
    const event = {
      type: "node.stderr",
      runId: "r1",
      nodeId: "n1",
      timestamp: "t",
      payload: { line: `export KIRO_API_KEY=${KEY}` },
    };
    const safe = redactSecrets(event);
    const json = JSON.stringify(safe);
    expect(json).not.toContain(KEY);
    expect(json).toContain("***");
  });

  it("is a no-op when nothing is registered", () => {
    const event = { type: "node.stdout", runId: "r", nodeId: "n", timestamp: "t", payload: { line: "hello" } };
    expect(redactSecrets(event)).toBe(event);
  });

  it("ignores too-short values (won't mask empty/short strings)", () => {
    registerSecret("abc");
    const event = { type: "node.stdout", runId: "r", nodeId: "n", timestamp: "t", payload: { line: "abc def" } };
    expect(redactSecrets(event).payload.line).toBe("abc def");
  });

  it("SEC-2 pattern backstop masks an UNREGISTERED credential-shaped token", () => {
    // Nothing registered — the pattern backstop alone must mask these.
    const event = {
      type: "node.stdout",
      runId: "r",
      nodeId: "n",
      timestamp: "t",
      payload: {
        a: "leaked OPENAI sk-abcdef0123456789ABCDEF",
        b: "token ghp_ABCDEFGHIJ0123456789xyz",
        c: "aws AKIAABCDEFGHIJKLMNOP",
      },
    };
    const json = JSON.stringify(redactSecrets(event));
    expect(json).not.toContain("sk-abcdef0123456789ABCDEF");
    expect(json).not.toContain("ghp_ABCDEFGHIJ0123456789xyz");
    expect(json).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(json).toContain("***");
  });

  it("does NOT over-mask ordinary output", () => {
    const event = {
      type: "node.stdout",
      runId: "r",
      nodeId: "n",
      timestamp: "t",
      payload: { line: "Build succeeded in 4.2s; 0 errors, 0 warnings." },
    };
    // Reference unchanged ⇒ nothing was masked.
    expect(redactSecrets(event)).toBe(event);
  });
});

describe("subprocessKeyEnv (host-login first)", () => {
  it("host-login injects NO key (subprocess inherits the login)", () => {
    expect(subprocessKeyEnv("host-login", "sk-fallback-123456")).toEqual({});
  });

  it("api-key fallback injects the key into the subprocess env", () => {
    expect(subprocessKeyEnv("api-key", "sk-fallback-123456")).toEqual({
      KIRO_API_KEY: "sk-fallback-123456",
    });
  });

  it("no authMode (non-Kiro CLI) injects nothing", () => {
    expect(subprocessKeyEnv(undefined, "sk-fallback-123456")).toEqual({});
  });

  it("fallback mode with no resolvable key injects nothing", () => {
    expect(subprocessKeyEnv("api-key", undefined)).toEqual({});
  });
});
