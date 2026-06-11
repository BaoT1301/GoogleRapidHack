import { describe, expect, it } from "vitest";
import {
  extractQueryTerms,
  queryCodebaseKb,
  queryCodebaseMatches,
  scoreItem,
} from "./query-codebase";

describe("extractQueryTerms", () => {
  it("lowercases, drops short tokens + stopwords, dedupes", () => {
    expect(extractQueryTerms("Add 2FA to the AUTH auth system")).toEqual(["2fa", "auth"]);
    expect(extractQueryTerms("refactor the billing service")).toEqual(["billing", "service"]);
  });
});

describe("scoreItem", () => {
  it("scores substring hits, 0 when no terms or no match", () => {
    expect(scoreItem("authenticateUser — src/auth.ts", ["auth"])).toBeGreaterThan(0);
    expect(scoreItem("BillingService — src/billing.ts", ["auth"])).toBe(0);
    expect(scoreItem("anything", [])).toBe(0);
  });
});

describe("queryCodebaseKb (focus)", () => {
  const kb = {
    repoSummary: "demo",
    symbols: [
      "BillingService — src/billing.ts",
      "authenticateUser — src/auth.ts",
      "refreshToken — src/auth.ts",
    ],
    files: ["src/billing.ts", "src/auth.ts"],
    stats: { fileCount: 2 },
  };

  it("ranks relevant symbols/files first for the task", () => {
    const focused = queryCodebaseKb(kb, "add 2FA to auth");
    expect(focused?.symbols?.[0]).toContain("auth.ts");
    expect(focused?.files?.[0]).toBe("src/auth.ts");
    // repoSummary + stats preserved.
    expect(focused?.repoSummary).toBe("demo");
    expect(focused?.stats?.fileCount).toBe(2);
  });

  it("keeps everything (just reordered) when under the cap — no data loss for small repos", () => {
    const focused = queryCodebaseKb(kb, "auth");
    expect(focused?.symbols).toHaveLength(3);
    expect(focused?.files).toHaveLength(2);
  });

  it("trims to the top-K relevant when over the cap", () => {
    const many = {
      symbols: Array.from({ length: 100 }, (_, i) => `sym${i} — src/f${i}.ts`).concat([
        "authHandler — src/auth.ts",
      ]),
      files: ["src/auth.ts"],
    };
    const focused = queryCodebaseKb(many, "auth", { maxSymbols: 5 });
    expect(focused?.symbols).toHaveLength(5);
    expect(focused?.symbols?.[0]).toContain("auth"); // relevant one floated to the top
  });

  it("returns undefined for an empty KB (caller falls back)", () => {
    expect(queryCodebaseKb({}, "anything")).toBeUndefined();
  });
});

describe("queryCodebaseMatches (tool hits)", () => {
  it("returns only score>0 matches, ranked", () => {
    const r = queryCodebaseMatches(
      {
        symbols: ["authenticateUser — src/auth.ts", "BillingService — src/billing.ts"],
        files: ["src/auth.ts", "src/billing.ts"],
      },
      "auth",
    );
    expect(r.symbols).toEqual(["authenticateUser — src/auth.ts"]);
    expect(r.files).toEqual(["src/auth.ts"]);
  });
});
