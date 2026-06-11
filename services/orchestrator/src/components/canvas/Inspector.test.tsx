import { fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { saveLastUsedAgent, getLastUsedAgent } from "@/lib/last-used-agent";

// PLAN-7: previewNodePrompt query result is swapped per-test via this ref.
const previewFn = vi.fn();

let mockCapabilities = [
  { cli: "kiro", available: true },
  { cli: "gemini", available: true },
  { cli: "claude", available: true },
  { cli: "codex", available: true },
];

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    graphs: {
      previewNodePrompt: {
        queryOptions: (input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["graphs", "previewNodePrompt"], input],
          queryFn: () => previewFn(input),
          ...opts,
        }),
      },
      repoInfo: {
        queryOptions: (input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["graphs", "repoInfo"], input],
          queryFn: async () => ({ rootRepoPath: "/repo", baseBranch: "main", isGitRepo: true }),
          ...opts,
        }),
      },
    },
    repo: {
      defaultRoot: {
        queryOptions: (_input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["repo", "defaultRoot"]],
          queryFn: async () => ({ path: "/repo", isGitRepo: true }),
          ...opts,
        }),
      },
      listDir: {
        queryOptions: (input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["repo", "listDir"], input],
          queryFn: async () => ({ path: "/repo", parent: null, entries: [], isGitRepo: true, truncated: false }),
          ...opts,
        }),
      },
      listBranches: {
        queryOptions: (input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["repo", "listBranches"], input],
          queryFn: async () => ({ isGitRepo: true, currentBranch: "main", branches: ["main"] }),
          ...opts,
        }),
      },
    },
    skills: {
      list: {
        queryOptions: (_input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["skills", "list"]],
          queryFn: async () => [
            { id: "minimalist-ui", name: "Minimalist Ui", source: "Leonxlnx/taste-skill" },
          ],
          ...opts,
        }),
      },
    },
    system: {
      capabilities: {
        queryOptions: (_input: unknown, opts: Record<string, unknown> = {}) => ({
          queryKey: [["system", "capabilities"]],
          queryFn: async () => mockCapabilities,
          ...opts,
        }),
      },
    },
  }),
}));

import { Inspector } from "@/components/canvas/Inspector";
import type { AppNode } from "@/components/canvas/serialize";

// SkillAttach (mounted in the Execute inspector) uses `useQuery`, so every
// render needs a QueryClient. Wrap react-testing-library's render once.
function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData([["system", "capabilities"]], mockCapabilities);
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function executeNode(data: Record<string, unknown> = {}): AppNode {
  return {
    id: "n1",
    type: "graphNode",
    position: { x: 0, y: 0 },
    data: { kind: "execute", label: "Build API", status: "pending", data },
  };
}

const personas = [{ id: "frontend_architect", name: "frontend architect" }];

describe("Inspector — Execute node", () => {
  it("renders the Execute fields for the selected node", () => {
    render(
      <Inspector
        node={executeNode({ prompt: "do the thing" })}
        personas={personas}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText("Execute node")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Build API")).toBeInTheDocument(); // label
    expect(screen.getByDisplayValue("do the thing")).toBeInTheDocument(); // prompt
    expect(screen.getByText("Persona / template")).toBeInTheDocument();
  });

  it("editing the prompt calls onUpdate with the new node data", () => {
    const onUpdate = vi.fn();
    render(
      <Inspector node={executeNode()} personas={personas} onUpdate={onUpdate} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Describe what this agent/i), {
      target: { value: "refactor the auth module" },
    });
    expect(onUpdate).toHaveBeenCalledWith("n1", {
      data: { prompt: "refactor the auth module" },
    });
  });

  it("editing the model patches node.data.model", () => {
    const onUpdate = vi.fn();
    render(
      <Inspector node={executeNode()} personas={personas} onUpdate={onUpdate} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/claude-sonnet-4, gpt-4.1/i), {
      target: { value: "gemini-2.5-pro" },
    });
    expect(onUpdate).toHaveBeenCalledWith("n1", {
      data: { model: "gemini-2.5-pro" },
    });
  });

  it("shows the empty state when nothing is selected", () => {
    render(<Inspector node={null} personas={personas} onUpdate={vi.fn()} />);
    expect(screen.getByText(/select a node to edit/i)).toBeInTheDocument();
  });

  it("editing the per-node repo path patches node.data.repoPath (no autofill)", () => {
    const onUpdate = vi.fn();
    render(
      <Inspector node={executeNode()} personas={personas} onUpdate={onUpdate} />,
    );
    // No graphId → placeholder falls back to the literal hint.
    const input = screen.getByPlaceholderText("/abs/path/to/repo");
    fireEvent.change(input, { target: { value: "/Users/me/other-repo" } });
    expect(onUpdate).toHaveBeenCalledWith("n1", {
      data: { repoPath: "/Users/me/other-repo" },
    });
  });
});

