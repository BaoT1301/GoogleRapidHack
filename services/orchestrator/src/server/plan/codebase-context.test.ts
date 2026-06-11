import { describe, expect, it } from "vitest";
import {
  CODEBASE_CONTEXT_LIMITS,
  looksLikeSecret,
  resolveCodebaseContext,
  sanitizeCodebaseContext,
} from "./codebase-context";

/**
 * PLAN-1 (Track 1): the orchestrator bakes a **server-resolved, bounded,
 * secret-free** codebase context into the plan request (`architect-plan-api.md`
 * §2 + §8a). These tests pin the security posture: nothing is forwarded raw,
 * everything is bounded, and credential-shaped data is dropped/redacted.
 */
describe("sanitizeCodebaseContext", () => {
  it("returns undefined for non-objects / empty input (absent-safe, back-compat)", () => {
    expect(sanitizeCodebaseContext(undefined)).toBeUndefined();
    expect(sanitizeCodebaseContext(null)).toBeUndefined();
    expect(sanitizeCodebaseContext("nope")).toBeUndefined();
    expect(sanitizeCodebaseContext([])).toBeUndefined();
    expect(sanitizeCodebaseContext({})).toBeUndefined();
    expect(sanitizeCodebaseContext({ unrelated: 1 })).toBeUndefined();
  });

  it("keeps a well-formed bounded context", () => {
    const out = sanitizeCodebaseContext({
      repoSummary: "Next.js orchestrator monolith.",
      files: ["src/server/routers/plan.ts", "src/server/plan/index.ts"],
      symbols: ["planRouter", "CloudArchitectProvider"],
      stats: { fileCount: 42, symbolCount: 300, languages: ["typescript", "tsx"] },
    });
    expect(out).toEqual({
      repoSummary: "Next.js orchestrator monolith.",
      files: ["src/server/routers/plan.ts", "src/server/plan/index.ts"],
      symbols: ["planRouter", "CloudArchitectProvider"],
      stats: { fileCount: 42, symbolCount: 300, languages: ["typescript", "tsx"] },
    });
  });

  it("truncates an oversized repoSummary", () => {
    const huge = "x".repeat(CODEBASE_CONTEXT_LIMITS.summaryChars + 5000);
    const out = sanitizeCodebaseContext({ repoSummary: huge });
    expect(out?.repoSummary).toBeDefined();
    expect(out!.repoSummary!.length).toBeLessThanOrEqual(
      CODEBASE_CONTEXT_LIMITS.summaryChars + " … [truncated]".length,
    );
    expect(out!.repoSummary!.endsWith("[truncated]")).toBe(true);
  });

  it("caps list length and per-item length", () => {
    const many = Array.from({ length: CODEBASE_CONTEXT_LIMITS.maxListItems + 50 }, (_, i) => `file-${i}.ts`);
    const out = sanitizeCodebaseContext({
      files: [...many, "y".repeat(CODEBASE_CONTEXT_LIMITS.itemChars + 100)],
    });
    expect(out?.files?.length).toBe(CODEBASE_CONTEXT_LIMITS.maxListItems);
    for (const f of out!.files!) {
      expect(f.length).toBeLessThanOrEqual(
        CODEBASE_CONTEXT_LIMITS.itemChars + " … [truncated]".length,
      );
    }
  });

  it("drops secret-shaped list entries and redacts secrets in the summary", () => {
    const out = sanitizeCodebaseContext({
      repoSummary: "Connect with postgres://user:hunter2@db.internal:5432/app then proceed.",
      files: [
        "src/index.ts",
        "AKIAIOSFODNN7EXAMPLE",
        "GEMINI_API_KEY=sk-abcd1234efgh5678ijkl",
      ],
      symbols: ["normalSymbol", "ghp_0123456789abcdef0123456789abcdef0123"],
    });
    expect(out?.files).toEqual(["src/index.ts"]); // secret-shaped entries dropped
    expect(out?.symbols).toEqual(["normalSymbol"]);
    expect(out?.repoSummary).not.toContain("hunter2");
    expect(out?.repoSummary).toContain("[redacted]");
  });

  it("flags common secret shapes", () => {
    expect(looksLikeSecret("AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(looksLikeSecret("ghp_0123456789abcdef0123456789abcdef0123")).toBe(true);
    expect(looksLikeSecret("DB_PASSWORD=swordfish")).toBe(true);
    expect(looksLikeSecret("postgres://u:p@h:5432/db")).toBe(true);
    expect(looksLikeSecret("src/server/plan/index.ts")).toBe(false);
    expect(looksLikeSecret("planRouter")).toBe(false);
  });
});

describe("resolveCodebaseContext", () => {
  it("sanitizes the client hint when no server resolver is supplied (never trusts raw)", async () => {
    const out = await resolveCodebaseContext({
      repoSummary: " trimmed ",
      files: ["a.ts", "AKIAIOSFODNN7EXAMPLE"],
    });
    expect(out).toEqual({ repoSummary: "trimmed", files: ["a.ts"] });
  });

  it("prefers the server-side resolver over the client hint", async () => {
    const out = await resolveCodebaseContext(
      { repoSummary: "client-supplied" },
      { resolver: () => ({ repoSummary: "server-derived", files: ["real.ts"] }) },
    );
    expect(out?.repoSummary).toBe("server-derived");
    expect(out?.files).toEqual(["real.ts"]);
  });

  it("falls back to the client hint when the resolver yields nothing", async () => {
    const out = await resolveCodebaseContext(
      { repoSummary: "client-supplied" },
      { resolver: () => undefined },
    );
    expect(out?.repoSummary).toBe("client-supplied");
  });

  it("never throws when the resolver throws — degrades to the sanitized hint", async () => {
    const out = await resolveCodebaseContext(
      { repoSummary: "client-supplied" },
      {
        resolver: () => {
          throw new Error("MCP unreachable");
        },
      },
    );
    expect(out?.repoSummary).toBe("client-supplied");
  });

  it("returns undefined when nothing usable survives (omit → byte-for-byte back-compat)", async () => {
    expect(await resolveCodebaseContext(undefined)).toBeUndefined();
    expect(await resolveCodebaseContext({})).toBeUndefined();
  });
});
