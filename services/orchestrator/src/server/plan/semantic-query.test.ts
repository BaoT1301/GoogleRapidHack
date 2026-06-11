import { describe, expect, it } from "vitest";
import { cosineSimilarity, hybridMatches } from "./semantic-query";

describe("cosineSimilarity", () => {
  it("is 1 for identical, 0 for orthogonal/empty", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([], [1])).toBe(0);
  });
});

describe("hybridMatches", () => {
  const kb = {
    symbols: ["login — src/session.ts", "BillingService — src/billing.ts"],
    files: ["src/session.ts", "src/billing.ts"],
    // login≈[1,0,0]; billing≈[0,1,0]
    symbolVectors: [
      [1, 0, 0],
      [0, 1, 0],
    ],
  };

  it("surfaces semantically-related code even with NO lexical overlap", async () => {
    // Query "auth" shares no token with "login"/"billing" (pure lexical → nothing),
    // but its embedding is near the login vector → semantic ranks login first.
    const embedder = async () => [[0.9, 0.1, 0]]; // close to login
    const r = await hybridMatches(kb, "auth", { embedder });
    expect(r.symbols[0]).toContain("login");
  });

  it("falls back to pure lexical when no embedder is provided", async () => {
    const r = await hybridMatches(kb, "billing", {});
    // Lexical: "billing" matches the BillingService symbol only.
    expect(r.symbols).toEqual(["BillingService — src/billing.ts"]);
  });

  it("falls back to lexical when the embedder throws", async () => {
    const embedder = async () => {
      throw new Error("embed down");
    };
    const r = await hybridMatches(kb, "billing", { embedder });
    expect(r.symbols).toEqual(["BillingService — src/billing.ts"]);
  });
});
