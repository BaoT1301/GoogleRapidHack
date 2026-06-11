import { describe, expect, it } from "vitest";
import { resolveAttachedContext, applyAttachedContext } from "./context-materialize";

interface N {
  id: string;
  kind?: string;
  label?: string;
  notes?: string;
  data?: unknown;
}
interface E {
  source: string;
  target: string;
  kind?: string;
}

const exec: N = { id: "ex", kind: "execute", label: "do it", data: { prompt: "build X" } };

describe("resolveAttachedContext (RUN-7 pure resolver)", () => {
  it("returns empty string when no context node is attached (absent-safe)", () => {
    const nodes: N[] = [exec];
    expect(resolveAttachedContext("ex", nodes, [])).toBe("");
  });

  it("ignores a context node that is not attached via attaches-to", () => {
    const nodes: N[] = [exec, { id: "c", kind: "context", data: { text: "hello" } }];
    // a flow edge does NOT attach context
    const edges: E[] = [{ source: "c", target: "ex", kind: "flow" }];
    expect(resolveAttachedContext("ex", nodes, edges)).toBe("");
  });

  it("materializes a context node's free text (attaches-to → execute)", () => {
    const nodes: N[] = [exec, { id: "c", kind: "context", label: "API notes", data: { text: "Use the v2 endpoint." } }];
    const edges: E[] = [{ source: "c", target: "ex", kind: "attaches-to" }];
    const out = resolveAttachedContext("ex", nodes, edges);
    expect(out).toContain("## Attached context");
    expect(out).toContain("UNTRUSTED DATA");
    expect(out).toContain("### API notes");
    expect(out).toContain("Use the v2 endpoint.");
  });

  it("works in EITHER edge direction (execute → context attaches-to)", () => {
    const nodes: N[] = [exec, { id: "c", kind: "context", data: { notes: "watch the rate limit" } }];
    const edges: E[] = [{ source: "ex", target: "c", kind: "attaches-to" }];
    expect(resolveAttachedContext("ex", nodes, edges)).toContain("watch the rate limit");
  });

  it("materializes WOW-3 captured grounding ({ context: { fromNodes, diffPreview, lastError } })", () => {
    const nodes: N[] = [
      exec,
      {
        id: "c",
        kind: "context",
        data: { context: { fromNodes: ["n1", "n2"], diffPreview: "diff --git a b", lastError: "TypeError: boom" } },
      },
    ];
    const edges: E[] = [{ source: "c", target: "ex", kind: "attaches-to" }];
    const out = resolveAttachedContext("ex", nodes, edges);
    expect(out).toContain("n1, n2");
    expect(out).toContain("diff --git a b");
    expect(out).toContain("TypeError: boom");
  });

  it("merges multiple attached context nodes", () => {
    const nodes: N[] = [
      exec,
      { id: "c1", kind: "context", label: "one", data: { text: "alpha" } },
      { id: "c2", kind: "context", label: "two", data: { text: "beta" } },
    ];
    const edges: E[] = [
      { source: "c1", target: "ex", kind: "attaches-to" },
      { source: "c2", target: "ex", kind: "attaches-to" },
    ];
    const out = resolveAttachedContext("ex", nodes, edges);
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
  });

  it("only counts context-kind nodes (an attached execute node contributes nothing)", () => {
    const nodes: N[] = [exec, { id: "other", kind: "execute", data: { text: "not context" } }];
    const edges: E[] = [{ source: "other", target: "ex", kind: "attaches-to" }];
    expect(resolveAttachedContext("ex", nodes, edges)).toBe("");
  });

  it("bounds the total size (size cap) and never throws on a huge blob", () => {
    const huge = "x".repeat(50_000);
    const nodes: N[] = [exec, { id: "c", kind: "context", data: { text: huge } }];
    const edges: E[] = [{ source: "c", target: "ex", kind: "attaches-to" }];
    const out = resolveAttachedContext("ex", nodes, edges);
    expect(out.length).toBeLessThan(10_000);
    expect(out).toContain("truncated");
  });

  it("never throws on malformed data shapes", () => {
    const nodes: N[] = [
      exec,
      { id: "c1", kind: "context", data: null },
      { id: "c2", kind: "context", data: 42 as unknown },
      { id: "c3", kind: "context", data: { context: "not-an-object" } },
    ];
    const edges: E[] = [
      { source: "c1", target: "ex", kind: "attaches-to" },
      { source: "c2", target: "ex", kind: "attaches-to" },
      { source: "c3", target: "ex", kind: "attaches-to" },
    ];
    expect(() => resolveAttachedContext("ex", nodes, edges)).not.toThrow();
    expect(resolveAttachedContext("ex", nodes, edges)).toBe("");
  });
});

describe("applyAttachedContext", () => {
  it("returns the base prompt UNCHANGED when there is no context (byte-identical)", () => {
    expect(applyAttachedContext("base prompt", "")).toBe("base prompt");
  });

  it("prepends the context block above the base prompt with a delimiter", () => {
    const out = applyAttachedContext("base prompt", "## Attached context\n\nfoo");
    expect(out.startsWith("## Attached context")).toBe(true);
    expect(out).toContain("---");
    expect(out.endsWith("base prompt")).toBe(true);
  });
});
