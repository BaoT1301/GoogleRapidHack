import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AppNode } from "@/components/canvas/serialize";

const defaultCatalog = {
  providers: [
    {
      provider: "codex",
      label: "Codex CLI / GPT",
      configured: true,
      enabled: true,
      models: [
        {
          id: "gpt-4.1",
          label: "GPT-4.1 via Codex CLI",
          enabled: true,
          configured: true,
        },
        {
          id: "gpt-disabled",
          label: "GPT Disabled",
          enabled: false,
          configured: false,
          disabledReason: "Not configured",
        },
      ],
    },
    {
      provider: "gemini",
      label: "Gemini",
      configured: false,
      enabled: false,
      disabledReason: "Not configured",
      models: [
        {
          id: "gemini-2.5-pro",
          label: "Gemini 2.5 Pro",
          enabled: false,
          configured: false,
          disabledReason: "Not configured",
        },
      ],
    },
    {
      provider: "openai",
      label: "OpenAI / GPT",
      configured: false,
      enabled: false,
      disabledReason: "Use Codex CLI / GPT for local graph patch proposals.",
      models: [],
    },
    {
      provider: "claude",
      label: "Claude",
      configured: false,
      enabled: false,
      disabledReason: "Not configured",
      models: [],
    },
  ],
};

const modelCatalog = vi.fn(async () => defaultCatalog);

const proposeSpy = vi.fn(async (input: unknown) => ({
  proposalId: "proposal_1",
  graphId: "g1",
  provider: (input as { provider: string }).provider === "auto" ? "codex" : (input as { provider: string }).provider,
  model: (input as { model: string }).model === "auto" ? "gpt-4.1" : (input as { model: string }).model,
  modelSelection: {
    automatic: (input as { provider: string }).provider === "auto",
    taskType: "graph_patch",
    provider: (input as { provider: string }).provider === "auto" ? "codex" : (input as { provider: string }).provider,
    model: (input as { model: string }).model === "auto" ? "gpt-4.1" : (input as { model: string }).model,
    reason: "Auto selected local Codex CLI with a strong GPT model for graph patching.",
  },
  patch: {
    graphId: "g1",
    selectedNodeIds: ["a"],
    summary: "Mock proposal",
    rationale: "Mock rationale",
    warnings: ["Mock warning"],
    operations: [{ type: "updateNode", nodeId: "a", patch: { label: "Improved A" } }],
  },
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    ai: {
      modelCatalog: {
        queryOptions: () => ({
          queryKey: [["ai", "modelCatalog"]],
          queryFn: modelCatalog,
        }),
      },
      proposeSubgraphPatch: {
        mutationOptions: (options: Record<string, unknown> = {}) => ({
          mutationFn: proposeSpy,
          ...options,
        }),
      },
    },
  }),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { ImproveSelectedNodesModal } from "@/components/canvas/ImproveSelectedNodesModal";

function node(id: string): AppNode {
  return {
    id,
    type: "graphNode",
    position: { x: 0, y: 0 },
    data: { kind: "execute", label: "Node A", status: "pending", data: {} },
  };
}

function renderModal(onApplyProposal = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ImproveSelectedNodesModal
          open
          graphId="g1"
          selectedNodes={[node("a")]}
          onClose={vi.fn()}
          onApplyProposal={onApplyProposal}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onApplyProposal };
}

