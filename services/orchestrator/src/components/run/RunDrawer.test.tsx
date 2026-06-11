import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

const order: string[] = [];
const createSpy = vi.fn(async () => {
  order.push("create");
  return { _id: "run1" };
});
const startSpy = vi.fn(async () => {
  order.push("start");
  return { started: true, runId: "run1" };
});
const cancelSpy = vi.fn(async () => {
  order.push("cancel");
  return { cancelled: true, runId: "run1", killed: 0 };
});

let historyRuns: { _id: string; status: string }[] = [];
const runDocs: Record<string, unknown> = {};
const getByIdSpy = vi.fn(async ({ runId }: { runId: string }) => {
  order.push(`getById:${runId}`);
  return runDocs[runId] ?? null;
});
let streamShouldError = false;

// Controllable SSE stub: fires onOpen, then a run.started event (→ running).
vi.mock("@/components/run/run-stream", () => ({
  subscribeToRun: vi.fn(
    (
      runId: string,
      onEvent: (e: unknown) => void,
      onOpen?: () => void,
      onError?: () => void,
    ) => {
      order.push("subscribe");
      if (streamShouldError) {
        onError?.();
        return () => {};
      }
      onOpen?.();
      onEvent({ type: "run.started", runId });
      return () => {};
    },
  ),
  subscribeToFakeRun: vi.fn(() => () => {}),
}));

// RunTerminal mounts xterm (no jsdom). Stand-in surfaces reducer props as text.
vi.mock("@/components/run/RunTerminal", () => ({
  RunTerminal: ({
    terminal,
    label,
  }: {
    terminal: { nodeId: string; status: string; lines: { text: string }[] };
    label?: string;
  }) => (
    <div data-testid="terminal">
      <span>{label ?? terminal.nodeId}</span>
      <pre>{terminal.lines.map((l) => l.text).join("\n")}</pre>
    </div>
  ),
}));

vi.mock("@/trpc/client", () => {
  return {
    useTRPC: () => ({
      runs: {
        listForGraph: {
          queryOptions: (input: { graphId: string; limit?: number }, opts: Record<string, unknown> = {}) => ({
            queryKey: [["runs", "listForGraph"], input],
            queryFn: async () => historyRuns,
            ...opts,
          }),
        },
        getById: {
          queryOptions: (input: { runId: string }, opts: Record<string, unknown> = {}) => ({
            queryKey: [["runs", "getById"], input],
            queryFn: () => getByIdSpy(input),
            ...opts,
          }),
        },
        create: { mutationOptions: (o = {}) => ({ mutationFn: createSpy, ...o }) },
        start: { mutationOptions: (o = {}) => ({ mutationFn: startSpy, ...o }) },
        cancel: { mutationOptions: (o = {}) => ({ mutationFn: cancelSpy, ...o }) },
      },
    }),
  };
});

import { ToastProvider } from "@/components/ui/Toast";
import {
  computeRunProgress,
  RunDrawer,
} from "@/components/run/RunDrawer";
import { formatElapsedTime } from "@/lib/run-events";
import { useRunController } from "@/components/run/useRunController";

/**
 * Test harness: instantiates the controller exactly like WorkspaceEditor and
 * renders the drawer. A bare "start run" button stands in for the canvas
 * header's smart Run button so we can exercise the launch path here.
 */
function Harness({ hasRepoPath }: { hasRepoPath: boolean }) {
  const controller = useRunController({
    graphId: "g1",
    executeNodes: [{ id: "n1", label: "Build" }],
    hasRepoPath,
    onBeforeRun: async () => {
      order.push("flush");
    },
  });
  return (
    <>
      <button onClick={controller.startRealRun} disabled={!hasRepoPath}>
        start run
      </button>
      <RunDrawer
        controller={controller}
        hasRepoPath={hasRepoPath}
        onClose={vi.fn()}
        onRequestSetRepoPath={vi.fn()}
      />
    </>
  );
}

