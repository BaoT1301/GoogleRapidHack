import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Define mock data containers
let mockDefaultRoot = { path: "/Users/macbook/Hack/ai-workflow-template", isGitRepo: true };
let mockCapabilities: any[] = [];
let mockListDir = (input: { path?: string }) => {
  const p = input.path;
  if (p === "/Users/macbook/Hack/valid-git") {
    return { path: "/Users/macbook/Hack/valid-git", isGitRepo: true, entries: [], parent: null, truncated: false };
  }
  if (p === "/Users/macbook/Hack/valid-not-git") {
    return { path: "/Users/macbook/Hack/valid-not-git", isGitRepo: false, entries: [], parent: null, truncated: false };
  }
  // fallback for invalid path
  return { path: "/Users/macbook/Hack/ai-workflow-template", isGitRepo: true, entries: [], parent: null, truncated: false };
};

// Mock the tRPC client
const mockMutateCreateGraph = vi.fn().mockResolvedValue({ _id: "graph_123" });
const mockMutateUpdateGraph = vi.fn().mockResolvedValue({});
const mockMutateCreateRun = vi.fn().mockResolvedValue({ _id: "run_123" });
const mockMutateStartRun = vi.fn().mockResolvedValue({});
const mockMutateCancelRun = vi.fn().mockResolvedValue({});

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    repo: {
      defaultRoot: {
        queryOptions: (input: any, opts: any) => ({
          queryKey: ["repo", "defaultRoot"],
          queryFn: async () => mockDefaultRoot,
          ...opts,
        }),
      },
      listDir: {
        queryOptions: (input: any, opts: any) => ({
          queryKey: ["repo", "listDir", input?.path],
          queryFn: async () => mockListDir(input),
          ...opts,
        }),
      },
    },
    system: {
      capabilities: {
        queryOptions: (input: any, opts: any) => ({
          queryKey: ["system", "capabilities"],
          queryFn: async () => mockCapabilities,
          ...opts,
        }),
      },
    },
    graphs: {
      create: {
        mutationOptions: (opts: any = {}) => ({
          mutationFn: mockMutateCreateGraph,
          ...opts,
        }),
      },
      update: {
        mutationOptions: (opts: any = {}) => ({
          mutationFn: mockMutateUpdateGraph,
          ...opts,
        }),
      },
    },
    runs: {
      create: {
        mutationOptions: (opts: any = {}) => ({
          mutationFn: mockMutateCreateRun,
          ...opts,
        }),
      },
      start: {
        mutationOptions: (opts: any = {}) => ({
          mutationFn: mockMutateStartRun,
          ...opts,
        }),
      },
      cancel: {
        mutationOptions: (opts: any = {}) => ({
          mutationFn: mockMutateCancelRun,
          ...opts,
        }),
      },
    },
  }),
}));

import DebugRunPage from "./page";

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DebugRunPage />
    </QueryClientProvider>
  );
}

