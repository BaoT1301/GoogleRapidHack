import { render, screen, act } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useState } from "react";
import { describe, expect, it, vi } from "vitest";

// Controllable SSE stub: capture the dispatch so the test can drive events.
let driver: ((e: unknown) => void) | null = null;
vi.mock("@/components/run/run-stream", () => ({
  subscribeToRun: vi.fn((runId: string, onEvent: (e: unknown) => void) => {
    driver = onEvent;
    return () => {
      driver = null;
    };
  }),
  subscribeToFakeRun: vi.fn(() => () => {}),
}));

// xterm renders into a <canvas> that jsdom can't back without the native
// `canvas` package. Mock the view to render each byte-write as plain text so
// (a) there's no getContext crash and (b) streamed lines are assertable. The
// default Testing-Library normalizer collapses the trailing CRLF.
vi.mock("@/components/run/XtermView", () => ({
  XtermView: forwardRef(function MockXtermView(_props: unknown, ref: unknown) {
    const [lines, setLines] = useState<string[]>([]);
    useImperativeHandle(ref as never, () => ({
      write: (d: string) => setLines((prev) => [...prev, d]),
      clear: () => setLines([]),
      fit: () => {},
      focus: () => {},
    }));
    return (
      <div data-testid="xterm">
        {lines.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    );
  }),
}));

// Stub the interactive terminal — it opens a WebSocket we don't want in unit tests.
vi.mock("@/components/run/InteractiveTerminal", () => ({
  InteractiveTerminal: (props: { nodeId: string }) => (
    <div data-testid="interactive-terminal">{props.nodeId}</div>
  ),
}));

import { ChildRunPanel } from "@/components/run/ChildRunPanel";

function emit(e: Record<string, unknown>) {
  act(() => {
    driver?.(e);
  });
}

describe("ChildRunPanel — live child run (WOW-4)", () => {
  it("renders live status + terminal lines from the child run stream", () => {
    render(<ChildRunPanel runId="crun_1" label="Fix the test" onClose={vi.fn()} />);

    // Empty state before any events.
    expect(screen.getByText(/waiting for the fixer to start/i)).toBeInTheDocument();

    emit({ type: "run.started", runId: "crun_1" });
    // The run-level child linkage frame must NOT create a phantom terminal.
    emit({
      type: "node.child_run.started",
      runId: "crun_1",
      payload: { childRunId: "crun_1", parentNodeId: "p1" },
    });
    emit({ type: "node.running", runId: "crun_1", nodeId: "fix" });
    emit({ type: "node.stdout", runId: "crun_1", nodeId: "fix", payload: { line: "applying patch" } });
    emit({ type: "node.completed", runId: "crun_1", nodeId: "fix" });

    // Live terminal line rendered for the (single) fixer node.
    expect(screen.getByText("applying patch")).toBeInTheDocument();
    // Status badge reflects the node's success state (no phantom parent terminal).
    expect(screen.getByText("success")).toBeInTheDocument();
  });

  it("shows the run-level status as the run completes", () => {
    render(<ChildRunPanel runId="crun_2" onClose={vi.fn()} />);
    emit({ type: "run.started", runId: "crun_2" });
    emit({ type: "run.completed", runId: "crun_2" });
    // The header status badge reflects run completion.
    expect(screen.getByText("completed")).toBeInTheDocument();
  });
});
