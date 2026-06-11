import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "@/components/ui/Dialog";

describe("Dialog", () => {
  it("does not render content when closed", () => {
    render(
      <Dialog open={false} onClose={() => {}} title="Hidden">
        <p>body</p>
      </Dialog>,
    );
    expect(screen.queryByText("body")).not.toBeInTheDocument();
  });

  it("defaults to max-w-md (backward-compatible) when no width is given", () => {
    render(
      <Dialog open onClose={() => {}} title="Default width">
        <p>body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Default width" });
    expect(dialog.querySelector(".max-w-md")).not.toBeNull();
  });

  it("applies a custom widthClassName for wide surfaces", () => {
    render(
      <Dialog open onClose={() => {}} title="Wide" widthClassName="max-w-3xl">
        <p>body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Wide" });
    expect(dialog.querySelector(".max-w-3xl")).not.toBeNull();
    expect(dialog.querySelector(".max-w-md")).toBeNull();
  });

  it("closes on the close button and on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Closable">
        <p>body</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole("button", { name: /close dialog/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
