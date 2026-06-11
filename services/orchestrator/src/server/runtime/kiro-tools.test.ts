import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALLOWED_TOOLS,
  KIRO_CANONICAL_TOOLS,
  normalizeAllowedTools,
  toTrustToolsArg,
} from "./kiro-tools";

describe("kiro-tools (CLI-4 allowed-tools)", () => {
  it("canonical set classifies fs_read=read, fs_write=write", () => {
    const byName = Object.fromEntries(KIRO_CANONICAL_TOOLS.map((t) => [t.name, t.kind]));
    expect(byName.fs_read).toBe("read");
    expect(byName.fs_write).toBe("write");
  });

  it("default allowed set is read-only", () => {
    expect([...DEFAULT_ALLOWED_TOOLS]).toEqual(["fs_read"]);
  });

  it("keeps only known tools, de-dupes, preserves canonical order", () => {
    expect(normalizeAllowedTools(["fs_write", "fs_read", "fs_read"])).toEqual(["fs_read", "fs_write"]);
  });

  it("drops unknown/invented tokens (e.g. legacy 'read,grep')", () => {
    expect(normalizeAllowedTools(["read", "grep", "fs_read"])).toEqual(["fs_read"]);
    expect(normalizeAllowedTools(["totally_made_up"])).toEqual(["fs_read"]); // → default
  });

  it("NEVER allows trust-all / wildcard", () => {
    expect(normalizeAllowedTools(["*"])).toEqual(["fs_read"]);
    expect(normalizeAllowedTools(["all", "ALL"])).toEqual(["fs_read"]);
  });

  it("empty/undefined → read-only default", () => {
    expect(normalizeAllowedTools([])).toEqual(["fs_read"]);
    expect(normalizeAllowedTools(undefined)).toEqual(["fs_read"]);
  });

  it("toTrustToolsArg joins the normalized set", () => {
    expect(toTrustToolsArg(["fs_read", "fs_write", "*"])).toBe("fs_read,fs_write");
  });
});
