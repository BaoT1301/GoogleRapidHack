import { describe, expect, it } from "vitest";
import { sanitizeWorktreeSegment } from "./worktree-manager";

describe("sanitizeWorktreeSegment", () => {
  it("sanitizes spaces and slashes for path and branch usage", () => {
    expect(sanitizeWorktreeSegment("node frontend/main", "nodeId")).toBe(
      "node-frontend-main"
    );
  });

  it("rejects unsafe normalized segments", () => {
    expect(() => sanitizeWorktreeSegment("../", "nodeId")).toThrow(
      "not safe"
    );
    expect(() => sanitizeWorktreeSegment(".hidden", "nodeId")).toThrow(
      "not safe"
    );
  });
});