function renderDrawer(hasRepoPath: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <Harness hasRepoPath={hasRepoPath} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  order.length = 0;
  historyRuns = [];
  streamShouldError = false;
  for (const k of Object.keys(runDocs)) delete runDocs[k];
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("useRunController — live run wiring", () => {
  it("flushes, creates, subscribes, and only starts AFTER the stream opens", async () => {
    const user = userEvent.setup();
    renderDrawer(true);
    await user.click(screen.getByRole("button", { name: /start run/i }));
    await waitFor(() => expect(startSpy).toHaveBeenCalled());
    expect(order.filter((x) => !x.startsWith("getById"))).toEqual([
      "flush",
      "create",
      "subscribe",
      "start",
    ]);
  });

  it("once running, the drawer exposes a Stop control", async () => {
    const user = userEvent.setup();
    renderDrawer(true);
    await user.click(screen.getByRole("button", { name: /start run/i }));
    expect(await screen.findByRole("button", { name: /^stop$/i })).toBeInTheDocument();
  });

  it("does not start the runtime when the SSE event stream fails to open", async () => {
    streamShouldError = true;
    const user = userEvent.setup();
    renderDrawer(true);
    await user.click(screen.getByRole("button", { name: /start run/i }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(startSpy).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/event stream could not connect/i),
    ).toBeInTheDocument();
  });

  it("shows elapsed time and node progress while a run is active", async () => {
    const user = userEvent.setup();
    renderDrawer(true);
    await user.click(screen.getByRole("button", { name: /start run/i }));
    expect(await screen.findByLabelText(/run elapsed/i)).toHaveTextContent("0:00");
    expect(screen.getByText("0/1")).toBeInTheDocument();
  });
});

describe("RunDrawer — elapsed/progress helpers", () => {
  it("formats elapsed runtime as minutes:seconds or hours:minutes:seconds", () => {
    expect(formatElapsedTime(0)).toBe("0:00");
    expect(formatElapsedTime(65_400)).toBe("1:05");
    expect(formatElapsedTime(3_661_000)).toBe("1:01:01");
  });

  it("computes settled-node progress and elapsed duration", () => {
    const progress = computeRunProgress(
      {
        status: "running",
        startedAt: "2026-06-11T00:00:00.000Z",
        nodes: {
          A: { nodeId: "A", status: "success", lines: [], droppedLines: 0 },
          B: { nodeId: "B", status: "running", lines: [], droppedLines: 0 },
        },
        order: ["A", "B"],
        activity: [],
      },
      4,
      Date.parse("2026-06-11T00:01:05.000Z"),
      null,
    );
    expect(progress).toEqual({
      elapsedLabel: "1:05",
      settled: 1,
      total: 4,
      percent: 25,
    });
  });
});

describe("RunDrawer — stop confirmation", () => {
  async function openStopDialog(user: ReturnType<typeof userEvent.setup>) {
    renderDrawer(true);
    await user.click(screen.getByRole("button", { name: /start run/i }));
    const stop = await screen.findByRole("button", { name: /^stop$/i });
    await user.click(stop);
    expect(
      await screen.findByText(/running agents will be terminated/i),
    ).toBeInTheDocument();
  }

  it("Stop opens a confirmation dialog and does NOT cancel until confirmed", async () => {
    const user = userEvent.setup();
    await openStopDialog(user);
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it("confirming the dialog cancels the run via runs.cancel", async () => {
    const user = userEvent.setup();
    await openStopDialog(user);
    await user.click(screen.getByRole("button", { name: /stop run/i }));
    await waitFor(() => expect(cancelSpy).toHaveBeenCalledTimes(1));
  });

  it("Escape closes the dialog without cancelling", async () => {
    const user = userEvent.setup();
    await openStopDialog(user);
    await user.keyboard("{Escape}");
    expect(cancelSpy).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByText(/running agents will be terminated/i),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("RunDrawer — repo-path guidance", () => {
  it("shows the set-repo-path empty state when the graph has no repo path", () => {
    renderDrawer(false);
    expect(screen.getByText(/set a repo path to run/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set repo path/i })).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("RunDrawer — collapse/expand", () => {
  it("collapse hides the body and toggles aria-expanded", async () => {
    const user = userEvent.setup();
    renderDrawer(false);
    // Body (guidance) visible initially.
    expect(screen.getByText(/set a repo path to run/i)).toBeInTheDocument();
    const collapse = screen.getByRole("button", { name: /collapse run drawer/i });
    await user.click(collapse);
    expect(
      screen.getByRole("button", { name: /expand run drawer/i }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/set a repo path to run/i)).not.toBeInTheDocument();
  });
});

describe("RunDrawer — history replay & re-attach", () => {
  const persisted = (type: string, extra: Record<string, unknown> = {}, ts = "") => ({
    ts,
    level: "info",
    payload: { type, ...extra },
  });

  it("clicking a finished run replays stored output without a live subscription", async () => {
    const user = userEvent.setup();
    historyRuns = [{ _id: "runA", status: "completed" }];
    runDocs.runA = {
      status: "completed",
      nodeRuns: {
        n1: {
          nodeId: "n1",
          status: "success",
          events: [
            persisted("node.running", {}, "2024-01-01T00:00:01Z"),
            persisted("node.stdout", { line: "hello-history" }, "2024-01-01T00:00:02Z"),
            persisted("node.completed", {}, "2024-01-01T00:00:03Z"),
          ],
        },
      },
    };
    renderDrawer(true);

    const row = await screen.findByRole("button", { name: /runA/i });
    await user.click(row);

    expect(await screen.findByText(/hello-history/i)).toBeInTheDocument();
    expect(getByIdSpy).toHaveBeenCalledWith({ runId: "runA" });
    expect(order).not.toContain("subscribe");
  });

  it("clicking a still-running run replays AND re-attaches the live stream", async () => {
    const user = userEvent.setup();
    historyRuns = [{ _id: "runB", status: "running" }];
    runDocs.runB = {
      status: "running",
      nodeRuns: {
        n1: {
          nodeId: "n1",
          status: "running",
          events: [persisted("node.running", {}, "2024-01-01T00:00:01Z")],
        },
      },
    };
    renderDrawer(true);

    const row = await screen.findByRole("button", { name: /runB/i });
    await user.click(row);

    await waitFor(() => expect(getByIdSpy).toHaveBeenCalledWith({ runId: "runB" }));
    await waitFor(() => expect(order).toContain("subscribe"));
  });

  it("starting a fresh run clears the previously displayed run's terminals", async () => {
    const user = userEvent.setup();
    historyRuns = [{ _id: "runA", status: "completed" }];
    runDocs.runA = {
      status: "completed",
      nodeRuns: {
        n1: {
          nodeId: "n1",
          status: "success",
          events: [
            persisted("node.stdout", { line: "stale-output" }, "2024-01-01T00:00:02Z"),
          ],
        },
      },
    };
    renderDrawer(true);

    // Open the completed run → its output is shown.
    await user.click(await screen.findByRole("button", { name: /runA/i }));
    expect(await screen.findByText(/stale-output/i)).toBeInTheDocument();

    // Launch a fresh run → prior terminals must be cleared (no bleed-through).
    await user.click(screen.getByRole("button", { name: /start run/i }));
    await waitFor(() => expect(startSpy).toHaveBeenCalled());
    expect(screen.queryByText(/stale-output/i)).not.toBeInTheDocument();
  });

  it("the back control returns from a replayed run to the history list", async () => {
    const user = userEvent.setup();
    historyRuns = [{ _id: "runA", status: "completed" }];
    runDocs.runA = {
      status: "completed",
      nodeRuns: {
        n1: {
          nodeId: "n1",
          status: "success",
          events: [persisted("node.stdout", { line: "hello-history" }, "2024-01-01T00:00:02Z")],
        },
      },
    };
    renderDrawer(true);

    await user.click(await screen.findByRole("button", { name: /runA/i }));
    await screen.findByText(/hello-history/i);

    await user.click(screen.getByRole("button", { name: /^runs$/i }));
    expect(await screen.findByRole("button", { name: /runA/i })).toBeInTheDocument();
    expect(screen.queryByText(/hello-history/i)).not.toBeInTheDocument();
  });
});
