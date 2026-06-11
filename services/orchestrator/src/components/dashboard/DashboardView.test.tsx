import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const createSpy = vi.fn(async (_input?: { name: string }) => ({ _id: "g_new" }));
const pushSpy = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushSpy }),
}));

const MOCK_GRAPHS = [
  {
    _id: "g1",
    name: "My Sprint",
    status: "draft",
    nodes: [{ id: "n1" }],
    edges: [],
    updatedAt: new Date().toISOString(),
  },
];

vi.mock("@/trpc/client", () => {
  const mut = (opts: Record<string, unknown> = {}) => ({
    mutationFn: vi.fn(async () => ({ success: true })),
    ...opts,
  });
  return {
    TRPCReactProvider: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    useTRPC: () => ({
      graphs: {
        list: {
          queryOptions: () => ({
            queryKey: [["graphs", "list"]],
            queryFn: async () => MOCK_GRAPHS,
          }),
          queryKey: () => [["graphs", "list"]],
        },
        create: { mutationOptions: (o = {}) => ({ mutationFn: createSpy, ...o }) },
        update: { mutationOptions: mut },
        archive: { mutationOptions: mut },
        delete: { mutationOptions: mut },
      },
      templates: {
        list: {
          queryOptions: () => ({
            queryKey: [["templates", "list"]],
            queryFn: async () => [
              { id: "frontend_architect", name: "frontend architect" },
            ],
          }),
        },
      },
      repo: {
        defaultRoot: {
          queryOptions: (_i: unknown = undefined, o: Record<string, unknown> = {}) => ({
            queryKey: [["repo", "defaultRoot"]],
            queryFn: async () => ({ path: "/repo", isGitRepo: true }),
            ...o,
          }),
        },
        listDir: {
          queryOptions: (i: unknown, o: Record<string, unknown> = {}) => ({
            queryKey: [["repo", "listDir"], i],
            queryFn: async () => ({ path: "/repo", parent: null, entries: [], isGitRepo: true, truncated: false }),
            ...o,
          }),
        },
        listBranches: {
          queryOptions: (i: unknown, o: Record<string, unknown> = {}) => ({
            queryKey: [["repo", "listBranches"], i],
            queryFn: async () => ({ isGitRepo: true, currentBranch: "main", branches: ["main"] }),
            ...o,
          }),
        },
      },
      secrets: {
        create: { mutationOptions: mut },
      },
    }),
  };
});

import { ToastProvider } from "@/components/ui/Toast";
import { DashboardView } from "@/components/dashboard/DashboardView";

function renderDashboard() {
  // Suppress the first-run wizard so it doesn't overlay these dashboard assertions.
  window.localStorage.setItem("orchestrator.setup.completed", "1");
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <DashboardView />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("DashboardView", () => {
  it("renders the user's graphs from graphs.list", async () => {
    renderDashboard();
    expect(await screen.findByText("My Sprint")).toBeInTheDocument();
    expect(screen.getByText(/1 node/)).toBeInTheDocument();
  });

  it("create flow fires graphs.create with the entered name", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText("My Sprint");

    await user.click(screen.getByRole("button", { name: /new graph/i }));
    await user.type(
      screen.getByPlaceholderText("Auth refactor sprint"),
      "Test Graph",
    );
    await user.click(screen.getByRole("button", { name: /^create graph$/i }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    // TanStack Query v5 passes a context object as a 2nd arg — assert on the payload only.
    expect(createSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ name: "Test Graph" }),
    );
  });
});
