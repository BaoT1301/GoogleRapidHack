import { describe, expect, it } from "vitest";
import { buildNodePromptPreview } from "./preview-node-prompt";

describe("buildNodePromptPreview (PLAN-7 dry-run)", () => {
  it("assembles the prompt including an attached context node + resolves CLI/trust-tools", () => {
    const preview = buildNodePromptPreview({
      graph: {
        cli: "kiro",
        nodes: [
          { id: "ex", kind: "execute", label: "Build", data: { prompt: "implement it" } },
          { id: "ctx", kind: "context", label: "Notes", data: { text: "be accessible" } },
        ],
        edges: [{ source: "ctx", target: "ex", kind: "attaches-to" }],
      },
      nodeId: "ex",
      executeTrustTools: "fs_read",
    });
    expect(preview).not.toBeNull();
    expect(preview!.kind).toBe("execute");
    expect(preview!.cli).toBe("kiro"); // node has no data.cli → graph-level cli
    expect(preview!.trustTools).toBe("fs_read");
    expect(preview!.agent).toBeUndefined();
    expect(preview!.attachedContextPresent).toBe(true);
    expect(preview!.prompt).toContain("## Attached context");
    expect(preview!.prompt).toContain("be accessible");
    expect(preview!.prompt).toContain("implement it");
  });

  it("flags an unresolved data binding (no upstream run in a dry-run)", () => {
    const preview = buildNodePromptPreview({
      graph: {
        nodes: [{ id: "ex", kind: "execute", label: "x", data: { prompt: "use {{upstream.up.summary}}" } }],
        edges: [{ source: "up", target: "ex", kind: "data" }],
      },
      nodeId: "ex",
      executeTrustTools: "fs_read,fs_write",
    });
    expect(preview!.unresolvedBindings).toEqual(["{{upstream.up.summary}}"]);
    expect(preview!.cli).toBe("codex"); // no node/graph cli → real CLI fallback
  });

  it("persona-locks review/doc nodes to their agent + trust-tools", () => {
    const review = buildNodePromptPreview({
      graph: { nodes: [{ id: "rv", kind: "review", label: "audit" }], edges: [] },
      nodeId: "rv",
      executeTrustTools: "fs_read,fs_write",
    });
    expect(review!.agent).toBe("orch-reviewer");
    expect(review!.trustTools).toBe("fs_read"); // read-only, NOT the execute set
    expect(review!.prompt).toContain("Audit the work");

    const doc = buildNodePromptPreview({
      graph: { nodes: [{ id: "dc", kind: "doc", label: "docs" }], edges: [] },
      nodeId: "dc",
      executeTrustTools: "fs_read",
    });
    expect(doc!.agent).toBe("orch-doc");
    expect(doc!.trustTools).toContain("fs_write");
  });

  it("returns null when the node is not in the graph", () => {
    expect(
      buildNodePromptPreview({
        graph: { nodes: [], edges: [] },
        nodeId: "missing",
        executeTrustTools: "fs_read",
      }),
    ).toBeNull();
  });
});
