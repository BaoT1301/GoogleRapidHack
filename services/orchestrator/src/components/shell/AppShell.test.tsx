import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mock Clerk so the shell renders without a ClerkProvider runtime.
vi.mock("@clerk/clerk-react", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignedIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignedOut: () => null,
  UserButton: () => <button data-testid="user-button">account</button>,
  SignInButton: ({ children }: { children?: React.ReactNode }) => (
    <>{children ?? "sign in"}</>
  ),
  // TRPCReactProvider reads getToken to attach a fresh auth header.
  useAuth: () => ({ getToken: async () => null }),
}));

// usePathname drives MainNav's active highlight; no app-router runtime in tests.
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

import { TRPCReactProvider } from "@/trpc/client";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { AppShell } from "@/components/shell/AppShell";

describe("AppShell", () => {
  it("renders children inside the tRPC + Clerk providers with the app shell", () => {
    render(
      <ThemeProvider>
        <TRPCReactProvider>
          <AppShell>
            <div data-testid="content">canvas slot</div>
          </AppShell>
        </TRPCReactProvider>
      </ThemeProvider>,
    );

    expect(screen.getByTestId("content")).toHaveTextContent("canvas slot");
    expect(screen.getByText("Orchestrator")).toBeInTheDocument();
    expect(screen.getByTestId("user-button")).toBeInTheDocument();

    // Primary nav + Settings control are present in the shell.
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("link", { name: "Debug Run" })).toHaveAttribute(
      "href",
      "/dashboard/debug-run",
    );
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });
});