function kindNode(
  kind: AppNode["data"]["kind"],
  data: Record<string, unknown> = {},
): AppNode {
  return {
    id: "k1",
    type: "graphNode",
    position: { x: 0, y: 0 },
    data: { kind, label: `${kind} node`, status: "pending", data },
  };
}

describe("Inspector — non-Execute kind panels", () => {
  it("renders editable Gate fields and patches node.data.data on edit", () => {
    const onUpdate = vi.fn();
    render(
      <Inspector node={kindNode("gate")} personas={personas} onUpdate={onUpdate} />,
    );
    expect(screen.getByText("Gate node")).toBeInTheDocument();
    expect(screen.queryByText(/fleshed out in batch 2/i)).not.toBeInTheDocument();
    expect(screen.getByText(/resolved from incoming flow edges/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /fan-in mode/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/all upstream nodes succeeded/i), {
      target: { value: "tests pass" },
    });
    expect(onUpdate).toHaveBeenCalledWith("k1", {
      data: { condition: "tests pass" },
    });
  });

  it("renders Loop fields and patches max iterations", () => {
    const onUpdate = vi.fn();
    render(
      <Inspector node={kindNode("loop")} personas={personas} onUpdate={onUpdate} />,
    );
    expect(screen.getByText("Break condition / goal hint")).toBeInTheDocument();
    expect(screen.getByText(/not semantically evaluated yet/i)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("3"), {
      target: { value: "5" },
    });
    expect(onUpdate).toHaveBeenCalledWith("k1", {
      data: { maxIterations: "5" },
    });
  });

  it("renders the Plan runtime fields, helper text, and advanced downstream toggle", () => {
    const onUpdate = vi.fn();
    render(
      <Inspector
        node={kindNode("plan", { objective: "ship it", prompt: "make a graph", model: "gemini-2.5-pro" })}
        personas={personas}
        onUpdate={onUpdate}
      />,
    );
    expect(screen.getByText("Plan node")).toBeInTheDocument();
    expect(screen.getByText(/do not auto-mutate the graph/i)).toBeInTheDocument();
    expect(screen.getByText(/updates the graph for the next run/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("ship it")).toBeInTheDocument();
    expect(screen.getByDisplayValue("make a graph")).toBeInTheDocument();
    expect(screen.getByText("Provider")).toBeInTheDocument();
    expect(screen.getByText("Exact model name")).toBeInTheDocument();
    expect(screen.getByText(/planner may still use the provider default/i)).toBeInTheDocument();
    const toggle = screen.getByRole("checkbox", { name: /advanced: allow downstream/i });
    fireEvent.click(toggle);
    expect(onUpdate).toHaveBeenCalledWith("k1", {
      data: { allowDownstreamAfterProposal: true },
    });
  });
});

describe("Inspector — PLAN-7 prompt preview (dry-run)", () => {
  function renderWithGraph(node: AppNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Inspector node={node} personas={personas} onUpdate={vi.fn()} graphId="g1" />
      </QueryClientProvider>,
    );
  }

  it("opens a read-only dialog showing the assembled prompt + resolved CLI/agent + unresolved bindings", async () => {
    previewFn.mockResolvedValue({
      nodeId: "n1",
      kind: "execute",
      prompt: "## Attached context\n\nbe accessible\n\n---\n\nimplement it",
      cli: "kiro",
      agent: undefined,
      trustTools: "fs_read",
      attachedContextPresent: true,
      unresolvedBindings: ["{{upstream.up.summary}}"],
    });
    renderWithGraph(executeNode({ prompt: "implement it" }));

    fireEvent.click(screen.getByRole("button", { name: /preview prompt/i }));

    const note = await screen.findByTestId("unresolved-bindings");
    expect(note).toHaveTextContent(/Unresolved data bindings/i);
    expect(note).toHaveTextContent("{{upstream.up.summary}}");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("kiro")).toBeInTheDocument();
    // The assembled prompt is rendered read-only.
    const textarea = within(dialog).getByDisplayValue(/implement it/) as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);
  });

  it("is absent when no graphId is provided (no preview affordance)", () => {
    render(<Inspector node={executeNode()} personas={personas} onUpdate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /preview prompt/i })).not.toBeInTheDocument();
  });
});

