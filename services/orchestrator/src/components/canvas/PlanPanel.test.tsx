import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// plan.generate behaviour is swapped per-test via this ref.
const planFn = vi.fn();
// PLAN-4: graphs.createPlanGraphs behaviour is swapped per-test via this ref.
const createPlanGraphsFn = vi.fn();
// Persisted planner provider returned by settings.get (mutable per-test).
let PROVIDER: "cloud" | "local" = "cloud";

vi.mock("@/trpc/client", () => ({
  TRPCReactProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTRPC: () => ({
    plan: {
      generate: {
        mutationOptions: (o: Record<string, unknown> = {}) => ({
          mutationFn: planFn,
          ...o,
        }),
      },
    },
    graphs: {
      createPlanGraphs: {
        mutationOptions: (o: Record<string, unknown> = {}) => ({
          mutationFn: createPlanGraphsFn,
          ...o,
        }),
      },
    },
    settings: {
      get: {
        queryOptions: (_i: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["settings", "get"]],
          queryFn: async () => ({ allowedTools: ["fs_read"], plannerProvider: PROVIDER }),
          ...opts,
        }),
      },
    },
  }),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { PlanPanel, PlanBacklog } from "@/components/canvas/PlanPanel";

const contextRequest = {
  type: "context_request",
  codebaseImpact: "Touches the auth router.",
  approaches: [{ name: "OAuth", pros: ["fast"], cons: ["scope"] }],
  questions: [{ id: "q1", text: "OAuth or email/password?" }],
};

const graphSpec = {
  type: "graph_spec",
  version: "1.0",
  featureName: "Auth",
  tracks: [
    {
      id: "t1",
      number: 1,
      execution: "SEQUENTIAL",
      persona: "backend_engineer",
      name: "Build auth",
      status: "PENDING",
      overview: "o",
      checklist: ["a"],
      dependsOn: [],
    },
  ],
};

// PLAN-3: a multi-sprint plan carries an optional `backlog.sprints` roadmap.
const graphSpecWithBacklog = {
  ...graphSpec,
  featureName: "Auth platform",
  sprintNumber: 2,
  backlog: {
    sprints: [
      { number: 1, name: "Foundations", tasks: ["schema", "session"] },
      { number: 2, name: "OAuth providers", tasks: ["google", "github"] },
      { number: 3, name: "Hardening", tasks: ["rate limit"] },
    ],
  },
};

function renderPanel(onApply = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <PlanPanel open onClose={vi.fn()} onApply={onApply} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return onApply;
}

describe("PlanPanel (Socratic two-step)", () => {
  beforeEach(() => {
    planFn.mockReset();
    createPlanGraphsFn.mockReset();
    PROVIDER = "cloud";
  });

  it("step 1 surfaces the Architect's clarifying questions", async () => {
    planFn.mockResolvedValueOnce(contextRequest);
    renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Add OAuth login/i), "add auth");
    await user.click(screen.getByRole("button", { name: /ask the architect/i }));

    expect(
      await screen.findByText(/OAuth or email\/password\?/i),
    ).toBeInTheDocument();
    // No graph applied yet on the questions step.
    expect(screen.getByText(/Touches the auth router/i)).toBeInTheDocument();
  });

  it("step 2 posts the answers as messages and applies the returned graph", async () => {
    planFn.mockResolvedValueOnce(contextRequest).mockResolvedValueOnce(graphSpec);
    const onApply = renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Add OAuth login/i), "add auth");
    await user.click(screen.getByRole("button", { name: /ask the architect/i }));
    await screen.findByText(/OAuth or email\/password\?/i);

    await user.type(screen.getByLabelText(/OAuth or email/i), "OAuth with Google");
    await user.click(screen.getByRole("button", { name: /generate plan/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    // Second call is the approved turn carrying messages.
    const secondArgs = planFn.mock.calls[1][0];
    expect(secondArgs.approved).toBe(true);
    expect(secondArgs.messages[0]).toMatchObject({ role: "user", content: "add auth" });
    expect(secondArgs.prompt).toMatch(/OAuth with Google/);
    // Mapped graph reached onApply.
    expect(onApply.mock.calls[0][0].nodes).toHaveLength(1);
  });

  it("cancel aborts the in-flight request without applying a result", async () => {
    let resolve!: (v: unknown) => void;
    planFn.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const onApply = renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Add OAuth login/i), "add auth");
    await user.click(screen.getByRole("button", { name: /ask the architect/i }));

    // Loading state shows a Cancel affordance.
    const cancel = await screen.findByRole("button", { name: /^cancel$/i });
    await user.click(cancel);

    // Back to the prompt form; a late resolve must not apply anything.
    expect(
      await screen.findByRole("button", { name: /ask the architect/i }),
    ).toBeInTheDocument();
    resolve(contextRequest);
    await new Promise((r) => setTimeout(r, 0));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("forwards the persisted planner provider to plan.generate", async () => {
    PROVIDER = "local";
    planFn.mockResolvedValueOnce(contextRequest);
    renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Add OAuth login/i), "add auth");
    await user.click(screen.getByRole("button", { name: /ask the architect/i }));
    await screen.findByText(/OAuth or email\/password\?/i);

    expect(planFn.mock.calls[0][0].provider).toBe("local");
  });

  it("renders an inline error (no fabricated plan) when the request fails", async () => {
    planFn.mockRejectedValueOnce(new Error("LLM API error: 500"));
    renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Add OAuth login/i), "x");
    await user.click(screen.getByRole("button", { name: /ask the architect/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Architect API/i);
  });

  it("on a LOCAL planner failure, surfaces the truthful local reason (NOT the Architect API text)", async () => {
    PROVIDER = "local";
    planFn.mockRejectedValueOnce(
      new Error(
        "Local planner (kiro-cli) returned no usable plan after one retry: the local planner produced no JSON object. Try Cloud, or refine the prompt.",
      ),
    );
    renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Add OAuth login/i), "x");
    await user.click(screen.getByRole("button", { name: /ask the architect/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/local planner/i);
    expect(alert).not.toHaveTextContent(/Architect API/i);
  });

  it("PLAN-3: surfaces the multi-sprint roadmap and applies only after confirm", async () => {
    planFn.mockResolvedValueOnce(contextRequest).mockResolvedValueOnce(graphSpecWithBacklog);
    const onApply = renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Add OAuth login/i), "add auth");
    await user.click(screen.getByRole("button", { name: /ask the architect/i }));
    await screen.findByText(/OAuth or email\/password\?/i);

    await user.type(screen.getByLabelText(/OAuth or email/i), "OAuth with Google");
    await user.click(screen.getByRole("button", { name: /generate plan/i }));

    // Roadmap review appears with all sprints; the graph is NOT applied yet.
    const roadmap = await screen.findByRole("region", { name: /multi-sprint roadmap/i });
    expect(roadmap).toBeInTheDocument();
    expect(screen.getByText(/Foundations/)).toBeInTheDocument();
    expect(screen.getByText(/OAuth providers/)).toBeInTheDocument();
    expect(screen.getByText(/Hardening/)).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();

    // Confirm → applies the current sprint's tracks.
    await user.click(screen.getByRole("button", { name: /apply sprint 2/i }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply.mock.calls[0][0].nodes).toHaveLength(1);
  });

  it("PLAN-4: 'Create all N sprint graphs' expands the whole roadmap via graphs.createPlanGraphs", async () => {
    planFn.mockResolvedValueOnce(contextRequest).mockResolvedValueOnce(graphSpecWithBacklog);
    createPlanGraphsFn.mockResolvedValueOnce({
      planId: "plan_123",
      graphs: [
        { graphId: "g1", sprintNumber: 1 },
        { graphId: "g2", sprintNumber: 2 },
        { graphId: "g3", sprintNumber: 3 },
      ],
    });
    const onApply = vi.fn();
    const onPlanGraphsCreated = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <PlanPanel
            open
            onClose={vi.fn()}
            onApply={onApply}
            rootRepoPath="/repo"
            baseBranch="main"
            onPlanGraphsCreated={onPlanGraphsCreated}
          />
        </ToastProvider>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Add OAuth login/i), "add auth");
    await user.click(screen.getByRole("button", { name: /ask the architect/i }));
    await screen.findByText(/OAuth or email\/password\?/i);
    await user.type(screen.getByLabelText(/OAuth or email/i), "OAuth with Google");
    await user.click(screen.getByRole("button", { name: /generate plan/i }));

    await screen.findByRole("region", { name: /multi-sprint roadmap/i });
    await user.click(screen.getByRole("button", { name: /create all 3 sprint graphs/i }));

    await waitFor(() => expect(createPlanGraphsFn).toHaveBeenCalledTimes(1));
    const args = createPlanGraphsFn.mock.calls[0][0];
    expect(args.currentSprint).toBe(2);
    expect(args.sprints).toHaveLength(3);
    expect(args.rootRepoPath).toBe("/repo");
    expect(args.currentSpec.nodes).toHaveLength(1);
    expect(onApply).not.toHaveBeenCalled();
    await waitFor(() => expect(onPlanGraphsCreated).toHaveBeenCalledTimes(1));
    expect(onPlanGraphsCreated.mock.calls[0][0].graphs).toHaveLength(3);
  });

  it("PLAN-3: a plan with NO backlog applies immediately (absent-safe, no roadmap step)", async () => {
    planFn.mockResolvedValueOnce(contextRequest).mockResolvedValueOnce(graphSpec);
    const onApply = renderPanel();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText(/Add OAuth login/i), "add auth");
    await user.click(screen.getByRole("button", { name: /ask the architect/i }));
    await screen.findByText(/OAuth or email\/password\?/i);

    await user.type(screen.getByLabelText(/OAuth or email/i), "OAuth with Google");
    await user.click(screen.getByRole("button", { name: /generate plan/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("region", { name: /multi-sprint roadmap/i })).not.toBeInTheDocument();
  });
});

describe("PlanBacklog (PLAN-3 presentational)", () => {
  it("renders nothing when there are no sprints (absent-safe)", () => {
    const { container } = render(<PlanBacklog sprints={[]} currentSprint={1} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marks the current sprint with aria-current", () => {
    render(
      <PlanBacklog
        sprints={[
          { number: 1, name: "Foundations", tasks: [] },
          { number: 2, name: "OAuth", tasks: ["google"] },
        ]}
        currentSprint={2}
      />,
    );
    const current = screen.getByText(/Sprint 2: OAuth/).closest("li");
    expect(current).toHaveAttribute("aria-current", "step");
  });
});
