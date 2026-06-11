import { describe, expect, it } from "vitest";
import { deriveFixerContext, FIXER_DIFF_PREVIEW_BUDGET } from "./fixer-context";

describe("deriveFixerContext (WOW-3, pure)", () => {
  it("derives diffPreview + lastError from persisted events (newest matching wins)", () => {
    const nodeRun = {
      status: "failed",
      events: [
        { level: "tool", payload: { type: "node.patch", patchLength: 9, patchPreview: "diff --git old" } },
        { level: "tool", payload: { type: "node.patch", patchLength: 12, patchPreview: "diff --git new" } },
        { level: "error", payload: { type: "node.failed", exitCode: 1, stderrPreview: "boom" } },
        { level: "error", payload: { type: "node.failed", exitCode: 2, reason: "assertion failed" } },
      ],
    };
    const ctx = deriveFixerContext("A", nodeRun, "Build");
    expect(ctx).toEqual({
      nodeId: "A",
      label: "Build",
      diffPreview: "diff --git new", // latest node.patch
      lastError: "assertion failed", // latest node.failed (reason wins)
    });
  });

  it("prefers top-level patch/error fields when present", () => {
    const ctx = deriveFixerContext(
      "B",
      {
        patch: "TOP LEVEL PATCH",
        error: { message: "top-level error" },
        events: [{ payload: { type: "node.patch", patchPreview: "event patch" } }],
      },
      "Node B",
    );
    expect(ctx.diffPreview).toBe("TOP LEVEL PATCH");
    expect(ctx.lastError).toBe("top-level error");
  });

  it("caps the diff preview at the 1000-char budget", () => {
    const big = "x".repeat(5000);
    const ctx = deriveFixerContext("C", { patch: big });
    expect(ctx.diffPreview?.length).toBe(FIXER_DIFF_PREVIEW_BUDGET);
  });

  it("degrades gracefully for a node with no run / no patch / no error", () => {
    expect(deriveFixerContext("D", undefined, "Missing")).toEqual({
      nodeId: "D",
      label: "Missing",
      diffPreview: undefined,
      lastError: undefined,
    });
    expect(deriveFixerContext("E", { status: "success", events: [] })).toEqual({
      nodeId: "E",
      label: undefined,
      diffPreview: undefined,
      lastError: undefined,
    });
  });

  it("falls back to stderrPreview then a default message for node.failed", () => {
    expect(
      deriveFixerContext("F", {
        events: [{ payload: { type: "node.failed", stderrPreview: "stderr boom" } }],
      }).lastError,
    ).toBe("stderr boom");
    expect(
      deriveFixerContext("G", {
        events: [{ payload: { type: "node.failed", exitCode: 3 } }],
      }).lastError,
    ).toBe("Node failed");
  });
});
