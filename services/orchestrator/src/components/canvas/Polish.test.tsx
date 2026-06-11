import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { resolveShortcut, isEditableTarget } from "@/lib/canvas-shortcuts";
import { EmptyState } from "@/components/ui/EmptyState";

const ev = (over: Partial<Parameters<typeof resolveShortcut>[0]> = {}) => ({
  key: "x",
  metaKey: false,
  ctrlKey: false,
  ...over,
});

describe("canvas keyboard shortcuts", () => {
  it("maps Delete/Backspace to a delete action when not typing", () => {
    expect(resolveShortcut(ev({ key: "Delete" }), false)).toBe("delete");
    expect(resolveShortcut(ev({ key: "Backspace" }), false)).toBe("delete");
  });

  it("maps Cmd/Ctrl+A to select-all, Cmd/Ctrl+Enter to run, Escape to escape", () => {
    expect(resolveShortcut(ev({ key: "a", metaKey: true }), false)).toBe("select-all");
    expect(resolveShortcut(ev({ key: "A", ctrlKey: true }), false)).toBe("select-all");
    expect(resolveShortcut(ev({ key: "Enter", metaKey: true }), false)).toBe("run");
    expect(resolveShortcut(ev({ key: "Escape" }), false)).toBe("escape");
  });

  it("suppresses ALL shortcuts while typing in a field", () => {
    expect(resolveShortcut(ev({ key: "Delete" }), true)).toBeNull();
    expect(resolveShortcut(ev({ key: "a", metaKey: true }), true)).toBeNull();
  });

  it("isEditableTarget detects inputs/textareas/selects", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("EmptyState", () => {
  it("renders the title, description, and action", () => {
    render(
      <EmptyState
        title="No graphs yet"
        description="Create a graph to start."
        action={<button>New graph</button>}
      />,
    );
    expect(screen.getByText("No graphs yet")).toBeInTheDocument();
    expect(screen.getByText("Create a graph to start.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new graph/i })).toBeInTheDocument();
  });
});
