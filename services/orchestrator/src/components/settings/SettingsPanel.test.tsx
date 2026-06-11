import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

let HEALTH: Record<string, unknown> = {};
let SETTINGS: Record<string, unknown> = {
  allowedTools: ["fs_read"],
  allowedToolsByCli: { kiro: ["fs_read"] },
  plannerProvider: "cloud",
};
let STATUS: Record<string, unknown> = {
  cloud: { status: "ok", reachable: true },
  local: { status: "ready", available: true },
};
let CAPS: unknown[] = [{ cli: "kiro", available: true, authMode: "host-login" }];
let KIRO_TOOLS: Record<string, unknown> = {
  tools: [{ name: "fs_read", kind: "read", description: "Read files." }],
  defaultAllowed: ["fs_read"],
  readOnly: ["fs_read"],
};
let CLI_TOOLS: unknown[] = [
  {
    cli: "kiro",
    wired: true,
    tools: [{ name: "fs_read", kind: "read", description: "Read files." }],
    defaultAllowed: ["fs_read"],
    readOnly: ["fs_read"],
    note: "Applied to EXECUTE nodes.",
  },
];

const queryOpts = (key: string, fn: () => unknown) =>
  (_input: unknown, opts: Record<string, unknown> = {}) => ({
    queryKey: [[key]],
    queryFn: async () => fn(),
    ...opts,
  });

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    plan: {
      health: { queryOptions: queryOpts("plan.health", () => HEALTH) },
      providerStatus: { queryOptions: queryOpts("plan.providerStatus", () => STATUS) },
    },
    system: {
      capabilities: { queryOptions: queryOpts("system.capabilities", () => CAPS) },
      kiroTools: { queryOptions: queryOpts("system.kiroTools", () => KIRO_TOOLS) },
      cliTools: { queryOptions: queryOpts("system.cliTools", () => CLI_TOOLS) },
    },
    settings: {
      get: { queryOptions: queryOpts("settings.get", () => SETTINGS) },
      update: {
        mutationOptions: (opts: Record<string, unknown> = {}) => ({
          mutationFn: async (vars: Record<string, unknown>) => {
            SETTINGS = { ...SETTINGS, ...vars };
            return SETTINGS;
          },
          ...opts,
        }),
      },
    },
    templates: {
      list: { queryOptions: queryOpts("templates.list", () => [] as unknown[]) },
      create: { mutationOptions: (o: Record<string, unknown> = {}) => ({ mutationFn: async () => ({}), ...o }) },
      duplicate: { mutationOptions: (o: Record<string, unknown> = {}) => ({ mutationFn: async () => ({}), ...o }) },
      delete: { mutationOptions: (o: Record<string, unknown> = {}) => ({ mutationFn: async () => ({}), ...o }) },
      update: { mutationOptions: (o: Record<string, unknown> = {}) => ({ mutationFn: async () => ({}), ...o }) },
    },
    skills: {
      list: { queryOptions: queryOpts("skills.list", () => [] as unknown[]) },
    },
  }),
}));

// SystemStatus does live fetches on an interval — stub it out for a deterministic test.
vi.mock("@/components/SystemStatus", () => ({
  SystemStatus: () => <div data-testid="system-status" />,
}));

import { SettingsPanel } from "@/components/settings/SettingsPanel";

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SettingsPanel />
    </QueryClientProvider>,
  );
}

async function openSettings() {
  await userEvent.click(screen.getByRole("button", { name: /settings/i }));
}

