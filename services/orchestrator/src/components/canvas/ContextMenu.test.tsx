import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu, EdgeContextMenu } from "@/components/canvas/ContextMenu";
import {
  selectionIds,
  contextTargets,
  duplicateNodes,
} from "@/components/canvas/selection";
import type { AppNode } from "@/components/canvas/serialize";

function node(id: string): AppNode {
  return {
    id,
    type: "graphNode",
    position: { x: 10, y: 20 },
    data: { kind: "execute", label: id, status: "success", data: { prompt: "x" } },
  };
}

describe("canvas selection helpers", () => {
  it("multi-select yields >=2 selected ids", () => {
    const ids = selectionIds([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(ids).toEqual(["a", "b", "c"]);
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it("contextTargets uses the whole multi-selection when the node is in it", () => {
    expect(contextTargets("b", ["a", "b"])).toEqual(["a", "b"]);
    // …but falls back to just the right-clicked node otherwise.
    expect(contextTargets("z", ["a", "b"])).toEqual(["z"]);
    expect(contextTargets("a", ["a"])).toEqual(["a"]);
  });

  it("duplicateNodes clones with fresh ids, offset position, reset status", () => {
    const dups = duplicateNodes([node("a"), node("b")], ["a"]);
    expect(dups).toHaveLength(1);
    expect(dups[0].id).not.toBe("a");
    expect(dups[0].position).toEqual({ x: 42, y: 52 });
    expect(dups[0].data.status).toBe("pending");
    expect(dups[0].data.label).toBe("a");
  });
});

describe("ContextMenu", () => {
  const base = { state: { x: 0, y: 0, nodeId: "n1" }, onClose: vi.fn() };

  it("renders the expected actions and fires their callbacks", () => {
    const onDuplicate = vi.fn();
    const onImproveSelected = vi.fn();
    const onSpawnFixer = vi.fn();
    const onDelete = vi.fn();
    render(
      <ContextMenu
        {...base}
        count={1}
        onDuplicate={onDuplicate}
        onImproveSelected={onImproveSelected}
        onSpawnFixer={onSpawnFixer}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByRole("menu", { name: /node actions/i })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Duplicate"));
    fireEvent.click(screen.getByText("Improve selected with AI"));
    fireEvent.click(screen.getByText("Spawn fixer…"));
    fireEvent.click(screen.getByText("Delete"));
    expect(onDuplicate).toHaveBeenCalledOnce();
    expect(onImproveSelected).toHaveBeenCalledOnce();
    expect(onSpawnFixer).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("pluralizes labels with the selected count", () => {
    render(
      <ContextMenu
        {...base}
        count={3}
        onDuplicate={vi.fn()}
        onSpawnFixer={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("Delete 3 nodes")).toBeInTheDocument();
    expect(screen.getByText("Duplicate 3 nodes")).toBeInTheDocument();
  });
});

describe("EdgeContextMenu", () => {
  const base = { state: { x: 0, y: 0, edgeId: "e1" }, onClose: vi.fn() };

  it("renders a labelled edge menu with a Delete edge action", () => {
    const onDelete = vi.fn();
    render(<EdgeContextMenu {...base} onDelete={onDelete} />);
    expect(
      screen.getByRole("menu", { name: /edge actions/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delete edge"));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("does not expose node-only actions", () => {
    render(<EdgeContextMenu {...base} onDelete={vi.fn()} />);
    expect(screen.queryByText("Duplicate")).not.toBeInTheDocument();
    expect(screen.queryByText("Spawn fixer…")).not.toBeInTheDocument();
  });
});