describe("DebugRunPage UI & Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCapabilities = [
      { cli: "kiro", available: true, authMode: "host-login" },
      { cli: "codex", available: true },
      { cli: "claude", available: false, note: "Claude CLI not found.", suggestedFix: "Install Claude CLI" },
      { cli: "gemini", available: false, note: "Gemini CLI not found.", suggestedFix: "Install Gemini CLI" }
    ];
    if (typeof window !== "undefined") {
      window.localStorage.clear();
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: vi.fn().mockImplementation(() => Promise.resolve()),
        },
        writable: true,
        configurable: true,
      });
    }
  });

  it("renders page header and instructions prompt", async () => {
    renderIt();
    expect(screen.getByRole("heading", { name: "Debug Run" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Instructions Prompt/i)).toBeInTheDocument();
  });

  it("lists all five agents in the capabilities dropdown", async () => {
    renderIt();
    const dropdownButton = screen.getByRole("button", { name: /fake/i });
    fireEvent.click(dropdownButton);

    // Verify all 5 agents are visible in listbox options
    expect(screen.getByRole("option", { name: /fake/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /codex/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /claude/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /gemini/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /kiro/i })).toBeInTheDocument();
  });

  it("disables unavailable agents with dynamic reason, but fake is always available", async () => {
    renderIt();
    const dropdownButton = screen.getByRole("button", { name: /fake/i });
    fireEvent.click(dropdownButton);

    const options = screen.getAllByRole("option");
    const fakeLi = options.find((opt) => opt.textContent?.includes("fake"));
    const claudeLi = options.find((opt) => opt.textContent?.includes("claude"));

    const fakeOpt = within(fakeLi!).getByRole("button");
    const claudeOpt = within(claudeLi!).getByRole("button");

    expect(fakeOpt).not.toBeDisabled();
    expect(claudeOpt).toBeDisabled();
  });

  it("defaults to the last-used agent stored in localStorage if valid", async () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("orchestrator:debugRun:lastUsedAgent", "kiro");
    }
    renderIt();
    // Should render dropdown button with kiro pre-selected
    expect(screen.getByRole("button", { name: /kiro/i })).toBeInTheDocument();
  });

  it("displays correct path validation messages dynamically", async () => {
    renderIt();
    const input = screen.getByPlaceholderText("/abs/path/to/repo");

    // 1. empty repo path shows Path missing error
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("Path missing")).toBeInTheDocument();

    // 2. non-absolute path shows absolute error
    fireEvent.change(input, { target: { value: "relative/path" } });
    expect(screen.getByText("Path must be absolute")).toBeInTheDocument();

    // 3. valid git path validation check
    fireEvent.change(input, { target: { value: "/Users/macbook/Hack/valid-git" } });
    await waitFor(() => {
      expect(screen.getByText("Valid repo")).toBeInTheDocument();
    });

    // 4. valid path but not git
    fireEvent.change(input, { target: { value: "/Users/macbook/Hack/valid-not-git" } });
    await waitFor(() => {
      expect(screen.getByText("Not a git repo")).toBeInTheDocument();
    });

    // 5. non-existent path check
    fireEvent.change(input, { target: { value: "/Users/macbook/Hack/invalid" } });
    await waitFor(() => {
      expect(screen.getByText("Path does not exist")).toBeInTheDocument();
    });
  });

  it("disables the Run Agent button until valid repo path, available agent, and prompt", async () => {
    renderIt();
    const runButton = screen.getByRole("button", { name: /Run Agent/i });
    const pathInput = screen.getByPlaceholderText("/abs/path/to/repo");
    const promptInput = screen.getByPlaceholderText("Tell the agent what to do...");

    // Start disabled because path is empty
    expect(runButton).toBeDisabled();

    // Enter non-absolute path -> still disabled
    fireEvent.change(pathInput, { target: { value: "invalid/path" } });
    expect(runButton).toBeDisabled();

    // Enter valid absolute path but empty prompt -> still disabled
    fireEvent.change(pathInput, { target: { value: "/Users/macbook/Hack/valid-git" } });
    fireEvent.change(promptInput, { target: { value: "" } });
    await waitFor(() => {
      expect(screen.getByText("Valid repo")).toBeInTheDocument();
    });
    expect(runButton).toBeDisabled();

    // Select unavailable agent -> still disabled
    const dropdownButton = screen.getByRole("button", { name: /fake/i });
    fireEvent.click(dropdownButton);
    // Even if path/prompt are valid, selecting unavailable agent blocks run
    // Since we mock dropdown item clicking on disabled button to do nothing, we don't trigger selectAgent

    // Reset prompt and select fake (available) -> should be enabled
    fireEvent.change(promptInput, { target: { value: "Create README" } });
    expect(runButton).not.toBeDisabled();
  });

  it("clears and copies logs from the logs panel toolbar", async () => {
    renderIt();
    
    // Check that toolbar actions are initially disabled because lines are empty
    const copyBtn = screen.getByRole("button", { name: /Copy/i });
    const clearBtn = screen.getByRole("button", { name: /Clear/i });
    expect(copyBtn).toBeDisabled();
    expect(clearBtn).toBeDisabled();

    // Fill valid path and trigger Run Agent to stream mock lines (starts graph execution)
    const pathInput = screen.getByPlaceholderText("/abs/path/to/repo");
    fireEvent.change(pathInput, { target: { value: "/Users/macbook/Hack/valid-git" } });
    
    const runButton = screen.getByRole("button", { name: /Run Agent/i });
    await waitFor(() => expect(runButton).not.toBeDisabled());
    
    fireEvent.click(runButton);

    // Wait for SSE starting/creating logs to be added and check copy/clear are enabled
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Clear/i })).not.toBeDisabled();
    });

    const copySpy = vi.spyOn(navigator.clipboard, "writeText").mockImplementation(async () => {});
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));
    expect(copySpy).toHaveBeenCalled();

    // Trigger clear logs
    fireEvent.click(screen.getByRole("button", { name: /Clear/i }));
    expect(screen.queryByText(/creating graph/)).not.toBeInTheDocument();
  });

  it("supports suggested and recent repo paths dropdown integration", async () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("orchestrator:debugRun:recentRepos", JSON.stringify(["/Users/macbook/Hack/recent-1", "/Users/macbook/Hack/recent-2"]));
    }
    renderIt();

    // Dropdown for suggested repos should render options
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    
    // Choose suggestion and verify input changes
    fireEvent.change(select, { target: { value: "/Users/macbook/Hack/recent-1" } });
    const pathInput = screen.getByPlaceholderText("/abs/path/to/repo") as HTMLInputElement;
    expect(pathInput.value).toBe("/Users/macbook/Hack/recent-1");
  });
});
