import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

let SETTINGS: { allowedTools: string[]; plannerProvider: string; mergeStrategy: string };

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
  }),
}));

import { MergeStrategyToggle } from "@/components/settings/MergeStrategyToggle";

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MergeStrategyToggle />
    </QueryClientProvider>,
  );
}

describe("MergeStrategyToggle", () => {
  beforeEach(() => {
    SETTINGS = { allowedTools: ["fs_read"], plannerProvider: "cloud", mergeStrategy: "base-fanin" };
  });

  it("defaults to Fan-in to base active and offers Lineage", async () => {
    renderIt();
    const fanin = await screen.findByRole("radio", { name: /Fan-in to base/ });
    const lineage = screen.getByRole("radio", { name: /Lineage \(stacked\)/ });
    await waitFor(() => expect(fanin).toHaveAttribute("aria-checked", "true"));
    expect(lineage).toHaveAttribute("aria-checked", "false");
  });

  it("persists the lineage choice and reflects the new active model", async () => {
    renderIt();
    const lineage = await screen.findByRole("radio", { name: /Lineage \(stacked\)/ });
    await userEvent.click(lineage);
    await waitFor(() => expect(lineage).toHaveAttribute("aria-checked", "true"));
    expect(SETTINGS.mergeStrategy).toBe("lineage");
  });

  it("reflects a persisted lineage setting as active", async () => {
    SETTINGS = { allowedTools: ["fs_read"], plannerProvider: "cloud", mergeStrategy: "lineage" };
    renderIt();
    const lineage = await screen.findByRole("radio", { name: /Lineage \(stacked\)/ });
    await waitFor(() => expect(lineage).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByText(/Lineage \(stacked branches\)/)).toBeInTheDocument();
  });
});
