import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mutable test state shared with the hoisted mocks below.
const state = vi.hoisted(() => ({ signedIn: true, pathname: "/dashboard" }));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));

// SignedIn passes children through only when our fake auth state is signed in.
vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) =>
    state.signedIn ? <>{children}</> : null,
}));

import { MainNav } from "@/components/shell/MainNav";

describe("MainNav", () => {
  afterEach(() => {
    state.signedIn = true;
    state.pathname = "/dashboard";
  });

  it("renders the feature links when signed in", () => {
    render(<MainNav />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("link", { name: "Debug Run" })).toHaveAttribute(
      "href",
      "/dashboard/debug-run",
    );
  });

  it("marks only the link matching the current path as active", () => {
    state.pathname = "/dashboard/debug-run";
    render(<MainNav />);

    expect(screen.getByRole("link", { name: "Debug Run" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("renders no feature links when signed out", () => {
    state.signedIn = false;
    render(<MainNav />);

    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Debug Run" })).toBeNull();
  });
});
