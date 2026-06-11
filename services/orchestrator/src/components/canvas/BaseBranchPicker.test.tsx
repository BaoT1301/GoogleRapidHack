import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const listBranchesFn = vi.fn();
vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    repo: {
      listBranches: {
        queryOptions: (input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["repo", "listBranches"], input],
          queryFn: () => listBranchesFn(input),
          ...opts,
        }),
      },
    },
  }),
}));

import { BaseBranchPicker } from "@/components/canvas/BaseBranchPicker";

function Harness({ initial = "", repoPath = "/repo" }: { initial?: string; repoPath?: string }) {
  const [value, setValue] = useState(initial);
  return <BaseBranchPicker value={value} onChange={setValue} repoPath={repoPath} id="bb" />;
}

function renderPicker(props?: { initial?: string; repoPath?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

describe("BaseBranchPicker", () => {
  it("lists existing branches and selects one", async () => {
    listBranchesFn.mockResolvedValue({
      isGitRepo: true,
      currentBranch: "main",
      branches: ["main", "feature/a", "release"],
    });
    renderPicker({ initial: "main" });

    fireEvent.focus(await screen.findByRole("combobox"));
    const option = await screen.findByText("feature/a");
    fireEvent.click(option);

    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("feature/a");
  });

  it("offers a create-new affordance for a novel name", async () => {
    listBranchesFn.mockResolvedValue({
      isGitRepo: true,
      currentBranch: "main",
      branches: ["main"],
    });
    renderPicker({ initial: "" });

    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "brand-new-branch" } });

    expect(await screen.findByText(/Create new branch:/i)).toBeInTheDocument();
    expect(screen.getByText(/created from current HEAD/i)).toBeInTheDocument();
  });

  it("falls back to a plain text input when the path is not a git repo", async () => {
    listBranchesFn.mockResolvedValue({ isGitRepo: false, branches: [] });
    renderPicker({ initial: "whatever", repoPath: "/not-a-repo" });

    // No combobox role — plain input only.
    await waitFor(() => {
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });
    expect((screen.getByDisplayValue("whatever") as HTMLInputElement)).toBeInTheDocument();
  });
});