describe("ImproveSelectedNodesModal", () => {
  beforeEach(() => {
    modelCatalog.mockClear();
    modelCatalog.mockImplementation(async () => defaultCatalog);
    proposeSpy.mockClear();
  });

  it("opens with selected nodes and loads provider/model catalog", async () => {
    const user = userEvent.setup();
    renderModal();

    expect(screen.getByText("1 selected node")).toBeInTheDocument();
    expect(screen.getByText(/Node A · execute/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Auto-select best model" })).toBeInTheDocument();
    await screen.findByRole("option", { name: "Codex CLI / GPT" });
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[1], "codex");
    await screen.findByRole("option", { name: "Auto-select best model" });
    expect(screen.getByRole("option", { name: /GPT Disabled/i })).toBeDisabled();
    expect(screen.getByRole("option", { name: /Gemini/i })).toBeDisabled();
    expect(screen.getByRole("option", { name: /Claude/i })).toBeDisabled();
  });

  it("submits auto provider/model and shows the resolved model reason", async () => {
    const user = userEvent.setup();
    renderModal();

    await screen.findByRole("option", { name: "Auto-select best model" });
    await user.click(screen.getByText("Fix this workflow"));
    await user.click(screen.getByRole("button", { name: /generate proposal/i }));

    await waitFor(() => expect(proposeSpy).toHaveBeenCalledTimes(1));
    expect(proposeSpy.mock.calls[0][0]).toMatchObject({
      provider: "auto",
      model: "auto",
      mode: "improve",
    });
    expect(await screen.findByText(/Auto selected local Codex CLI/i)).toBeInTheDocument();
    expect(screen.getByText(/codex · gpt-4.1/i)).toBeInTheDocument();
  });

  it("updates model choices by provider and submits provider with exact model id", async () => {
    const user = userEvent.setup();
    renderModal();

    await screen.findByRole("option", { name: "Codex CLI / GPT" });
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[1], "codex");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "GPT-4.1 via Codex CLI" })).toBeInTheDocument(),
    );
    await user.selectOptions(selects[2], "gpt-4.1");
    await user.click(screen.getByText("Add tests"));
    await user.click(screen.getByRole("button", { name: /generate proposal/i }));

    await waitFor(() => expect(proposeSpy).toHaveBeenCalledTimes(1));
    expect(proposeSpy.mock.calls[0][0]).toMatchObject({
      graphId: "g1",
      selectedNodeIds: ["a"],
      prompt: "Add tests",
      provider: "codex",
      model: "gpt-4.1",
      mode: "improve",
    });
    expect(await screen.findByText("Mock proposal")).toBeInTheDocument();
  });

  it("does not submit while the selected model is disabled", async () => {
    modelCatalog.mockResolvedValueOnce({
      providers: [
        {
          provider: "codex",
          label: "Codex CLI / GPT",
          configured: false,
          enabled: true,
          models: [
            {
              id: "gpt-disabled",
              label: "GPT Disabled",
              enabled: false,
              configured: false,
              disabledReason: "Not configured",
            },
          ],
        },
      ],
    });
    const user = userEvent.setup();
    renderModal();

    await screen.findByRole("option", { name: "Codex CLI / GPT" });
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[1], "codex");
    await screen.findByRole("option", { name: /GPT Disabled/i });
    await user.click(screen.getByText("Fix this workflow"));
    expect(screen.getByRole("option", { name: /GPT Disabled/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /generate proposal/i })).toBeDisabled();
  });

  it("blocks auto generation when no graph-patch model is configured", async () => {
    const disabledCatalog = {
      providers: [
        {
          provider: "gemini",
          label: "Gemini",
          configured: false,
          enabled: false,
          disabledReason: "Gemini graph-patch proposals require GEMINI_API_KEY on the server.",
          models: [
            {
              id: "gemini-2.0-flash",
              label: "Gemini 2.0 Flash",
              enabled: false,
              configured: false,
              disabledReason: "Gemini graph-patch proposals require GEMINI_API_KEY on the server.",
            },
          ],
        },
      ],
    } as unknown as typeof defaultCatalog;
    modelCatalog.mockResolvedValueOnce(disabledCatalog);
    const user = userEvent.setup();
    renderModal();

    await screen.findByText(/No graph-patch model is configured/i);
    await user.click(screen.getByText("Make this more robust"));

    expect(screen.getByRole("button", { name: /generate proposal/i })).toBeDisabled();
    expect(proposeSpy).not.toHaveBeenCalled();
  });

  it("applies previewed proposal through the parent callback", async () => {
    const user = userEvent.setup();
    const onApplyProposal = vi.fn();
    renderModal(onApplyProposal);

    await screen.findByRole("option", { name: "Codex CLI / GPT" });
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[1], "codex");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "GPT-4.1 via Codex CLI" })).toBeInTheDocument(),
    );
    await user.selectOptions(selects[2], "gpt-4.1");
    await user.click(screen.getByText("Improve error handling"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /generate proposal/i })).not.toBeDisabled(),
    );
    await user.click(screen.getByRole("button", { name: /generate proposal/i }));
    await screen.findByText("Mock proposal");
    await user.click(screen.getByRole("button", { name: /apply to canvas/i }));

    await waitFor(() => expect(onApplyProposal).toHaveBeenCalledTimes(1));
    expect(onApplyProposal.mock.calls[0][0]).toMatchObject({
      proposalId: "proposal_1",
      provider: "codex",
      model: "gpt-4.1",
    });
  });
});
