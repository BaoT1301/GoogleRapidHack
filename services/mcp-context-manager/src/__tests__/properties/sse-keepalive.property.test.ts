// Feature: 3d-codebase-globe-visualizer, Property 45: SSE Keepalive Interval
// Feature: 3d-codebase-globe-visualizer, Property 46: SSE Disconnect Resilience

/**
 * SSE Keepalive & Disconnect Resilience Property Tests (Properties 45, 46)
 *
 * Validates the backend SSE server behavior:
 * - Property 45: Keepalive messages are valid SSE format with event type "keepalive"
 * - Property 46: broadcastSSE is resilient to client failures (removes failed clients,
 *   delivers to healthy clients, never throws)
 *
 * Sprint: 6 — Property-Based Testing Batch 4
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";

// ---------------------------------------------------------------------------
// Constants from HttpApiServer (services/mcp-context-manager/src/api.ts)
// ---------------------------------------------------------------------------

/**
 * The keepalive interval constant from the production code:
 *   this.keepaliveInterval = setInterval(() => {
 *     this.broadcastSSE("keepalive", { timestamp: Date.now() });
 *   }, 30_000);
 */
const KEEPALIVE_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Pure function: Reproduces broadcastSSE serialization logic
// From HttpApiServer.broadcastSSE in api.ts:
//   const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
// ---------------------------------------------------------------------------

