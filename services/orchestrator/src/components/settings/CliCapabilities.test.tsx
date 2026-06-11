import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

let CAPS: unknown[] = [];

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    system: {
      capabilities: {
        queryOptions: (_i: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["system", "capabilities"]],
          queryFn: async () => CAPS,
          ...opts,
        }),
      },
    },
  }),
}));

import { CliCapabilities } from "@/components/settings/CliCapabilities";

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CliCapabilities />
    </QueryClientProvider>,
  );
}

describe("CliCapabilities (RUN-8 — CliAuthBadge wired to live data)", () => {
  beforeEach(() => {
    CAPS = [];
  });

  it("renders the kiro auth badge from authMode + plain availability for others", async () => {
    CAPS = [
      { cli: "kiro", available: true, authMode: "host-login" },
      { cli: "codex", available: false },
    ];
    renderIt();
    expect(await screen.findByText("Kiro: signed in (host login)")).toBeInTheDocument();
    expect(screen.getByText(/codex: not available/i)).toBeInTheDocument();
  });

  it("shows the actionable fix hint when kiro is not signed in", async () => {
    CAPS = [{ cli: "kiro", available: false, authMode: "unauthenticated" }];
    renderIt();
    expect(await screen.findByText("Kiro: not signed in")).toBeInTheDocument();
    expect(screen.getByText(/Run `kiro-cli login` or add KIRO_API_KEY/)).toBeInTheDocument();
  });

  it("never renders a key value", async () => {
    CAPS = [{ cli: "kiro", available: true, authMode: "api-key" }];
    renderIt();
    await screen.findByText("Kiro: using API key (fallback)");
    expect(document.body.textContent).not.toMatch(/sk-/);
  });
});
