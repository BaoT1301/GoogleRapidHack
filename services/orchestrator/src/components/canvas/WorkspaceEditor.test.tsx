import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AppNode } from "@/components/canvas/serialize";
import type { INodeSpec } from "@/db/models/graph.model";

const applyPlanNodeProposalSpy = vi.fn();
const onSaveSpy = vi.fn();

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    templates: {
      list: {
        queryOptions: (_input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["templates", "list"]],
          queryFn: async () => [],
          ...opts,
        }),
      },
    },
    ai: {
      applySubgraphPatch: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: vi.fn(),
          ...opts,
        }),
      },
    },
    graphs: {
      applyPlanNodeProposal: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: applyPlanNodeProposalSpy,
          ...opts,
        }),
      },
      repoInfo: {
        queryOptions: (input: { graphId: string }, opts: Record<string, unknown> = {}) => ({
          queryKey: [["graphs", "repoInfo"], input],
          queryFn: async () => ({
            rootRepoPath: "/tmp/repo",
            baseBranch: "main",
            isGitRepo: true,
          }),
          ...opts,
        }),
      },
    },
  }),
}));

vi.mock("@/components/canvas/Canvas", () => ({
  Canvas: ({ nodes }: { nodes: AppNode[] }) => (
    <div data-testid="mock-canvas">
      {nodes.map((node) => (
        <div key={node.id}>{node.data.label}</div>
      ))}
    </div>
  ),
}));

// The smart Run button drives the shared controller; mock the hook so clicking
// "Run" doesn't kick off a real run, and capture the apply-proposal callback so
// the mocked drawer can invoke it.
vi.mock("@/components/run/useRunController", () => ({
  useRunController: (args: {
    onApplyPlanProposal?: (input: { runId: string; nodeId: string }) => unknown;
  }) => ({
    isRunning: false,
    isStarting: false,
    startRealRun: vi.fn(),
    openStopConfirm: vi.fn(),
    applyPlanProposal: (nodeId: string) =>
      args.onApplyPlanProposal?.({ runId: "run_1", nodeId }),
  }),
}));

vi.mock("@/components/run/RunDrawer", () => ({
  RunDrawer: ({
    controller,
  }: {
    controller: { applyPlanProposal: (nodeId: string) => void };
  }) => (
    <button onClick={() => controller.applyPlanProposal("plan_1")}>
      Apply mocked Plan proposal
    </button>
  ),
}));

vi.mock("@/components/canvas/PlanPanel", () => ({
  PlanPanel: () => null,
}));

vi.mock("@/components/canvas/ImproveSelectedNodesModal", () => ({
  ImproveSelectedNodesModal: () => null,
}));

vi.mock("@/components/canvas/SpawnFixerModal", () => ({
  SpawnFixerModal: () => null,
}));

vi.mock("@/components/canvas/PlanLedger", () => ({
  PlanLedger: () => null,
}));

import { WorkspaceEditor } from "@/components/canvas/WorkspaceEditor";
import { ToastProvider } from "@/components/ui/Toast";

function renderWorkspace() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <WorkspaceEditor
          graphId="graph_1"
          initialNodes={initialNodes()}
          initialEdges={[]}
          rootRepoPath="/tmp/repo"
          onSave={onSaveSpy}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("WorkspaceEditor — Plan proposal apply/undo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onSaveSpy.mockResolvedValue(undefined);
    applyPlanNodeProposalSpy.mockResolvedValue({
      nodes: [
        specNode("plan_1", "Plan"),
        specNode("exec_generated", "Generated tests"),
      ],
      edges: [],
    });
  });

  it("applies a Plan proposal to the canvas, then undo restores the previous snapshot", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.queryByText("Generated tests")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^run$/i }));
    await user.click(await screen.findByRole("button", { name: /apply mocked plan proposal/i }));

    await waitFor(() => expect(applyPlanNodeProposalSpy).toHaveBeenCalled());
    expect(applyPlanNodeProposalSpy.mock.calls[0]?.[0]).toEqual({
      graphId: "graph_1",
      runId: "run_1",
      nodeId: "plan_1",
      confirm: true,
      mode: "append",
    });
    expect(await screen.findByText("Generated tests")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /undo ai change/i }));
    await waitFor(() => expect(screen.queryByText("Generated tests")).not.toBeInTheDocument());
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(onSaveSpy).toHaveBeenCalledWith({
      nodes: [expect.objectContaining({ id: "plan_1", kind: "plan", label: "Plan" })],
      edges: [],
    });
  });
});

function initialNodes(): AppNode[] {
  return [
    {
      id: "plan_1",
      type: "graphNode",
      position: { x: 0, y: 0 },
      data: {
        kind: "plan",
        label: "Plan",
        status: "pending",
        data: { objective: "Improve workflow", prompt: "Add tests" },
      },
    },
  ];
}

function specNode(id: string, label: string): INodeSpec {
  return {
    id,
    kind: id === "plan_1" ? "plan" : "execute",
    label,
    position: { x: 0, y: 0 },
    status: "pending",
    data: id === "plan_1" ? { objective: "Improve workflow" } : { cli: "fake" },
  };
}
