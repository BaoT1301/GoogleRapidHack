import { describe, expect, it } from "vitest";
import { assembleNodePrompt } from "./prompt-assembly";

const ctxNode = {
  id: "ctx",
  kind: "context",
  label: "Notes",
  data: { text: "be accessible" },
};

describe("assembleNodePrompt (MODEL-2 single source of truth)", () => {
  it("composes data binding THEN attached context", () => {
    const exec = { id: "ex", kind: "execute", data: { prompt: "build {{upstream.up.summary}}" } };
    const { prompt, unresolvedBindings, attachedContextPresent } = assembleNodePrompt({
      node: exec,
      nodes: [exec, ctxNode],
      edges: [{ source: "ctx", target: "ex", kind: "attaches-to" }],
      upstreamOutputs: { up: { summary: "the widget" } },
    });
    expect(prompt).toContain("## Attached context");
    expect(prompt).toContain("be accessible");
    // The data binding is resolved inside the base prompt.
    expect(prompt).toContain("build the widget");
    expect(attachedContextPresent).toBe(true);
    expect(unresolvedBindings).toEqual([]);
  });

  it("is byte-identical to the base prompt with no data edges + no attached context", () => {
    const exec = { id: "ex", kind: "execute", data: { prompt: "implement the widget" } };
    const { prompt, attachedContextPresent } = assembleNodePrompt({
      node: exec,
      nodes: [exec],
      edges: [],
    });
    expect(prompt).toBe("implement the widget");
    expect(attachedContextPresent).toBe(false);
  });

  it("falls back to defaultPrompt then label when data.prompt is absent", () => {
    const review = { id: "rv", kind: "review", label: "audit me", data: {} };
    expect(
      assembleNodePrompt({ node: review, nodes: [review], edges: [], defaultPrompt: "Audit X" })
        .prompt,
    ).toBe("Audit X");
    const noPrompt = { id: "n", kind: "execute", label: "just a label", data: {} };
    expect(assembleNodePrompt({ node: noPrompt, nodes: [noPrompt], edges: [] }).prompt).toBe(
      "just a label",
    );
  });

  it("reports unresolved bindings (dry-run / empty upstream outputs)", () => {
    const exec = { id: "ex", kind: "execute", data: { prompt: "use {{upstream.up.summary}}" } };
    const { unresolvedBindings, prompt } = assembleNodePrompt({
      node: exec,
      nodes: [exec],
      edges: [],
      upstreamOutputs: {},
    });
    expect(unresolvedBindings).toEqual(["{{upstream.up.summary}}"]);
    // Unresolved placeholder is left untouched (upstream not provided).
    expect(prompt).toContain("{{upstream.up.summary}}");
  });

  // TPL-4 — resolved persona block.
  it("prepends a resolved ## Persona block (outermost) when personaContent is given", () => {
    const exec = { id: "ex", kind: "execute", data: { prompt: "implement the widget" } };
    const { prompt, personaBlockPresent } = assembleNodePrompt({
      node: exec,
      nodes: [exec, ctxNode],
      edges: [{ source: "ctx", target: "ex", kind: "attaches-to" }],
      personaContent: "# Forked Backend Engineer\nAlways write tests first.",
    });
    expect(personaBlockPresent).toBe(true);
    expect(prompt.startsWith("## Persona")).toBe(true);
    expect(prompt).toContain("Always write tests first.");
    // Persona block is OUTERMOST — appears before the attached context block.
    expect(prompt.indexOf("## Persona")).toBeLessThan(prompt.indexOf("## Attached context"));
    expect(prompt).toContain("implement the widget");
  });

  it("is byte-identical when no personaContent is provided (absent-safe)", () => {
    const exec = { id: "ex", kind: "execute", data: { prompt: "implement the widget" } };
    const withUndef = assembleNodePrompt({ node: exec, nodes: [exec], edges: [] });
    const withEmpty = assembleNodePrompt({
      node: exec,
      nodes: [exec],
      edges: [],
      personaContent: "   ",
    });
    expect(withUndef.prompt).toBe("implement the widget");
    expect(withUndef.personaBlockPresent).toBe(false);
    expect(withEmpty.prompt).toBe("implement the widget");
    expect(withEmpty.personaBlockPresent).toBe(false);
  });
});
