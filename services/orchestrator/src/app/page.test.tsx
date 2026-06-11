import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// SystemStatus does live polling fetches — stub it for a deterministic render.
vi.mock("@/components/SystemStatus", () => ({
  SystemStatus: () => <div data-testid="system-status" />,
}));

import HomePage from "@/app/page";

describe("HomePage (landing)", () => {
  it("renders the landing content", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: "AI Workflow Orchestrator" })).toBeInTheDocument();
    expect(screen.getByText(/Debug Run/i)).toBeInTheDocument();
    expect(screen.getByTestId("system-status")).toBeInTheDocument();
  });

  it("does not render its own auth controls (those now live in the global shell)", () => {
    render(<HomePage />);
    // No duplicate Sign In / account controls inside the landing page itself.
    expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
  });
});
