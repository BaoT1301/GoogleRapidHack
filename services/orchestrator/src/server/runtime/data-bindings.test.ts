import { describe, expect, it } from "vitest";
import { resolveDataBindings } from "./data-bindings";

describe("resolveDataBindings (MODEL-2 sandboxed binding)", () => {
  it("substitutes a simple upstream field", () => {
    const { text, unresolved } = resolveDataBindings(
      "Use the summary: {{upstream.up.summary}}",
      { up: { summary: "all green" } },
    );
    expect(text).toBe("Use the summary: all green");
    expect(unresolved).toEqual([]);
  });

  it("resolves nested dot-paths and array indices", () => {
    const { text } = resolveDataBindings(
      "first file: {{upstream.up.filesChanged.0}} / nested: {{upstream.up.meta.deep.value}}",
      { up: { filesChanged: ["a.ts", "b.ts"], meta: { deep: { value: 42 } } } },
    );
    expect(text).toBe("first file: a.ts / nested: 42");
  });

  it("stringifies object/array values as compact JSON", () => {
    const { text } = resolveDataBindings("payload: {{upstream.up.obj}}", {
      up: { obj: { a: 1, b: [2, 3] } },
    });
    expect(text).toBe('payload: {"a":1,"b":[2,3]}');
  });

  it("leaves a placeholder UNTOUCHED when the upstream node is not in the map", () => {
    const { text, unresolved } = resolveDataBindings("x {{upstream.missing.foo}} y", {});
    expect(text).toBe("x {{upstream.missing.foo}} y");
    expect(unresolved).toEqual(["{{upstream.missing.foo}}"]);
  });

  it("marks an unresolved dotpath when the node ran but the field is absent", () => {
    const { text, unresolved } = resolveDataBindings("v={{upstream.up.nope}}", {
      up: { summary: "x" },
    });
    expect(text).toBe("v=[unresolved: upstream.up.nope]");
    expect(unresolved).toEqual(["{{upstream.up.nope}}"]);
  });

  it("REJECTS prototype-polluting key paths (never traverses __proto__/constructor/prototype)", () => {
    const polluted = { up: { summary: "ok" } };
    const { text, unresolved } = resolveDataBindings(
      "a={{upstream.up.__proto__.polluted}} b={{upstream.up.constructor.name}} c={{upstream.up.prototype.x}}",
      polluted,
    );
    expect(text).toContain("[unresolved: upstream.up.__proto__.polluted]");
    expect(text).toContain("[unresolved: upstream.up.constructor.name]");
    expect(text).toContain("[unresolved: upstream.up.prototype.x]");
    expect(unresolved).toHaveLength(3);
    // The global prototype is never mutated.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("caps a single oversized value", () => {
    const big = "x".repeat(10_000);
    const { text } = resolveDataBindings("{{upstream.up.big}}", { up: { big } });
    expect(text.length).toBeLessThan(big.length);
    expect(text).toContain("…[truncated]");
  });

  it("is whitespace-tolerant inside the braces", () => {
    const { text } = resolveDataBindings("{{ upstream.up.summary }}", {
      up: { summary: "ok" },
    });
    expect(text).toBe("ok");
  });

  it("never throws and is empty-safe", () => {
    expect(resolveDataBindings("", {})).toEqual({ text: "", unresolved: [] });
    expect(() =>
      // @ts-expect-error — exercising the non-string guard
      resolveDataBindings(null, {}),
    ).not.toThrow();
    const plain = resolveDataBindings("no placeholders here", { up: { a: 1 } });
    expect(plain.text).toBe("no placeholders here");
  });
});
