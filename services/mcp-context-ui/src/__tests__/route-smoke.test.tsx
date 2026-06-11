/**
 * Smoke test: verifies all 5 routes render without crashing.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "../components/Layout";
import OverviewPage from "../pages/OverviewPage";
import SetupPage from "../pages/SetupPage";
import ApiReferencePage from "../pages/ApiReferencePage";
import AgentsPage from "../pages/AgentsPage";
import GraphPage from "../pages/GraphPage";

// Mock heavy graph dependencies to keep tests fast
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
vi.mock("../components/mcp/SymbolSearch", () => ({
  SymbolSearch: () => <div data-testid="symbol-search" />,
}));
vi.mock("../components/mcp/FileTree", () => ({
  FileTree: () => <div data-testid="file-tree" />,
}));
vi.mock("../components/mcp/Globe3DPhase2", () => ({
  Globe3DPhase2: () => <div data-testid="globe-3d" />,
}));
vi.mock("../components/mcp/EdgeFilterPanel", () => ({
  EdgeFilterPanel: () => <div data-testid="edge-filter" />,
}));
vi.mock("../components/mcp/GlobeLoadingScreen", () => ({
  GlobeLoadingScreen: () => <div data-testid="globe-loading" />,
}));

function renderRoute(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<OverviewPage />} />
            <Route path="setup" element={<SetupPage />} />
            <Route path="api" element={<ApiReferencePage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="graph" element={<GraphPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Route smoke tests", () => {
  it("renders the Overview page at /", () => {
    renderRoute("/");
    expect(screen.getByText("What is MCP?")).toBeTruthy();
    expect(screen.getByText("Get Started")).toBeTruthy();
  });

  it("renders the Setup page at /setup", () => {
    renderRoute("/setup");
    expect(screen.getByText("Docker Setup Wizard")).toBeTruthy();
    expect(screen.getByText("Service Status")).toBeTruthy();
  });

  it("renders the API Reference page at /api", () => {
    renderRoute("/api");
    expect(screen.getByText("API Playground")).toBeTruthy();
  });

  it("renders the Agents page at /agents", () => {
    renderRoute("/agents");
    expect(screen.getByText("AI Agent Configuration")).toBeTruthy();
    expect(screen.getByText("Supported Agents")).toBeTruthy();
  });

  it("renders the Graph page at /graph", () => {
    renderRoute("/graph");
    expect(screen.getByText("No Data Available")).toBeTruthy();
  });

  it("renders navigation tabs on all pages", () => {
    renderRoute("/");
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("Setup")).toBeTruthy();
    expect(screen.getByText("API Reference")).toBeTruthy();
    expect(screen.getByText("AI Agents")).toBeTruthy();
    expect(screen.getByText("Graph")).toBeTruthy();
  });
});
