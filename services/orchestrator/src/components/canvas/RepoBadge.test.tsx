import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const repoInfoFn = vi.fn();
vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    graphs: {
      repoInfo: {
        queryOptions: (input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["graphs", "repoInfo"], input],
          queryFn: () => repoInfoFn(input),
          ...opts,
        }),
      },
    },
  }),
}));

import { RepoBadge, RepoBadgeView } from "@/components/canvas/RepoBadge";

describe("RepoBadgeView (VIS-2 presentational)", () => {
  it("renders the repo name + branch", () => {
    render(
      <RepoBadgeView
        info={{
          rootRepoPath: "/Users/me/code/acme-app",
          baseBranch: "main",
          currentBranch: "feature/x",
          remoteUrl: "https://github.com/acme/acme-app.git",
          isGitRepo: true,
        }}
      />,
    );
    expect(screen.getByText("acme-app")).toBeInTheDocument();
    expect(screen.getByText("feature/x")).toBeInTheDocument();
  });

  it("shows 'not a git repo' when the path is not a git work tree", () => {
    render(
      <RepoBadgeView
        info={{ rootRepoPath: "/tmp/plain", baseBranch: "main", isGitRepo: false }}
      />,
    );
    expect(screen.getByText("plain")).toBeInTheDocument();
    expect(screen.getByText(/not a git repo/i)).toBeInTheDocument();
  });
});

describe("RepoBadge (VIS-2 query wrapper)", () => {
  function renderBadge() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <RepoBadge graphId="g1" />
      </QueryClientProvider>,
    );
  }

  it("renders the badge from the repoInfo query", async () => {
    repoInfoFn.mockResolvedValue({
      rootRepoPath: "/Users/me/code/acme-app",
      baseBranch: "main",
      currentBranch: "trunk",
      remoteUrl: "https://github.com/acme/acme-app.git",
      isGitRepo: true,
    });
    renderBadge();
    expect(await screen.findByText("acme-app")).toBeInTheDocument();
    expect(screen.getByText("trunk")).toBeInTheDocument();
  });

  it("renders nothing when the graph has no rootRepoPath (absent-safe)", async () => {
    repoInfoFn.mockResolvedValue({ rootRepoPath: undefined, baseBranch: "main", isGitRepo: false });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <RepoBadge graphId="g1" />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });
});
