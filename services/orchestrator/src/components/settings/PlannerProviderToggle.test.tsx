import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

let SETTINGS: { allowedTools: string[]; plannerProvider: string };
let STATUS: Record<string, unknown>;

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    settings: {
      get: {
        queryOptions: (_i: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["settings", "get"]],
          queryFn: async () => SETTINGS,
          ...opts,
        }),
      },
      update: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: Record<string, unknown>) => {
            SETTINGS = { ...SETTINGS, ...vars };
            return SETTINGS;
          },
          ...opts,
        }),
      },
    },
    plan: {
      providerStatus: {
        queryOptions: (_i: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["plan", "providerStatus"]],
          queryFn: async () => STATUS,
          ...opts,
        }),
      },
    },
  }),
}));

import { PlannerProviderToggle } from "@/components/settings/PlannerProviderToggle";

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PlannerProviderToggle />
    </QueryClientProvider>,
  );
}

describe("PlannerProviderToggle", () => {
  beforeEach(() => {
    SETTINGS = { allowedTools: ["fs_read"], plannerProvider: "cloud" };
    STATUS = {
      cloud: { status: "ok", reachable: true },
      local: { status: "ready", available: true },
    };
  });

  it("defaults to Cloud active and shows both providers' readiness", async () => {
    renderIt();
    const cloud = await screen.findByRole("radio", { name: /Cloud \(Gemini\)/ });
    const local = screen.getByRole("radio", { name: /Local \(kiro-cli\)/ });
    await waitFor(() => expect(cloud).toHaveAttribute("aria-checked", "true"));
    expect(local).toHaveAttribute("aria-checked", "false");
    expect(await screen.findByText("Reachable")).toBeInTheDocument();
    expect(screen.getByText("kiro signed in")).toBeInTheDocument();
  });

  it("persists the choice and reflects the new active provider", async () => {
    renderIt();
    const local = await screen.findByRole("radio", { name: /Local \(kiro-cli\)/ });
    await userEvent.click(local);
    await waitFor(() => expect(local).toHaveAttribute("aria-checked", "true"));
    expect(SETTINGS.plannerProvider).toBe("local");
  });

  it("marks Local as experimental and notes Cloud is the reliable default", async () => {
    renderIt();
    // The Local card carries an "experimental" badge…
    expect(await screen.findByText(/experimental/i)).toBeInTheDocument();
    // …and a one-line reliability nudge toward the Cloud default.
    expect(screen.getByText(/Cloud is the reliable default/i)).toBeInTheDocument();
  });

  it("shows a one-line fix hint when Local is not ready", async () => {
    STATUS = {
      cloud: { status: "ok", reachable: true },
      local: { status: "not_installed", available: false, suggestedFix: "Install kiro-cli" },
    };
    renderIt();
    expect(await screen.findByText(/To use Local: Install kiro-cli/)).toBeInTheDocument();
    expect(screen.getByText("kiro not installed")).toBeInTheDocument();
  });
});
