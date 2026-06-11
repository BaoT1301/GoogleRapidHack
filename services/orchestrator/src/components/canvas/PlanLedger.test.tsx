import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const progressFn = vi.fn();
vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    graphs: {
      planProgress: {
        queryOptions: (input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["graphs", "planProgress"], input],
          queryFn: () => progressFn(input),
          ...opts,
        }),
      },
    },
  }),
}));

import { PlanLedger, PlanLedgerView } from "@/components/canvas/PlanLedger";
import type { SprintProgress } from "@/server/graphs/plan-progress";

const sprints: SprintProgress[] = [
  {
    graphId: "g1",
    name: "Auth — Sprint 1",
    sprintNumber: 1,
    sprintName: "Foundations",
    status: "success",
    hasRun: true,
    nodes: [{ nodeId: "a", label: "schema", status: "success" }],
  },
  {
    graphId: "g2",
    name: "Auth — Sprint 2",
    sprintNumber: 2,
    sprintName: "OAuth",
    status: "running",
    hasRun: true,
    nodes: [
      { nodeId: "b", label: "google", status: "running" },
      { nodeId: "c", label: "github", status: "pending" },
    ],
  },
];

describe("PlanLedgerView (PLAN-5 presentational)", () => {
  it("renders ordered sprints with per-track status + highlights the active sprint", () => {
    render(<PlanLedgerView sprints={sprints} />);
    const region = screen.getByRole("region", { name: /plan progress ledger/i });
    expect(region).toBeInTheDocument();
    expect(screen.getByText(/Sprint 1: Foundations/)).toBeInTheDocument();
    expect(screen.getByText(/Sprint 2: OAuth/)).toBeInTheDocument();
    // per-track labels rendered
    expect(screen.getByText("google")).toBeInTheDocument();
    expect(screen.getByText("github")).toBeInTheDocument();
    // Sprint 2 is the active front (first non-done) → aria-current step.
    const current = screen.getByText(/Sprint 2: OAuth/).closest("li");
    expect(current).toHaveAttribute("aria-current", "step");
    const done = screen.getByText(/Sprint 1: Foundations/).closest("li");
    expect(done).not.toHaveAttribute("aria-current");
  });
});

describe("PlanLedger (PLAN-5 query wrapper)", () => {
  function renderLedger() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PlanLedger planId="plan_1" />
      </QueryClientProvider>,
    );
  }

  it("renders the ledger from the planProgress query", async () => {
    progressFn.mockResolvedValue({ planId: "plan_1", sprints });
    renderLedger();
    const region = await screen.findByRole("region", { name: /plan progress ledger/i });
    expect(within(region).getByText(/Sprint 2: OAuth/)).toBeInTheDocument();
  });

  it("renders nothing when the plan has no sprint graphs (absent-safe)", async () => {
    progressFn.mockResolvedValue({ planId: "plan_1", sprints: [] });
    const { container } = (() => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return render(
        <QueryClientProvider client={qc}>
          <PlanLedger planId="plan_1" />
        </QueryClientProvider>,
      );
    })();
    // give the query a tick to settle
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[aria-label='Plan progress ledger']")).toBeNull();
  });
});
