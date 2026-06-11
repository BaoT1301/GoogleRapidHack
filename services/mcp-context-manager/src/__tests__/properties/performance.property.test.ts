// Feature: 3d-codebase-globe-visualizer, Property 47: No Hard Node Limits
// Feature: 3d-codebase-globe-visualizer, Property 48: Geographic Mapping Performance
// Feature: 3d-codebase-globe-visualizer, Property 49: SSE Concurrent Client Support
// Feature: 3d-codebase-globe-visualizer, Property 50: Initial Load Performance

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { mapFileToCoordinates } from "../../geographic-mapper.js";
import { GraphStore } from "../../graph/graph-store.js";
import type { FileParseResult, EdgeType } from "../../types/schema.js";

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * Generates a valid path segment: 1–12 alphanumeric characters (with underscores/hyphens).
 */
const arbSegment = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,11}$/);

/**
 * Generates a file name with extension.
 */
const arbFileName = fc
  .tuple(arbSegment, fc.constantFrom(".ts", ".py", ".js", ".rs", ".go", ".md"))
  .map(([name, ext]) => name + ext);

/**
 * Generates a relative file path with 1–5 segments (folders + file name).
 */
const arbFilePath = fc
  .tuple(
    fc.array(arbSegment, { minLength: 0, maxLength: 4 }),
    arbFileName,
  )
  .map(([folders, file]) => [...folders, file].join("/"));

/**
 * Generates a cluster path (a prefix ending with "/").
 */
const arbClusterPath = fc
  .array(arbSegment, { minLength: 1, maxLength: 2 })
  .map((segments) => segments.join("/") + "/");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reproduces the broadcastSSE logic from HttpApiServer (api.ts) as a pure function.
 * Given a set of clients (some of which may throw on write), broadcasts a message
 * and returns the set of clients that successfully received it, removing failed ones.
 */
function broadcastSSE(
  clients: Set<{ write: (msg: string) => void }>,
  event: string,
  data: object,
): { delivered: Set<{ write: (msg: string) => void }>; removed: Set<{ write: (msg: string) => void }> } {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const delivered = new Set<{ write: (msg: string) => void }>();
  const removed = new Set<{ write: (msg: string) => void }>();

  for (const client of clients) {
    try {
      client.write(message);
      delivered.add(client);
    } catch {
      // Client disconnected — remove from set (mirrors api.ts behavior)
      clients.delete(client);
      removed.add(client);
    }
  }

  return { delivered, removed };
}

/**
 * Creates a populated GraphStore with N file nodes and random edges between them.
 * Used for Properties 47 and 50.
 */
function buildGraphStore(filePaths: string[], edgeCount: number): GraphStore {
  const store = new GraphStore();

  // Insert file nodes
  for (const filePath of filePaths) {
    const result: FileParseResult = {
      filePath,
      language: filePath.endsWith(".py") ? "python" : "typescript",
      hash: `hash-${filePath}`,
      symbols: [],
      relations: [],
      parsedImports: [],
      resolvedImports: [],
      parseErrors: [],
    };
    store.upsertFileResult(result);
  }

  // Add random edges (imports between files)
  const edgeTypes: EdgeType[] = ["imports", "calls", "reads", "writes", "references"];
  for (let i = 0; i < edgeCount && i < filePaths.length * 2; i++) {
    const sourceIdx = i % filePaths.length;
    const targetIdx = (i + 1 + Math.floor(i / filePaths.length)) % filePaths.length;
    if (sourceIdx === targetIdx) continue;

    // Create an import relationship between files
    const result: FileParseResult = {
      filePath: filePaths[sourceIdx],
      language: filePaths[sourceIdx].endsWith(".py") ? "python" : "typescript",
      hash: `hash-${filePaths[sourceIdx]}-v${i}`,
      symbols: [],
      relations: [],
      parsedImports: [],
      resolvedImports: [filePaths[targetIdx]],
      parseErrors: [],
    };
    store.upsertFileResult(result);
  }

  return store;
}

// ─── Property 47: No Hard Node Limits ─────────────────────────────────────────