describe("Inspector — last used agent integration", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockCapabilities = [
      { cli: "kiro", available: true },
      { cli: "gemini", available: true },
      { cli: "claude", available: true },
      { cli: "codex", available: true },
    ];
  });

  it("defaults CLI picker to Codex for real CLI runs", () => {
    saveLastUsedAgent("kiro");
    const onUpdate = vi.fn();
    render(
      <Inspector
        node={executeNode({ prompt: "something", cli: "" })}
        personas={personas}
        onUpdate={onUpdate}
      />,
    );
    const select = screen.getByText("CLI").nextElementSibling as HTMLSelectElement;
    expect(select).toHaveValue("codex");
    expect(screen.queryByText(/Defaulted to your last used agent/)).not.toBeInTheDocument();
    expect(onUpdate).toHaveBeenCalledWith("n1", { data: { cli: "codex" } });
  });

  it("does not default if CLI picker already has a value", () => {
    saveLastUsedAgent("kiro");
    render(
      <Inspector
        node={executeNode({ prompt: "something", cli: "claude" })}
        personas={personas}
        onUpdate={vi.fn()}
      />,
    );
    const select = screen.getByText("CLI").nextElementSibling as HTMLSelectElement;
    expect(select).toHaveValue("claude");
    expect(screen.queryByText(/Defaulted to your last used agent/)).not.toBeInTheDocument();
  });

  it("ignores disabled last-used agent", () => {
    mockCapabilities = [
      { cli: "kiro", available: false },
      { cli: "gemini", available: true },
    ];
    saveLastUsedAgent("kiro");
    render(
      <Inspector
        node={executeNode({ prompt: "something", cli: "" })}
        personas={personas}
        onUpdate={vi.fn()}
      />,
    );
    const select = screen.getByText("CLI").nextElementSibling as HTMLSelectElement;
    expect(select).toHaveValue("codex");
    expect(screen.queryByText(/Defaulted to your last used agent/)).not.toBeInTheDocument();
  });

  it("migrates legacy fake CLI values to Codex", () => {
    const onUpdate = vi.fn();
    render(
      <Inspector
        node={executeNode({ prompt: "something", cli: "fake" })}
        personas={personas}
        onUpdate={onUpdate}
      />,
    );
    const select = screen.getByText("CLI").nextElementSibling as HTMLSelectElement;
    expect(select).toHaveValue("codex");
    expect(screen.getByText(/Legacy fake setting detected/)).toBeInTheDocument();
    expect(onUpdate).toHaveBeenCalledWith("n1", { data: { cli: "codex" } });
  });

  it("saves the selected agent when user updates CLI picker", () => {
    const onUpdate = vi.fn();
    render(
      <Inspector
        node={executeNode({ prompt: "something", cli: "gemini" })}
        personas={personas}
        onUpdate={onUpdate}
      />,
    );
    const select = screen.getByText("CLI").nextElementSibling as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "claude" } });
    expect(onUpdate).toHaveBeenCalledWith("n1", { data: { cli: "claude" } });
    expect(getLastUsedAgent()).toBe("claude");
  });
});
