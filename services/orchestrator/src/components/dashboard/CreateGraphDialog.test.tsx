import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const createMutationFn = vi.fn();
const pushFn = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushFn }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    templates: {
      list: {
        queryOptions: (input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["templates", "list"], input],
          queryFn: async () => [],
          ...opts,
        }),
      },
    },
    graphs: {
      list: { queryKey: () => [["graphs", "list"]] },
      create: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: (input: unknown) => createMutationFn(input),
          ...opts,
        }),
      },
    },
    repo: {
      defaultRoot: {
        queryOptions: (_i: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["repo", "defaultRoot"]],
          queryFn: async () => ({ path: "/Users/me/code/acme", isGitRepo: true }),
          ...opts,
        }),
      },
      listDir: {
        queryOptions: (input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["repo", "listDir"], input],
          queryFn: async () => ({ path: "/x", parent: null, entries: [], isGitRepo: false, truncated: false }),
          ...opts,
        }),
      },
      listBranches: {
        queryOptions: (input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["repo", "listBranches"], input],
          queryFn: async () => ({ isGitRepo: true, currentBranch: "main", branches: ["main", "dev"] }),
          ...opts,
        }),
      },
    },
  }),
}));

import { CreateGraphDialog } from "@/components/dashboard/CreateGraphDialog";

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CreateGraphDialog open onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("CreateGraphDialog (repo + branch pickers)", () => {
  it("prefills the detected default repo path", async () => {
    renderDialog();
    expect(await screen.findByDisplayValue("/Users/me/code/acme")).toBeInTheDocument();
  });

  it("submits the name, prefilled repo path and base branch", async () => {
    createMutationFn.mockResolvedValue({ _id: "g1" });
    renderDialog();

    // Wait for the default path to autofill.
    await screen.findByDisplayValue("/Users/me/code/acme");

    fireEvent.change(screen.getByPlaceholderText("Auth refactor sprint"), {
      target: { value: "My graph" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create graph/i }));

    await waitFor(() => expect(createMutationFn).toHaveBeenCalledTimes(1));
    expect(createMutationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My graph",
        rootRepoPath: "/Users/me/code/acme",
        baseBranch: "main",
      }),
    );
  });
});
