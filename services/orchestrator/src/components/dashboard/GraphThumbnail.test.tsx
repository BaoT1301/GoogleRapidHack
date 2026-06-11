import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GraphThumbnail } from "@/components/dashboard/GraphThumbnail";
import { KIND_META } from "@/lib/graph-constants";

describe("GraphThumbnail", () => {
  it("renders the empty placeholder when there are no nodes", () => {
    render(<GraphThumbnail nodes={[]} />);
    expect(screen.getByTestId("graph-thumbnail-empty")).toBeInTheDocument();
    expect(screen.getByText(/no nodes yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("graph-thumbnail-node")).not.toBeInTheDocument();
  });

  it("renders one marker per node coloured by node kind", () => {
    render(
      <GraphThumbnail
        nodes={[
          { id: "a", kind: "plan", position: { x: 0, y: 0 } },
          { id: "b", kind: "execute", position: { x: 200, y: 80 } },
          { id: "c", kind: "review", position: { x: 400, y: 0 } },
        ]}
        edges={[
          { source: "a", target: "b" },
          { source: "b", target: "c" },
        ]}
      />,
    );
    const markers = screen.getAllByTestId("graph-thumbnail-node");
    expect(markers).toHaveLength(3);
    // Colours come straight from the shared KIND_META palette.
    const fills = markers.map((m) => m.getAttribute("fill"));
    expect(fills).toContain(KIND_META.plan.color);
    expect(fills).toContain(KIND_META.execute.color);
    expect(fills).toContain(KIND_META.review.color);
  });

  it("draws a line per edge whose endpoints both resolve to nodes", () => {
    const { container } = render(
      <GraphThumbnail
        nodes={[
          { id: "a", kind: "plan", position: { x: 0, y: 0 } },
          { id: "b", kind: "execute", position: { x: 100, y: 100 } },
        ]}
        edges={[
          { source: "a", target: "b" },
          { source: "a", target: "missing" }, // dangling — must be skipped
        ]}
      />,
    );
    expect(container.querySelectorAll("line")).toHaveLength(1);
  });

  it("tolerates nodes without a position (defaults to origin)", () => {
    render(
      <GraphThumbnail
        nodes={[
          { id: "a", kind: "doc" },
          { id: "b", kind: "gate", position: { x: 50, y: 50 } },
        ]}
      />,
    );
    expect(screen.getAllByTestId("graph-thumbnail-node")).toHaveLength(2);
  });
});