describe("SettingsPanel", () => {
  beforeEach(() => {
    HEALTH = {};
  });

  it("shows a healthy badge + model, and never renders a secret token value", async () => {
    HEALTH = {
      configured: true,
      tokenPresent: true,
      apiUrl: "https://architect.example.run.app",
      reachable: true,
      status: "ok",
      model: "gemini-2.5-pro",
    };
    renderPanel();
    await openSettings();

    expect(
      await screen.findByText(/Architect reachable — model responding/i),
    ).toBeInTheDocument();
    expect(screen.getByText("gemini-2.5-pro")).toBeInTheDocument();
    expect(screen.getByText("https://architect.example.run.app")).toBeInTheDocument();
    // Token shown as present/absent only.
    expect(screen.getByText("Present")).toBeInTheDocument();
    // No secret value anywhere in the DOM.
    expect(document.body.textContent).not.toMatch(/X-Service-Token|secret/i);
  });

  it("shows an unreachable badge with the reason", async () => {
    HEALTH = {
      configured: true,
      tokenPresent: false,
      apiUrl: "https://architect.example.run.app",
      reachable: false,
      status: "unreachable",
      reason: "Could not reach the Architect API.",
    };
    renderPanel();
    await openSettings();

    expect(await screen.findByText(/Architect unreachable/i)).toBeInTheDocument();
    expect(screen.getByText(/Could not reach the Architect API/i)).toBeInTheDocument();
    expect(screen.getByText("Absent")).toBeInTheDocument();
  });

  it("shows a rate-limited badge", async () => {
    HEALTH = {
      configured: true,
      tokenPresent: true,
      apiUrl: "https://architect.example.run.app",
      reachable: false,
      status: "rate_limited",
      reason: "Architect API is rate-limited.",
    };
    renderPanel();
    await openSettings();

    expect(await screen.findByText(/Architect rate-limited/i)).toBeInTheDocument();
  });

  it("surfaces the Sprint-2 sections across tabs: planner toggle, CLI status, allowed tools", async () => {
    HEALTH = { configured: true, tokenPresent: true, apiUrl: "x", reachable: true, status: "ok" };
    renderPanel();
    await openSettings();

    // General tab (default): planner toggle is visible.
    expect(await screen.findByText("Planner provider")).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: /Cloud \(Gemini\)/ })).toBeInTheDocument();

    // CLIs & Tools tab: CLI status + allowed tools live here now.
    await userEvent.click(screen.getByRole("tab", { name: /CLIs & Tools/i }));
    expect(await screen.findByText("CLI status")).toBeInTheDocument();
    expect(screen.getByText("Allowed tools")).toBeInTheDocument();
    expect(await screen.findByText("Kiro: signed in (host login)")).toBeInTheDocument();
  });

  it("never flashes a false 'Not configured'/'Absent' before the health probe resolves", async () => {
    // Slow-resolving health so we can observe the pre-resolution render.
    let resolve!: (v: unknown) => void;
    const pending = new Promise((r) => {
      resolve = r;
    });
    HEALTH = pending as unknown as Record<string, unknown>;
    renderPanel();
    await openSettings();

    // While loading: skeletons, and NO misleading values.
    expect(screen.getByText(/Checking the Architect API/i)).toBeInTheDocument();
    expect(screen.queryByText("Not configured")).not.toBeInTheDocument();
    expect(screen.queryByText("Absent")).not.toBeInTheDocument();

    // Resolve as not-configured → now the honest values may appear.
    resolve({
      configured: false,
      tokenPresent: false,
      apiUrl: null,
      reachable: false,
      status: "not_configured",
    });
    expect(await screen.findByText("Not configured")).toBeInTheDocument();
    expect(screen.getByText("Absent")).toBeInTheDocument();
  });

  it("opens the same dialog from the nav-variant trigger", async () => {
    HEALTH = { configured: true, tokenPresent: true, apiUrl: "x", reachable: true, status: "ok" };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SettingsPanel triggerVariant="nav" />
      </QueryClientProvider>,
    );

    // The nav variant renders a text "Settings" button (no gear icon label).
    await userEvent.click(screen.getByRole("button", { name: /^Settings$/ }));

    // Same tabbed dialog content surfaces.
    expect(await screen.findByText("Planner provider")).toBeInTheDocument();
  });
});