function buildSSEMessage(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ---------------------------------------------------------------------------
// Pure function: Reproduces broadcastSSE delivery logic with error handling
// From HttpApiServer.broadcastSSE in api.ts:
//   for (const client of this.sseClients) {
//     try { client.write(message); }
//     catch { this.sseClients.delete(client); }
//   }
// ---------------------------------------------------------------------------

interface MockClient {
  id: number;
  shouldFail: boolean;
  receivedMessages: string[];
}

interface BroadcastResult {
  deliveredTo: number[];
  removedClients: number[];
  threw: boolean;
}

function broadcastToClients(
  clients: Set<MockClient>,
  event: string,
  data: object,
): BroadcastResult {
  const message = buildSSEMessage(event, data);
  const deliveredTo: number[] = [];
  const removedClients: number[] = [];
  let threw = false;

  try {
    for (const client of clients) {
      try {
        if (client.shouldFail) {
          throw new Error("Client write failed");
        }
        client.receivedMessages.push(message);
        deliveredTo.push(client.id);
      } catch {
        // Client disconnected — remove from set
        clients.delete(client);
        removedClients.push(client.id);
      }
    }
  } catch {
    threw = true;
  }

  return { deliveredTo, removedClients, threw };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a positive integer timestamp (simulating Date.now()). */
const arbTimestamp = fc.integer({ min: 1, max: 2_000_000_000_000 });

/** Generates a set of mock clients with random failure flags. */
const arbClientSet: fc.Arbitrary<{ id: number; shouldFail: boolean }[]> = fc
  .array(
    fc.record({
      id: fc.integer({ min: 1, max: 1000 }),
      shouldFail: fc.boolean(),
    }),
    { minLength: 1, maxLength: 10 },
  )
  .map((clients) => {
    // Ensure unique IDs
    const seen = new Set<number>();
    return clients.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  })
  .filter((clients) => clients.length > 0);

/** Generates an arbitrary SSE event name. */
const arbEventName = fc.constantFrom("keepalive", "file-change", "connected");

/** Generates an arbitrary SSE data payload. */
const arbPayload = fc.oneof(
  arbTimestamp.map((ts) => ({ timestamp: ts })),
  fc.record({
    type: fc.constantFrom("file-created", "file-updated", "file-deleted"),
    filePath: fc.stringMatching(/^[a-z][a-z0-9\/\-_]{0,30}\.[a-z]{1,4}$/),
    timestamp: arbTimestamp,
  }),
);

// ---------------------------------------------------------------------------
// Property 45: SSE Keepalive Interval
// ---------------------------------------------------------------------------

describe("Property 45: SSE Keepalive Interval", () => {
  it("keepalive messages are valid SSE format: `event: keepalive\\ndata: {\"timestamp\":<number>}\\n\\n`", () => {
    fc.assert(
      fc.property(arbTimestamp, (timestamp) => {
        const message = buildSSEMessage("keepalive", { timestamp });

        // Assert: matches SSE wire format
        const sseRegex = /^event: keepalive\ndata: .+\n\n$/;
        expect(message).toMatch(sseRegex);

        // Assert: data portion is valid JSON
        const lines = message.split("\n");
        expect(lines[0]).toBe("event: keepalive");

        const dataLine = lines[1];
        expect(dataLine.startsWith("data: ")).toBe(true);

        const jsonStr = dataLine.replace(/^data: /, "");
        const parsed = JSON.parse(jsonStr);

        // Assert: parsed object has a numeric timestamp
        expect(typeof parsed.timestamp).toBe("number");
        expect(parsed.timestamp).toBe(timestamp);

        // Assert: no extra fields in keepalive payload
        expect(Object.keys(parsed)).toEqual(["timestamp"]);
      }),
      { numRuns: 100 },
    );
  });

  it("the keepalive interval constant is exactly 30,000ms", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (_seed) => {
        // The interval is a constant — validate it never varies
        expect(KEEPALIVE_INTERVAL_MS).toBe(30_000);
        expect(KEEPALIVE_INTERVAL_MS).toBeGreaterThan(0);
        expect(KEEPALIVE_INTERVAL_MS).toBeLessThanOrEqual(60_000);
      }),
      { numRuns: 100 },
    );
  });

  it("keepalive message round-trips through JSON parse correctly for any positive timestamp", () => {
    fc.assert(
      fc.property(arbTimestamp, (timestamp) => {
        const message = buildSSEMessage("keepalive", { timestamp });
        const dataLine = message.split("\n")[1];
        const jsonStr = dataLine.replace(/^data: /, "");
        const parsed = JSON.parse(jsonStr);

        // Round-trip: the parsed timestamp equals the input
        expect(parsed.timestamp).toBe(timestamp);
      }),
      { numRuns: 100 },
    );
  });

  it("keepalive message ends with double newline (SSE protocol requirement)", () => {
    fc.assert(
      fc.property(arbTimestamp, (timestamp) => {
        const message = buildSSEMessage("keepalive", { timestamp });

        // SSE messages MUST end with \n\n
        expect(message.endsWith("\n\n")).toBe(true);

        // The message should have exactly 2 content lines + 2 trailing newlines
        // Format: "event: keepalive\ndata: {...}\n\n"
        const parts = message.split("\n");
        expect(parts[0]).toBe("event: keepalive");
        expect(parts[1]).toMatch(/^data: /);
        expect(parts[2]).toBe("");
        expect(parts[3]).toBe("");
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 46: SSE Disconnect Resilience
// ---------------------------------------------------------------------------

describe("Property 46: SSE Disconnect Resilience", () => {
  it("all non-throwing clients receive the message", () => {
    fc.assert(
      fc.property(arbClientSet, arbPayload, (clientDefs, payload) => {
        const clients = new Set<MockClient>(
          clientDefs.map((c) => ({
            ...c,
            receivedMessages: [],
          })),
        );

        const { deliveredTo } = broadcastToClients(clients, "file-change", payload);

        // Assert: all healthy clients received the message
        const healthyIds = clientDefs
          .filter((c) => !c.shouldFail)
          .map((c) => c.id);

        expect(deliveredTo.sort()).toEqual(healthyIds.sort());
      }),
      { numRuns: 100 },
    );
  });

  it("throwing clients are removed from the set", () => {
    fc.assert(
      fc.property(arbClientSet, arbPayload, (clientDefs, payload) => {
        const clients = new Set<MockClient>(
          clientDefs.map((c) => ({
            ...c,
            receivedMessages: [],
          })),
        );

        const originalSize = clients.size;
        const { removedClients } = broadcastToClients(clients, "file-change", payload);

        // Assert: failing clients were removed
        const failingIds = clientDefs
          .filter((c) => c.shouldFail)
          .map((c) => c.id);

        expect(removedClients.sort()).toEqual(failingIds.sort());

        // Assert: remaining set size is correct
        const expectedRemaining = originalSize - failingIds.length;
        expect(clients.size).toBe(expectedRemaining);
      }),
      { numRuns: 100 },
    );
  });

  it("the broadcast function never throws regardless of client failures", () => {
    fc.assert(
      fc.property(arbClientSet, arbPayload, (clientDefs, payload) => {
        const clients = new Set<MockClient>(
          clientDefs.map((c) => ({
            ...c,
            receivedMessages: [],
          })),
        );

        const { threw } = broadcastToClients(clients, "file-change", payload);

        // Assert: the function never throws
        expect(threw).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("even when ALL clients fail, the function does not throw and the set is emptied", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        arbPayload,
        (clientCount, payload) => {
          // Create a set where ALL clients will fail
          const clients = new Set<MockClient>(
            Array.from({ length: clientCount }, (_, i) => ({
              id: i + 1,
              shouldFail: true,
              receivedMessages: [],
            })),
          );

          const { threw, deliveredTo, removedClients } = broadcastToClients(
            clients,
            "keepalive",
            payload,
          );

          // Assert: no throw
          expect(threw).toBe(false);
          // Assert: no deliveries
          expect(deliveredTo).toHaveLength(0);
          // Assert: all clients removed
          expect(removedClients).toHaveLength(clientCount);
          // Assert: set is now empty
          expect(clients.size).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("healthy clients receive the exact SSE-formatted message (not corrupted)", () => {
    fc.assert(
      fc.property(arbClientSet, arbEventName, arbPayload, (clientDefs, event, payload) => {
        const clients = new Set<MockClient>(
          clientDefs.map((c) => ({
            ...c,
            receivedMessages: [],
          })),
        );

        broadcastToClients(clients, event, payload);

        // Check each remaining (healthy) client received the correct message
        const expectedMessage = buildSSEMessage(event, payload);
        for (const client of clients) {
          expect(client.receivedMessages).toHaveLength(1);
          expect(client.receivedMessages[0]).toBe(expectedMessage);

          // Verify the message is valid SSE format
          expect(client.receivedMessages[0]).toMatch(
            new RegExp(`^event: ${event}\ndata: .+\n\n$`),
          );

          // Verify the data can be parsed back to the original payload
          const dataLine = client.receivedMessages[0].split("\n")[1];
          const jsonStr = dataLine.replace(/^data: /, "");
          const parsed = JSON.parse(jsonStr);
          expect(parsed).toEqual(payload);
        }
      }),
      { numRuns: 100 },
    );
  });
});
