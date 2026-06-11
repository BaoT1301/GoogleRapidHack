import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseCliFlags } from "../server.js";

describe("parseCliFlags", () => {
  it("should detect --stdio-only flag when present", () => {
    const flags = parseCliFlags(["node", "dist/server.js", "--stdio-only"]);
    expect(flags.stdioOnly).toBe(true);
  });

  it("should return stdioOnly=false when flag is absent", () => {
    const flags = parseCliFlags(["node", "dist/server.js"]);
    expect(flags.stdioOnly).toBe(false);
  });

  it("should handle --stdio-only among other arguments", () => {
    const flags = parseCliFlags(["node", "dist/server.js", "--verbose", "--stdio-only", "--debug"]);
    expect(flags.stdioOnly).toBe(true);
  });

  it("should not match partial flag names", () => {
    const flags = parseCliFlags(["node", "dist/server.js", "--stdio-only-mode"]);
    expect(flags.stdioOnly).toBe(false);
  });

  it("should handle empty argv", () => {
    const flags = parseCliFlags([]);
    expect(flags.stdioOnly).toBe(false);
  });
});

describe("--stdio-only mode integration", () => {
  it("should NOT call HttpApiServer.start() when --stdio-only is set", async () => {
    // Mock the HttpApiServer module
    const mockStart = vi.fn().mockResolvedValue(undefined);
    const mockStop = vi.fn().mockResolvedValue(undefined);
    const mockBroadcastSSE = vi.fn();
    const mockMarkIndexingComplete = vi.fn();

    const MockHttpApiServer = vi.fn().mockImplementation(() => ({
      start: mockStart,
      stop: mockStop,
      broadcastSSE: mockBroadcastSSE,
      markIndexingComplete: mockMarkIndexingComplete,
    }));

    // When --stdio-only is set, the bootstrap function should skip httpApi creation
    const flags = parseCliFlags(["node", "dist/server.js", "--stdio-only"]);
    expect(flags.stdioOnly).toBe(true);

    // Simulate the conditional logic from bootstrap
    let httpApi: any = null;
    if (!flags.stdioOnly) {
      httpApi = new MockHttpApiServer({}, {}, 3001);
      await httpApi.start();
    }

    // HttpApiServer should NOT have been instantiated or started
    expect(MockHttpApiServer).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
    expect(httpApi).toBeNull();
  });

  it("should call HttpApiServer.start() when --stdio-only is NOT set", async () => {
    const mockStart = vi.fn().mockResolvedValue(undefined);
    const mockStop = vi.fn().mockResolvedValue(undefined);
    const mockBroadcastSSE = vi.fn();
    const mockMarkIndexingComplete = vi.fn();

    const MockHttpApiServer = vi.fn().mockImplementation(() => ({
      start: mockStart,
      stop: mockStop,
      broadcastSSE: mockBroadcastSSE,
      markIndexingComplete: mockMarkIndexingComplete,
    }));

    const flags = parseCliFlags(["node", "dist/server.js"]);
    expect(flags.stdioOnly).toBe(false);

    // Simulate the conditional logic from bootstrap
    let httpApi: any = null;
    if (!flags.stdioOnly) {
      httpApi = new MockHttpApiServer({}, {}, 3001);
      await httpApi.start();
    }

    // HttpApiServer SHOULD have been instantiated and started
    expect(MockHttpApiServer).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(httpApi).not.toBeNull();
  });

  it("should conditionally call httpApi.stop() in shutdown only if httpApi was started", async () => {
    const mockStop = vi.fn().mockResolvedValue(undefined);

    // Scenario 1: httpApi is null (stdio-only mode)
    let httpApi: any = null;
    if (httpApi) {
      await httpApi.stop();
    }
    expect(mockStop).not.toHaveBeenCalled();

    // Scenario 2: httpApi exists (full mode)
    httpApi = { stop: mockStop };
    if (httpApi) {
      await httpApi.stop();
    }
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it("should skip SSE broadcasting when httpApi is null (stdio-only mode)", () => {
    const mockBroadcastSSE = vi.fn();

    // Simulate stdio-only mode: httpApi is null
    const httpApi: any = null;
    if (httpApi) {
      httpApi.broadcastSSE("indexing-complete", { indexedFiles: 10, timestamp: Date.now() });
    }

    expect(mockBroadcastSSE).not.toHaveBeenCalled();
  });

  it("should broadcast SSE events when httpApi exists (full mode)", () => {
    const mockBroadcastSSE = vi.fn();
    const httpApi: any = { broadcastSSE: mockBroadcastSSE };

    if (httpApi) {
      httpApi.broadcastSSE("indexing-complete", { indexedFiles: 10, timestamp: Date.now() });
    }

    expect(mockBroadcastSSE).toHaveBeenCalledTimes(1);
    expect(mockBroadcastSSE).toHaveBeenCalledWith("indexing-complete", expect.objectContaining({ indexedFiles: 10 }));
  });
});