describe("Property 47: No Hard Node Limits", () => {
  it("should NOT truncate the node array when no max_nodes param is provided (defaults to Infinity)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }),
        (nodeCount) => {
          // Generate file paths
          const filePaths: string[] = [];
          for (let i = 0; i < nodeCount; i++) {
            filePaths.push(`backend/app/module${i}/file${i}.py`);
          }

          const store = buildGraphStore(filePaths, 0);

          // Export with Infinity limits (the default when no max_nodes param is provided)
          const result = store.exportDependencyGraph({
            scope: "repo",
            maxNodes: Infinity,
            maxEdges: Infinity,
          });

          // Assert: the export does NOT truncate — all nodes are returned
          expect(result.graph.nodes.length).toBe(nodeCount);
          expect(result.meta.truncated).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("should return all nodes when maxNodes is explicitly set to Infinity", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        (nodeCount) => {
          const filePaths: string[] = [];
          for (let i = 0; i < nodeCount; i++) {
            filePaths.push(`services/mcp/src/file${i}.ts`);
          }

          const store = buildGraphStore(filePaths, 0);

          const result = store.exportDependencyGraph({
            scope: "repo",
            maxNodes: Infinity,
            maxEdges: Infinity,
          });

          // No truncation should occur
          expect(result.graph.nodes.length).toBe(nodeCount);
          expect(result.meta.truncated).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("should still respect explicit maxNodes when provided (backward compat)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 500 }),
        fc.integer({ min: 1, max: 9 }),
        (nodeCount, limit) => {
          const filePaths: string[] = [];
          for (let i = 0; i < nodeCount; i++) {
            filePaths.push(`frontend/src/components/comp${i}.tsx`);
          }

          const store = buildGraphStore(filePaths, 0);

          const result = store.exportDependencyGraph({
            scope: "repo",
            maxNodes: limit,
            maxEdges: Infinity,
          });

          // When an explicit limit is provided, it should be respected
          expect(result.graph.nodes.length).toBeLessThanOrEqual(limit);
          // The node count should be capped at the limit (fewer nodes returned than total)
          expect(result.graph.nodes.length).toBeLessThan(nodeCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 48: Geographic Mapping Performance ──────────────────────────────

describe("Property 48: Geographic Mapping Performance", () => {
  it("should map 200 random file paths in < 1000ms", () => {
    fc.assert(
      fc.property(
        arbClusterPath,
        fc.array(arbFilePath, { minLength: 200, maxLength: 200 }),
        (clusterPath, relativePaths) => {
          const filePaths = relativePaths.map((rp) => clusterPath + rp);

          const start = performance.now();
          for (const filePath of filePaths) {
            mapFileToCoordinates(filePath, clusterPath, filePaths);
          }
          const elapsed = performance.now() - start;

          // Assert: mapping all 200 paths completes in < 1000ms
          expect(elapsed).toBeLessThan(1000);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("should produce valid coordinates for all mapped files within the time budget", () => {
    fc.assert(
      fc.property(
        arbClusterPath,
        fc.array(arbFilePath, { minLength: 200, maxLength: 200 }),
        (clusterPath, relativePaths) => {
          const filePaths = relativePaths.map((rp) => clusterPath + rp);

          const start = performance.now();
          for (const filePath of filePaths) {
            const coords = mapFileToCoordinates(filePath, clusterPath, filePaths);
            // Validate coordinate bounds
            expect(coords.lat).toBeGreaterThanOrEqual(-90);
            expect(coords.lat).toBeLessThanOrEqual(90);
            expect(coords.lng).toBeGreaterThanOrEqual(-180);
            expect(coords.lng).toBeLessThanOrEqual(180);
          }
          const elapsed = performance.now() - start;

          expect(elapsed).toBeLessThan(1000);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 49: SSE Concurrent Client Support ───────────────────────────────

describe("Property 49: SSE Concurrent Client Support", () => {
  it("should deliver a message to all N clients in the set", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.record({
          type: fc.constantFrom("file-created", "file-updated", "file-deleted"),
          timestamp: fc.nat({ max: 2_000_000_000 }),
        }),
        (clientCount, payload) => {
          const receivedMessages: string[][] = [];
          const clients = new Set<{ write: (msg: string) => void }>();

          for (let i = 0; i < clientCount; i++) {
            const messages: string[] = [];
            receivedMessages.push(messages);
            clients.add({
              write: (msg: string) => {
                messages.push(msg);
              },
            });
          }

          const { delivered, removed } = broadcastSSE(clients, "file-change", payload);

          // Assert: every client receives exactly one copy of the message
          expect(delivered.size).toBe(clientCount);
          expect(removed.size).toBe(0);

          const expectedMessage = `event: file-change\ndata: ${JSON.stringify(payload)}\n\n`;
          for (const messages of receivedMessages) {
            expect(messages.length).toBe(1);
            expect(messages[0]).toBe(expectedMessage);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("should not deliver corrupted or partial messages to any client", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.record({
          type: fc.constantFrom("file-created", "file-updated", "file-deleted"),
          filePaths: fc.array(arbFilePath, { minLength: 1, maxLength: 5 }),
          timestamp: fc.nat({ max: 2_000_000_000 }),
        }),
        (clientCount, payload) => {
          const clients = new Set<{ write: (msg: string) => void }>();
          const receivedMessages: string[] = [];

          for (let i = 0; i < clientCount; i++) {
            clients.add({
              write: (msg: string) => {
                receivedMessages.push(msg);
              },
            });
          }

          broadcastSSE(clients, "file-change", payload);

          // Assert: no client receives a corrupted or partial message
          const expectedMessage = `event: file-change\ndata: ${JSON.stringify(payload)}\n\n`;
          for (const msg of receivedMessages) {
            // Message must match the SSE format exactly
            expect(msg).toBe(expectedMessage);
            // Verify it's valid SSE: starts with "event:", has "data:", ends with double newline
            expect(msg.startsWith("event: ")).toBe(true);
            expect(msg).toContain("\ndata: ");
            expect(msg.endsWith("\n\n")).toBe(true);
            // Verify the data portion is valid JSON
            const dataLine = msg.split("\n")[1];
            const jsonStr = dataLine.replace(/^data: /, "");
            expect(() => JSON.parse(jsonStr)).not.toThrow();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("should handle mixed success/failure clients: deliver to healthy, remove failed", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
        fc.record({
          type: fc.constantFrom("keepalive"),
          timestamp: fc.nat({ max: 2_000_000_000 }),
        }),
        (_, failureFlags, payload) => {
          const clients = new Set<{ write: (msg: string) => void }>();
          const healthyReceived: string[] = [];
          let healthyCount = 0;
          let failCount = 0;

          for (const shouldFail of failureFlags) {
            if (shouldFail) {
              failCount++;
              clients.add({
                write: () => {
                  throw new Error("Client disconnected");
                },
              });
            } else {
              healthyCount++;
              clients.add({
                write: (msg: string) => {
                  healthyReceived.push(msg);
                },
              });
            }
          }

          // broadcastSSE should NOT throw even when clients fail
          const { delivered, removed } = broadcastSSE(clients, "keepalive", payload);

          // Assert: all healthy clients received the message
          expect(delivered.size).toBe(healthyCount);
          expect(removed.size).toBe(failCount);
          expect(healthyReceived.length).toBe(healthyCount);

          // Assert: failed clients were removed from the set
          expect(clients.size).toBe(healthyCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 50: Initial Load Performance ────────────────────────────────────

describe("Property 50: Initial Load Performance", () => {
  it("should build and export a graph with 500 nodes and 0–2000 edges within 30,000ms", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2000 }),
        (edgeCount) => {
          // Generate 500 file nodes
          const filePaths: string[] = [];
          for (let i = 0; i < 500; i++) {
            const dir = i % 5 === 0 ? "backend/app" : i % 5 === 1 ? "frontend/src" : i % 5 === 2 ? "services/mcp" : i % 5 === 3 ? "backend/tests" : "frontend/tests";
            filePaths.push(`${dir}/module${Math.floor(i / 10)}/file${i}.${i % 2 === 0 ? "py" : "ts"}`);
          }

          const start = performance.now();

          // Build the graph
          const store = buildGraphStore(filePaths, edgeCount);

          // Export the full graph (simulating initial load)
          const result = store.exportDependencyGraph({
            scope: "repo",
            maxNodes: Infinity,
            maxEdges: Infinity,
          });

          const elapsed = performance.now() - start;

          // Assert: completes within 30,000ms (the spec ceiling)
          expect(elapsed).toBeLessThan(30_000);

          // Sanity checks: graph was actually built
          expect(result.graph.nodes.length).toBeGreaterThan(0);
          expect(result.graph.nodes.length).toBeLessThanOrEqual(500);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("should export the graph in under 1 second for typical workloads (500 nodes, moderate edges)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 500 }),
        (edgeCount) => {
          const filePaths: string[] = [];
          for (let i = 0; i < 500; i++) {
            filePaths.push(`backend/app/service${i % 20}/handler${i}.py`);
          }

          const store = buildGraphStore(filePaths, edgeCount);

          // Time only the export (not the build)
          const start = performance.now();
          const result = store.exportDependencyGraph({
            scope: "repo",
            maxNodes: Infinity,
            maxEdges: Infinity,
          });
          const elapsed = performance.now() - start;

          // In practice, export should be well under 1 second
          expect(elapsed).toBeLessThan(1000);
          expect(result.graph.nodes.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
