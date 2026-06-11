import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tooltip } from "@/components/ui/Tooltip";

describe("Tooltip", () => {
  it("keeps the label hidden from assistive tech until shown", () => {
    render(
      <Tooltip label="Export graph">
        <button aria-label="Export graph">x</button>
      </Tooltip>,
    );
    const tip = screen.getByRole("tooltip", { hidden: true });
    expect(tip).toHaveTextContent("Export graph");
    expect(tip).toHaveAttribute("aria-hidden", "true");
    // Not yet associated with the trigger.
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-describedby");
  });

  it("reveals and associates the label on hover", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip label="Archive graph">
        <button aria-label="Archive graph">x</button>
      </Tooltip>,
    );
    await user.hover(screen.getByRole("button"));

    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveAttribute("aria-hidden", "false");
    expect(tip).toHaveClass("opacity-100");
    // Trigger wrapper now describes itself via the tooltip id.
    const describedBy = document
      .querySelector("[aria-describedby]")
      ?.getAttribute("aria-describedby");
    expect(describedBy).toBe(tip.getAttribute("id"));
  });

  it("reveals the label on keyboard focus (no mouse required)", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip label="Delete graph">
        <button aria-label="Delete graph">x</button>
      </Tooltip>,
    );
    await user.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    expect(screen.getByRole("tooltip")).toHaveAttribute("aria-hidden", "false");
  });
});
