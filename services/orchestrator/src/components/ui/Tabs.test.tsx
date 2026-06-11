import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Tabs, type TabItem } from "@/components/ui/Tabs";

const TABS: TabItem[] = [
  { id: "general", label: "General", content: <p>general panel</p> },
  { id: "tools", label: "Tools", content: <p>tools panel</p> },
  { id: "skills", label: "Skills", content: <p>skills panel</p> },
];

describe("Tabs", () => {
  it("renders a tablist and shows only the first panel by default", () => {
    render(<Tabs tabs={TABS} ariaLabel="Settings sections" />);
    expect(screen.getByRole("tablist", { name: "Settings sections" })).toBeInTheDocument();
    expect(screen.getByText("general panel")).toBeInTheDocument();
    expect(screen.queryByText("tools panel")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches panels on click", async () => {
    render(<Tabs tabs={TABS} ariaLabel="Settings sections" />);
    await userEvent.click(screen.getByRole("tab", { name: "Tools" }));
    expect(screen.getByText("tools panel")).toBeInTheDocument();
    expect(screen.queryByText("general panel")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tools" })).toHaveAttribute("aria-selected", "true");
  });

  it("moves selection with arrow keys (roving tabindex, wraps at the ends)", async () => {
    render(<Tabs tabs={TABS} ariaLabel="Settings sections" />);
    const first = screen.getByRole("tab", { name: "General" });
    first.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Tools" })).toHaveAttribute("aria-selected", "true");
    // Wrap from the last back to the first.
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
  });

  it("respects a controlled value + onValueChange", async () => {
    const onChange = vi.fn();
    render(
      <Tabs tabs={TABS} ariaLabel="Settings sections" value="skills" onValueChange={onChange} />,
    );
    expect(screen.getByText("skills panel")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "General" }));
    expect(onChange).toHaveBeenCalledWith("general");
    // Still controlled: panel stays on "skills" until the parent updates `value`.
    expect(screen.getByText("skills panel")).toBeInTheDocument();
  });
});
