/**
 * Tests for SetupPage health status rendering.
 * Covers all three HealthStatus states: healthy, degraded, unhealthy.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SetupPage from "../pages/SetupPage";

// Mock the axios instance used by SetupPage
vi.mock("../api/instance", () => ({
  default: { get: vi.fn() },
}));

// Mock heavy graph dependencies (same as route-smoke.test.tsx)
vi.mock("../hooks/use-mcp-graph", () => ({
  useMcpGraph: () => ({ data: null, isLoading: false, error: null }),
}));
vi.mock("../hooks/use-cluster-config", () => ({
  useClusterConfig: () => ({ data: null }),
}));
vi.mock("../hooks/use-sse-events", () => ({
  useSSEEvents: () => ({ indexingProgress: null }),
}));
vi.mock("../components/mcp/DependencyGraph", () => ({
  DependencyGraph: () => <div data-testid="dependency-graph" />,
}));
vi.mock("../components/mcp/Globe3DPhase2", () => ({
  Globe3DPhase2: () => <div data-testid="globe-3d" />,
}));

import api from "../api/instance";
const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function renderSetupPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SetupPage health status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows healthy badge when API returns status ok", async () => {
    mockApi.get.mockResolvedValueOnce({ data: { status: "ok" } });
    renderSetupPage();

    await waitFor(() => {
      expect(screen.getByText("✓ MCP Context Manager is running")).toBeTruthy();
    });

    // Wizard is NOT visible (no wizard card rendered without Reconfigure click)
    expect(screen.queryByText("Prerequisites")).toBeNull();
    // Reconfigure button IS visible
    expect(screen.getByText("Reconfigure")).toBeTruthy();
  });

  it("shows degraded badge and wizard when API returns status degraded", async () => {
    mockApi.get.mockResolvedValueOnce({
      data: { status: "degraded", reasons: ["indexed 0 files"] },
    });
    renderSetupPage();

    await waitFor(() => {
      expect(screen.getByText("⚠ Service degraded — 0 files indexed")).toBeTruthy();
    });

    // Wizard IS visible (StepWizard renders step content)
    expect(screen.getByText("Prerequisites")).toBeTruthy();
    // Reconfigure button is NOT visible
    expect(screen.queryByText("Reconfigure")).toBeNull();
  });

  it("shows unhealthy badge and wizard when API throws", async () => {
    mockApi.get.mockRejectedValueOnce(new Error("Network Error"));
    renderSetupPage();

    await waitFor(() => {
      expect(screen.getByText("✗ Service not reachable")).toBeTruthy();
    });

    // Wizard IS visible
    expect(screen.getByText("Prerequisites")).toBeTruthy();
  });
});
