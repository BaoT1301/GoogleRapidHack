import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GraphCard } from "@/components/dashboard/GraphCard";
import type { GraphListItem } from "@/trpc/types";

function makeGraph(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "g1",
    name: "My Sprint",
    status: "draft",
    nodes: [
      { id: "n1", kind: "plan", label: "Plan", status: "pending", position: { x: 0, y: 0 } },
      { id: "n2", kind: "execute", label: "Build", status: "pending", position: { x: 120, y: 40 } },
    ],
    edges: [{ id: "e1", source: "n1", target: "n2", kind: "flow" }],
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as unknown as GraphListItem;
}

function renderCard(graph: GraphListItem) {
  const onExport = vi.fn();
  const onArchive = vi.fn();
  const onDelete = vi.fn();
  render(
    <GraphCard
      graph={graph}
      onExport={onExport}
      onArchive={onArchive}
      onDelete={onDelete}
    />,
  );
  return { onExport, onArchive, onDelete };
}

describe("GraphCard", () => {
  it("renders the name, status, node count and a node thumbnail", () => {
    renderCard(makeGraph());
    expect(screen.getByText("My Sprint")).toBeInTheDocument();
    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(screen.getByText(/2 nodes/)).toBeInTheDocument();
    // Mini-map renders a marker per node (not the empty placeholder).
    expect(screen.getAllByTestId("graph-thumbnail-node")).toHaveLength(2);
    expect(screen.queryByTestId("graph-thumbnail-empty")).not.toBeInTheDocument();
  });

  it("links the preview area to the graph detail route", () => {
    renderCard(makeGraph());
    expect(screen.getByRole("link")).toHaveAttribute("href", "/dashboard/g1");
  });

  it("shows all three actions without requiring hover, and fires their callbacks", async () => {
    const user = userEvent.setup();
    const { onExport, onArchive, onDelete } = renderCard(makeGraph());

    // Always present in the DOM (not hover-gated).
    const exportBtn = screen.getByRole("button", { name: "Export graph" });
    const archiveBtn = screen.getByRole("button", { name: "Archive graph" });
    const deleteBtn = screen.getByRole("button", { name: "Delete graph" });

    await user.click(exportBtn);
    await user.click(archiveBtn);
    await user.click(deleteBtn);

    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("renders the empty-thumbnail placeholder for a graph with no nodes", () => {
    renderCard(makeGraph({ nodes: [], edges: [] }));
    expect(screen.getByTestId("graph-thumbnail-empty")).toBeInTheDocument();
    expect(screen.getByText(/0 nodes/)).toBeInTheDocument();
  });
});
