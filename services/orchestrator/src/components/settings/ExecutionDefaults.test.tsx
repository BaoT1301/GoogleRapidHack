import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

let SETTINGS: Record<string, unknown>;
const updates: Record<string, unknown>[] = [];

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
            updates.push(vars);
            SETTINGS = { ...SETTINGS, ...vars };
            return SETTINGS;
          },
          ...opts,
        }),
      },
    },
  }),
}));

import { ExecutionDefaults } from "@/components/settings/ExecutionDefaults";

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ExecutionDefaults />
    </QueryClientProvider>,
  );
}

describe("ExecutionDefaults", () => {
  beforeEach(() => {
    updates.length = 0;
    SETTINGS = {
      defaultModelByNodeType: {},
      fixerConfig: {},
      mcpStartupPolicy: "best-effort",
    };
  });

  it("defaults to the best-effort MCP policy and can switch to require", async () => {
    renderIt();
    const bestEffort = await screen.findByRole("radio", { name: /Best-effort/ });
    const require = screen.getByRole("radio", { name: /Require/ });
    await waitFor(() => expect(bestEffort).toHaveAttribute("aria-checked", "true"));
    await userEvent.click(require);
    await waitFor(() => expect(SETTINGS.mcpStartupPolicy).toBe("require"));
  });

  it("persists a per-node-type default model", async () => {
    renderIt();
    const executeInput = await screen.findByLabelText("execute");
    await userEvent.type(executeInput, "claude-sonnet-4");
    await userEvent.tab(); // blur commits
    await waitFor(() =>
      expect(
        (SETTINGS.defaultModelByNodeType as Record<string, string>).execute,
      ).toBe("claude-sonnet-4"),
    );
  });

  it("persists the fixer CLI selection", async () => {
    renderIt();
    const cli = await screen.findByLabelText("CLI");
    await userEvent.selectOptions(cli, "codex");
    await waitFor(() =>
      expect((SETTINGS.fixerConfig as { cli?: string }).cli).toBe("codex"),
    );
  });
});
