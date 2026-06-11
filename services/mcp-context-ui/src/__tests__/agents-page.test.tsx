/**
 * AgentsPage tests — verifies all 3 agent sections render correctly
 * and the MCP tools list is displayed.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AgentsPage from "../pages/AgentsPage";

// Mock heavy dependencies
vi.mock("../hooks/use-mcp-graph", () => ({
  useMcpGraph: () => ({ data: null, isLoading: false, error: null }),
}));
vi.mock("../hooks/use-cluster-config", () => ({
  useClusterConfig: () => ({ data: null }),
}));
vi.mock("../hooks/use-sse-events", () => ({
  useSSEEvents: () => ({ indexingProgress: null }),
}));

function renderAgentsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/agents"]}>
        <Routes>
          <Route path="/agents" element={<AgentsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("AgentsPage", () => {
  it("renders the page title and introduction", () => {
    renderAgentsPage();
    expect(screen.getByText("AI Agent Configuration")).toBeTruthy();
    expect(screen.getByText("Supported Agents")).toBeTruthy();
  });

  it("renders all 3 agent cards", () => {
    renderAgentsPage();
    // Each agent name appears in both the card and the accordion trigger
    expect(screen.getAllByText("Claude Desktop").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Cursor").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Kiro").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the configuration details accordion", () => {
    renderAgentsPage();
    expect(screen.getByText("Configuration Details")).toBeTruthy();
  });

  it("renders the available MCP tools section", () => {
    renderAgentsPage();
    expect(screen.getByText("Available MCP Tools")).toBeTruthy();
    expect(screen.getByText(/Available MCP Tools \(12\)/)).toBeTruthy();
  });

  it("renders all 12 MCP tool names", () => {
    renderAgentsPage();
    const toolNames = [
      "get_function_context",
      "get_file_dependents",
      "get_symbol_references",
      "export_dependency_graph",
      "get_callers",
      "get_call_chain",
      "get_dead_code",
      "get_impact_analysis",
      "get_module_coupling",
      "get_hotspots",
      "get_class_hierarchy",
      "search_symbols",
    ];
    for (const name of toolNames) {
      // Some tool names appear in both the tool list and usage examples
      expect(screen.getAllByText(name).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("renders usage examples section", () => {
    renderAgentsPage();
    expect(screen.getByText("Usage Examples")).toBeTruthy();
  });

  it("renders the verification section", () => {
    renderAgentsPage();
    expect(screen.getByText("Verify Your Connection")).toBeTruthy();
  });

  it("expands Claude Desktop accordion to show config", () => {
    renderAgentsPage();
    const claudeTrigger = screen.getByText("Claude Desktop", { selector: "span" });
    fireEvent.click(claudeTrigger);
    expect(screen.getByText("Prerequisites")).toBeTruthy();
    expect(screen.getByText("Claude Desktop MCP Configuration")).toBeTruthy();
  });

  it("renders config file paths for each agent card", () => {
    renderAgentsPage();
    expect(screen.getByText("claude_desktop_config.json")).toBeTruthy();
    expect(screen.getByText(".cursor/mcp.json")).toBeTruthy();
    expect(screen.getByText(".kiro/settings/mcp.json")).toBeTruthy();
  });
});
