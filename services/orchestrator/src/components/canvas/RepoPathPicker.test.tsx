import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const defaultRootFn = vi.fn();
const listDirFn = vi.fn();
vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    repo: {
      defaultRoot: {
        queryOptions: (_input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["repo", "defaultRoot"]],
          queryFn: () => defaultRootFn(),
          ...opts,
        }),
      },
      listDir: {
        queryOptions: (input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["repo", "listDir"], input],
          queryFn: () => listDirFn(input),
          ...opts,
        }),
      },
    },
  }),
}));

import { RepoPathPicker } from "@/components/canvas/RepoPathPicker";

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <RepoPathPicker value={value} onChange={setValue} id="rp" />
      <output data-testid="val">{value}</output>
    </>
  );
}

function renderPicker(props?: { initial?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

describe("RepoPathPicker", () => {
  it("autofills the detected default root when value starts empty", async () => {
    defaultRootFn.mockResolvedValue({ path: "/Users/me/code/acme", isGitRepo: true });
    renderPicker({ initial: "" });

    expect(await screen.findByDisplayValue("/Users/me/code/acme")).toBeInTheDocument();
    expect(screen.getByTestId("val").textContent).toBe("/Users/me/code/acme");
  });

  it("browses directories and selects a folder", async () => {
    defaultRootFn.mockResolvedValue({ path: "/root", isGitRepo: false });
    listDirFn.mockResolvedValue({
      path: "/root",
      parent: "/",
      entries: [
        { name: "my-repo", isDir: true, isGitRepo: true, isHidden: false },
        { name: "docs", isDir: true, isGitRepo: false, isHidden: false },
      ],
      isGitRepo: false,
      truncated: false,
    });
    renderPicker({ initial: "/root" });

    fireEvent.click(screen.getByRole("button", { name: /browse/i }));

    // Navigate into a folder, then confirm selection.
    const folder = await screen.findByText("my-repo");
    listDirFn.mockResolvedValue({
      path: "/root/my-repo",
      parent: "/root",
      entries: [],
      isGitRepo: true,
      truncated: false,
    });
    fireEvent.click(folder);

    const use = await screen.findByRole("button", { name: /use this folder/i });
    fireEvent.click(use);

    expect(await screen.findByDisplayValue("/root/my-repo")).toBeInTheDocument();
    expect(screen.getByTestId("val").textContent).toBe("/root/my-repo");
  });
});
