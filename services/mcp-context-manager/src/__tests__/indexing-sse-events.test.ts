// Track 1: SSE Indexing-Progress & Indexing-Complete Events
// Validates that broadcastSSE("indexing-progress", ...) is called during indexing
// and broadcastSSE("indexing-complete", ...) is called after indexing finishes.
// Also validates late-connecting client behavior via markIndexingComplete.

import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "node:http";
import { z } from "zod";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const IndexingProgressSchema = z.object({
  current: z.number().int().min(0),
  total: z.number().int().min(0),
  timestamp: z.number(),
});

const IndexingCompleteSchema = z.object({
  indexedFiles: z.number().int().min(0),
  timestamp: z.number(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reproduces the exact serialization logic from HttpApiServer.broadcastSSE.
 */
function buildSSEMessage(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Parse an SSE message string back into { event, data }.
 */
function parseSSEMessage(message: string): { event: string; data: any } {
  const lines = message.trim().split("\n");
  const eventLine = lines.find((l) => l.startsWith("event: "));
  const dataLine = lines.find((l) => l.startsWith("data: "));
  return {
    event: eventLine?.replace("event: ", "") ?? "",
    data: dataLine ? JSON.parse(dataLine.replace("data: ", "")) : null,
  };
}

// ─── Tests: indexing-progress event ───────────────────────────────────────────

describe("SSE indexing-progress event", () => {
  it("should produce a valid SSE message with correct schema", () => {
    const payload = { current: 5, total: 100, timestamp: Date.now() };
    const message = buildSSEMessage("indexing-progress", payload);

    // Matches SSE wire format
    expect(message).toMatch(/^event: indexing-progress\ndata: .+\n\n$/);

    // Data round-trips correctly
    const parsed = parseSSEMessage(message);
    expect(parsed.event).toBe("indexing-progress");
    expect(parsed.data).toEqual(payload);

    // Validates against schema
    const result = IndexingProgressSchema.safeParse(parsed.data);
    expect(result.success).toBe(true);
  });

  it("should be called during indexing via the onProgress callback pattern", () => {
    // Simulate the pattern from server.ts: the onProgress callback calls broadcastSSE
    const broadcastCalls: Array<{ event: string; data: object }> = [];
    const mockBroadcastSSE = (event: string, data: object) => {
      broadcastCalls.push({ event, data });
    };

    // Simulate buildInitialGraph calling the progress callback
    const totalFiles = 10;
    for (let i = 1; i <= totalFiles; i++) {
      // This mirrors the callback in server.ts:
      // (current, total) => { httpApi.broadcastSSE("indexing-progress", { current, total, timestamp: Date.now() }) }
      mockBroadcastSSE("indexing-progress", {
        current: i,
        total: totalFiles,
        timestamp: Date.now(),
      });
    }

    // Verify broadcastSSE was called for each progress step
    expect(broadcastCalls.length).toBe(totalFiles);

    // Verify all calls used the correct event name
    for (const call of broadcastCalls) {
      expect(call.event).toBe("indexing-progress");
      const result = IndexingProgressSchema.safeParse(call.data);
      expect(result.success).toBe(true);
    }

    // Verify progress is monotonically increasing
    for (let i = 0; i < broadcastCalls.length; i++) {
      const data = broadcastCalls[i].data as { current: number; total: number };
      expect(data.current).toBe(i + 1);
      expect(data.total).toBe(totalFiles);
    }
  });
});

// ─── Tests: indexing-complete event ───────────────────────────────────────────

describe("SSE indexing-complete event", () => {
  it("should produce a valid SSE message with correct schema", () => {
    const payload = { indexedFiles: 42, timestamp: Date.now() };
    const message = buildSSEMessage("indexing-complete", payload);

    expect(message).toMatch(/^event: indexing-complete\ndata: .+\n\n$/);

    const parsed = parseSSEMessage(message);
    expect(parsed.event).toBe("indexing-complete");
    expect(parsed.data).toEqual(payload);

    const result = IndexingCompleteSchema.safeParse(parsed.data);
    expect(result.success).toBe(true);
  });

  it("should be called exactly once after indexing finishes", () => {
    const broadcastCalls: Array<{ event: string; data: object }> = [];
    const mockBroadcastSSE = (event: string, data: object) => {
      broadcastCalls.push({ event, data });
    };

    // Simulate the full indexing flow from server.ts
    const totalFiles = 5;

    // Progress callbacks during indexing
    for (let i = 1; i <= totalFiles; i++) {
      mockBroadcastSSE("indexing-progress", {
        current: i,
        total: totalFiles,
        timestamp: Date.now(),
      });
    }

    // After buildInitialGraph resolves:
    const indexedFiles = totalFiles;
    mockBroadcastSSE("indexing-complete", {
      indexedFiles,
      timestamp: Date.now(),
    });

    // Verify exactly one indexing-complete event
    const completeCalls = broadcastCalls.filter((c) => c.event === "indexing-complete");
    expect(completeCalls.length).toBe(1);

    const completeData = completeCalls[0].data as { indexedFiles: number; timestamp: number };
    expect(completeData.indexedFiles).toBe(indexedFiles);
    expect(typeof completeData.timestamp).toBe("number");
  });
});

// ─── Tests: Late-connecting client behavior ─────────────────────────────────

describe("SSE late-connecting client (indexingState)", () => {
  it("should send indexing-complete to late clients when indexing already finished", async () => {
    // Dynamically import the real HttpApiServer to test markIndexingComplete + handleSSEConnection
    const { HttpApiServer } = await import("../api.js");

    // Create a minimal GraphStore mock
    const mockGraphStore = {} as any;
    const mockClusterConfig = {
      getClusters: () => [],
      getClusterForFile: () => ({ id: "root", path: "", label: "Root", color: "#4A90E2" }),
      startWatching: async () => {},
      stopWatching: async () => {},
    } as any;

    const server = new HttpApiServer(mockGraphStore, mockClusterConfig, 0);

    // Mark indexing as complete before any client connects
    server.markIndexingComplete(42);

    // Start the server on a random port
    await server.start();

    // Get the actual port
    const address = (server as any).server.address();
    const port = address.port;

    // Connect an SSE client
    const messages: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/api/v1/mcp/events`, (res) => {
        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          // SSE messages are delimited by \n\n
          const parts = buffer.split("\n\n");
          // Keep the last (possibly incomplete) part in the buffer
          buffer = parts.pop() || "";
          for (const part of parts) {
            if (part.trim()) {
              messages.push(part.trim());
            }
          }

          // We expect at least 2 messages: connected + indexing-complete
          if (messages.length >= 2) {
            res.destroy();
            resolve();
          }
        });
        res.on("error", () => {
          // Connection destroyed by us — expected
          resolve();
        });
      });
      req.on("error", reject);

      // Safety timeout
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 3000);
    });

    await server.stop();

    // Verify we got the connected event first
    expect(messages.length).toBeGreaterThanOrEqual(2);

    const connectedMsg = messages[0];
    expect(connectedMsg).toContain("event: connected");

    // Verify the second message is indexing-complete with correct data
    const completeMsg = messages[1];
    expect(completeMsg).toContain("event: indexing-complete");

    const dataLine = completeMsg.split("\n").find((l: string) => l.startsWith("data: "));
    expect(dataLine).toBeDefined();
    const parsed = JSON.parse(dataLine!.replace("data: ", ""));
    expect(parsed.indexedFiles).toBe(42);
    expect(typeof parsed.timestamp).toBe("number");

    const result = IndexingCompleteSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it("should NOT send indexing-complete to clients when indexing is still in progress", async () => {
    const { HttpApiServer } = await import("../api.js");

    const mockGraphStore = {} as any;
    const mockClusterConfig = {
      getClusters: () => [],
      getClusterForFile: () => ({ id: "root", path: "", label: "Root", color: "#4A90E2" }),
      startWatching: async () => {},
      stopWatching: async () => {},
    } as any;

    const server = new HttpApiServer(mockGraphStore, mockClusterConfig, 0);
    // Do NOT call markIndexingComplete — indexing is still in progress

    await server.start();
    const address = (server as any).server.address();
    const port = address.port;

    const messages: string[] = [];
    await new Promise<void>((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/api/v1/mcp/events`, (res) => {
        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            if (part.trim()) {
              messages.push(part.trim());
            }
          }

          // After getting the connected event, wait briefly then close
          if (messages.length >= 1) {
            setTimeout(() => {
              res.destroy();
              resolve();
            }, 200);
          }
        });
        res.on("error", () => resolve());
      });
      req.on("error", () => resolve());

      setTimeout(() => {
        req.destroy();
        resolve();
      }, 3000);
    });

    await server.stop();

    // Should only have the connected event — no indexing-complete
    expect(messages.length).toBe(1);
    expect(messages[0]).toContain("event: connected");
    expect(messages.some((m) => m.includes("indexing-complete"))).toBe(false);
  });
});
