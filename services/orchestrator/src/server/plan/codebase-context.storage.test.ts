import { describe, expect, it } from "vitest";
import {
  sanitizeCodebaseContext,
  CODEBASE_CONTEXT_LIMITS,
  CODEBASE_STORAGE_LIMITS,
} from "./codebase-context";

describe("sanitizeCodebaseContext caps (B1 — store rich, request bounded)", () => {
  const bigSymbols = Array.from({ length: 500 }, (_, i) => `sym${i} — src/f${i}.ts`);
  const bigFiles = Array.from({ length: 500 }, (_, i) => `src/f${i}.ts`);

  it("default (per-request) caps lists at 100 items", () => {
    const r = sanitizeCodebaseContext({ symbols: bigSymbols, files: bigFiles });
    expect(r?.symbols?.length).toBe(CODEBASE_CONTEXT_LIMITS.maxListItems);
    expect(r?.files?.length).toBe(CODEBASE_CONTEXT_LIMITS.maxListItems);
  });

  it("storage caps keep the rich set (well over the per-request cap)", () => {
    const r = sanitizeCodebaseContext({ symbols: bigSymbols, files: bigFiles }, CODEBASE_STORAGE_LIMITS);
    expect(r?.symbols?.length).toBe(500); // under the 1500 storage cap → all kept
    expect(r?.files?.length).toBe(500);
  });

  it("still drops secret-looking entries even at storage caps", () => {
    const r = sanitizeCodebaseContext(
      { symbols: ["safeSymbol — a.ts", "API_KEY=sk-abcdef0123456789abcdef"] },
      CODEBASE_STORAGE_LIMITS,
    );
    expect(r?.symbols).toEqual(["safeSymbol — a.ts"]);
  });
});
