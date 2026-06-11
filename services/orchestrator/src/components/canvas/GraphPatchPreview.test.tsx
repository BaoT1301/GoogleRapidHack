import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GraphPatchPreview } from "@/components/canvas/GraphPatchPreview";

describe("GraphPatchPreview", () => {
  it("renders proposal summary, model, warnings, and grouped operations", () => {
    render(
      <GraphPatchPreview
        provider="gemini"
        model="gemini-2.5-pro"
        modelReason="Auto selected the strongest configured reasoning model for graph patching."
        patch={{
          graphId: "g1",
          selectedNodeIds: ["a"],
          summary: "Improve selected workflow",
          rationale: "The selected node needs a clearer prompt.",
          warnings: ["Review before applying."],
          operations: [
            { type: "updateNode", nodeId: "a", patch: { label: "Better A" } },
            {
              type: "addNode",
              node: { id: "b", kind: "execute", label: "B", data: {}, status: "pending" },
            },
            { type: "addEdge", edge: { id: "a-b", source: "a", target: "b", kind: "flow" } },
          ],
        }}
      />,
    );

    expect(screen.getByText("Improve selected workflow")).toBeInTheDocument();
    expect(screen.getByText(/gemini · gemini-2.5-pro/i)).toBeInTheDocument();
    expect(screen.getByText(/strongest configured reasoning model/i)).toBeInTheDocument();
    expect(screen.getByText("Review before applying.")).toBeInTheDocument();
    expect(screen.getByText("Updated nodes")).toBeInTheDocument();
    expect(screen.getByText("Added nodes")).toBeInTheDocument();
    expect(screen.getByText("Added edges")).toBeInTheDocument();
  });
});
