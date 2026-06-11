import { describe, expect, it } from "vitest";
import { RUNTIME_EVENT_TYPES, NODE_RUN_STATUSES, type RuntimeEvent } from "./types";

describe("runtime event contract", () => {
  it("requires payload to be an object on RuntimeEvent", () => {
    const event = {
      type: "node.stdout",
      runId: "run_test",
      nodeId: "node_test",
      timestamp: "2026-05-30T00:00:00.000Z",
      payload: {
        line: "hello"
      }
    } satisfies RuntimeEvent;

    expect(event.payload).toEqual({ line: "hello" });
    expect(typeof event.payload).toBe("object");
    expect(event.payload).not.toBeNull();
  });

  it("includes required event names", () => {
    expect(RUNTIME_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        "run.started",
        "run.completed",
        "run.failed",
        "node.queued",
        "node.starting",
        "node.worktree.created",
        "node.mcp_config.created",
        "node.running",
        "node.stdout",
        "node.stderr",
        "node.timeout",
        "node.patch",
        "node.output",
        "node.output_parse_failed",
        "node.rule.warning",
        "node.completed",
        "node.failed",
        "node.cancelled",
        "node.skipped",
        "merge.preview.started",
        "merge.preview.ready",
        "merge.started",
        "merge.checks.started",
        "merge.checks.completed",
        "merge.checks.failed",
        "merge.conflicted",
        "merge.completed",
        "merge.failed",
        "merge.aborted"
      ])
    );
  });

  it("centralizes the canonical per-node status enum", () => {
    expect(NODE_RUN_STATUSES).toEqual(
      expect.arrayContaining([
        "pending",
        "running",
        "success",
        "failed",
        "skipped",
        "blocked"
      ])
    );
  });
});
