import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const spawnSpy = vi.fn(async (_input?: unknown) => ({ _id: "child_1", childRunId: "crun_1" }));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    graphs: {
      spawnChild: {
        mutationOptions: (o: Record<string, unknown> = {}) => ({
          mutationFn: spawnSpy,
          ...o,
        }),
      },
    },
    templates: {
      list: {
        queryOptions: () => ({
          queryKey: [["templates", "list"]],
          queryFn: async () => [{ id: "frontend_architect", name: "frontend architect" }],
        }),
      },
    },
    runs: {
      listForGraph: {
        queryOptions: () => ({ queryKey: [["runs", "list"]], queryFn: async () => [] }),
      },
      fixerContext: {
        queryOptions: () => ({ queryKey: [["runs", "fixerCtx"]], queryFn: async () => [] }),
      },
    },
    settings: {
      get: {
        queryOptions: (_i: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["settings", "get"]],
          queryFn: async () => ({ fixerConfig: {} }),
          ...opts,
        }),
      },
    },
  }),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { SpawnFixerModal } from "@/components/canvas/SpawnFixerModal";

function renderModal(onSpawnedRun = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <SpawnFixerModal
          open
          graphId="g1"
          parentNodeId="node_xyz"
          selectedCount={1}
          onSpawnedRun={onSpawnedRun}
          onClose={vi.fn()}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onSpawnedRun };
}

describe("SpawnFixerModal — spawn & run (WOW-4)", () => {
  it("Spawn & run submits autoStart spawnChild and opens the child-run panel via onSpawnedRun", async () => {
    const user = userEvent.setup();
    const { onSpawnedRun } = renderModal();

    await user.type(
      screen.getByPlaceholderText(/what the fixer agent should do/i),
      "fix the failing test",
    );
    await user.selectOptions(screen.getByRole("combobox"), "frontend_architect");
    await user.click(screen.getByRole("button", { name: /spawn & run/i }));

    await waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));
    const payload = spawnSpy.mock.calls[0][0] as {
      parentGraphId: string;
      parentNodeId: string;
      autoStart: boolean;
      nodes: { data: Record<string, unknown> }[];
    };
    expect(payload.parentGraphId).toBe("g1");
    expect(payload.parentNodeId).toBe("node_xyz");
    expect(payload.autoStart).toBe(true);
    expect(payload.nodes[0].data).toMatchObject({
      persona: "frontend_architect",
      prompt: "fix the failing test",
    });

    // The side-panel is opened with the returned childRunId.
    await waitFor(() => expect(onSpawnedRun).toHaveBeenCalledWith("crun_1", "fix the failing test"));

    // Success state keeps the "Open child graph" link.
    const link = await screen.findByRole("link", { name: /open child graph/i });
    expect(link).toHaveAttribute("href", "/dashboard/child_1");
  });

  it("disables the submit while the spawn mutation is pending (loading state)", async () => {
    let resolve!: (v: unknown) => void;
    spawnSpy.mockImplementationOnce(
      () => new Promise((r) => (resolve = r as (v: unknown) => void)),
    );
    const user = userEvent.setup();
    renderModal();

    await user.type(
      screen.getByPlaceholderText(/what the fixer agent should do/i),
      "fix it",
    );
    const submit = screen.getByRole("button", { name: /spawn & run/i });
    await user.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    expect(submit).toHaveAttribute("aria-busy", "true");
    resolve({ _id: "child_2", childRunId: "crun_2" });
  });
});
