import { describe, it, expect } from "vitest";
import { enrichFromLines } from "./extract-signatures";

const SYMBOL = "createUser — src/users.ts";

describe("enrichFromLines", () => {
  it("folds in the declaration line (signature)", () => {
    const lines = [
      "import x from 'y';",
      "export function createUser(name: string, age: number): User {",
      "  return { name, age };",
    ];
    const out = enrichFromLines(SYMBOL, lines, 2);
    expect(out).toContain("createUser — src/users.ts ::");
    expect(out).toContain("export function createUser(name: string, age: number): User");
  });

  it("folds in a leading JSDoc block above the declaration", () => {
    const lines = [
      "/**",
      " * Create a new user record.",
      " * @param name the display name",
      " */",
      "export function createUser(name: string): User {",
    ];
    const out = enrichFromLines(SYMBOL, lines, 5);
    expect(out).toContain("export function createUser(name: string): User");
    expect(out).toMatch(/Create a new user record/);
  });

  it("folds in a leading // comment", () => {
    const lines = ["// charges the customer's card", "export function charge(amount: number) {"];
    const out = enrichFromLines(SYMBOL, lines, 2);
    expect(out).toMatch(/charges the customer's card/);
  });

  it("supports python-style # comments and def lines", () => {
    const lines = ["# compute the monthly total", "def monthly_total(rows):"];
    const out = enrichFromLines("monthly_total — billing.py", lines, 2);
    expect(out).toContain("def monthly_total(rows):");
    expect(out).toMatch(/compute the monthly total/);
  });

  it("stops at a blank line (does not pull unrelated comments)", () => {
    const lines = [
      "// unrelated earlier comment",
      "",
      "export function foo() {",
    ];
    const out = enrichFromLines(SYMBOL, lines, 3);
    expect(out).toContain("export function foo()");
    expect(out).not.toMatch(/unrelated earlier comment/);
  });

  it("returns the symbol unchanged for an out-of-range or missing line", () => {
    const lines = ["a", "b"];
    expect(enrichFromLines(SYMBOL, lines, 99)).toBe(SYMBOL);
    expect(enrichFromLines(SYMBOL, lines, undefined)).toBe(SYMBOL);
  });

  it("clamps very long enriched strings", () => {
    const long = "export function f(" + "x: string, ".repeat(60) + ") {";
    const out = enrichFromLines(SYMBOL, [long], 1);
    expect(out.length).toBeLessThanOrEqual(221); // MAX_ENRICHED + ellipsis
    expect(out.endsWith("…")).toBe(true);
  });
});
