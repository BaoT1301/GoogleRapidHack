import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

let STATUS: unknown;
let synced = 0;

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    kb: {
      status: {
        queryOptions: (_i: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["kb", "status"]],
          queryFn: async () => STATUS,
          ...opts,
        }),
        queryKey: () => [["kb", "status"]],
      },
      get: { queryKey: () => [["kb", "get"]] },
      sync: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async () => {
            synced += 1;
            return { ok: true };
          },
          ...opts,
        }),
      },
    },
  }),
}));

import { ProjectReadiness } from "@/components/projects/ProjectReadiness";

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProjectReadiness projectId="p1" />
    </QueryClientProvider>,
  );
}

describe("ProjectReadiness", () => {
  beforeEach(() => {
    synced = 0;
  });

  it("renders the checklist with counts + source for a healthy KB", async () => {
    STATUS = {
      repo: { isGitRepo: true },
      kb: {
        synced: true,
        source: "mcp-context-manager",
        fileCount: 120,
        symbolCount: 480,
        vectorCount: 480,
        indexedAt: new Date().toISOString(),
        stale: false,
      },
      ok: true,
      warnings: [],
    };
    renderIt();
    expect(await screen.findByText("Codebase indexed")).toBeInTheDocument();
    expect(screen.getByText(/120 files · 480 symbols · mcp-context-manager/)).toBeInTheDocument();
    expect(screen.getByText(/480 vectors/)).toBeInTheDocument();
  });

  it("surfaces health warnings from kb.status", async () => {
    STATUS = {
      repo: { isGitRepo: false },
      kb: { synced: true, source: "repo-scan", fileCount: 3, symbolCount: 0, vectorCount: 0, indexedAt: null, stale: true },
      ok: false,
      warnings: ["No symbols indexed — the repo looks empty or the indexer returned nothing."],
    };
    renderIt();
    expect(await screen.findByText(/No symbols indexed/)).toBeInTheDocument();
  });

  it("a re-sync fires the kb.sync mutation", async () => {
    STATUS = {
      repo: { isGitRepo: true },
      kb: { synced: true, source: "repo-scan", fileCount: 1, symbolCount: 1, vectorCount: 0, indexedAt: null, stale: false },
      ok: true,
      warnings: [],
    };
    renderIt();
    const btn = await screen.findByRole("button", { name: /re-sync/i });
    await userEvent.click(btn);
    await waitFor(() => expect(synced).toBe(1));
  });
});
