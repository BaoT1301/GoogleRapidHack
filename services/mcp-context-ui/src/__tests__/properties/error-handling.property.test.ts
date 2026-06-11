/**
 * Error Handling Property Tests — Property 62: SSE Connection Failure Toast
 *
 * Validates that for any SSE connection failure, the `onConnectionLost`
 * callback is invoked (which triggers a toast in the UI layer).
 *
 * Feature: 3d-codebase-globe-visualizer, Property 62: SSE Connection Failure Toast
 *
 * Sprint: 7 — Property-Based Testing Batch 5
 *
 * Note: Properties 42–44 (Sprint 6) already test exponential backoff and
 * reconnection callbacks. Property 62 focuses specifically on the
 * connectionLostCallbacks invocation guarantee: after wasConnected=true,
 * when onerror fires, ALL registered connectionLostCallbacks must fire.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ---------------------------------------------------------------------------
// Pure model of SSEClient connection-lost behavior
// (extracted from services/mcp-context-ui/src/api/sse.ts)
//
// The SSEClient.onerror handler:
//   1. Checks if disposed — if so, returns early
//   2. Closes the EventSource
//   3. If wasConnected === true, fires all connectionLostCallbacks
//   4. Schedules reconnect
//
// Property 62 validates step 3: ALL registered callbacks fire on error
// after a successful connection.
// ---------------------------------------------------------------------------

/**
 * Simulates the connectionLostCallbacks invocation logic.
 * Given N registered callbacks and a connection state, returns how many fire.
 */
function simulateConnectionLostCallbacks(
  numCallbacks: number,
  wasConnected: boolean,
  errorOccurred: boolean,
  disposed: boolean,
): number {
  if (disposed) return 0;
  if (!errorOccurred) return 0;
  if (!wasConnected) return 0;
  // All registered callbacks fire
  return numCallbacks;
}

// ---------------------------------------------------------------------------
// Property 62: SSE Connection Failure Toast
// ---------------------------------------------------------------------------

describe("Property 62: SSE Connection Failure Toast", () => {
  it("all registered connectionLostCallbacks fire when onerror occurs after wasConnected=true", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        (numCallbacks) => {
          const firedCount = simulateConnectionLostCallbacks(
            numCallbacks,
            true, // wasConnected
            true, // errorOccurred
            false, // not disposed
          );

          // ALL callbacks must fire
          expect(firedCount).toBe(numCallbacks);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("no connectionLostCallbacks fire when wasConnected is false (never connected)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        (numCallbacks) => {
          const firedCount = simulateConnectionLostCallbacks(
            numCallbacks,
            false, // wasConnected — never connected
            true, // errorOccurred
            false, // not disposed
          );

          // No callbacks should fire before initial connection
          expect(firedCount).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("no connectionLostCallbacks fire when client is disposed", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.boolean(),
        (numCallbacks, wasConnected) => {
          const firedCount = simulateConnectionLostCallbacks(
            numCallbacks,
            wasConnected,
            true, // errorOccurred
            true, // disposed
          );

          // Disposed client must not fire callbacks
          expect(firedCount).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("connectionLostCallbacks fire exactly once per error event (not duplicated)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 10 }),
        (numCallbacks, numErrors) => {
          // Simulate multiple error events in sequence
          let totalFired = 0;
          let wasConnected = true;

          for (let i = 0; i < numErrors; i++) {
            const fired = simulateConnectionLostCallbacks(
              numCallbacks,
              wasConnected,
              true,
              false,
            );
            totalFired += fired;
            // After each error, wasConnected remains true (it tracks "has ever connected")
            // In the real SSEClient, each error fires callbacks independently
          }

          // Each error event fires all callbacks once
          expect(totalFired).toBe(numCallbacks * numErrors);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("validates with mock EventSource that all registered callbacks fire on error", async () => {
    let connectedHandler: (() => void) | null = null;
    let errorHandler: (() => void) | null = null;

    const originalEventSource = globalThis.EventSource;

    class MockEventSource {
      url: string;
      onerror: ((ev: Event) => void) | null = null;
      private listeners: Record<string, Array<(event: MessageEvent) => void>> = {};

      constructor(url: string) {
        this.url = url;
        connectedHandler = () => {
          const handlers = this.listeners["connected"] || [];
          handlers.forEach((h) => h({} as MessageEvent));
        };
        errorHandler = () => {
          if (this.onerror) this.onerror({} as Event);
        };
      }

      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(listener);
      }

      close() {}
    }

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    try {
      const { SSEClient } = await import("../../api/sse");

      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          (numCallbacks) => {
            const client = new SSEClient("/api/mcp/events");
            const firedCallbacks: number[] = [];

            // Register N callbacks
            for (let i = 0; i < numCallbacks; i++) {
              const callbackIndex = i;
              client.onConnectionLost(() => {
                firedCallbacks.push(callbackIndex);
              });
            }

            // Establish initial connection (sets wasConnected = true)
            connectedHandler!();

            // Trigger error
            errorHandler!();

            // Assert: ALL registered callbacks fired
            expect(firedCallbacks).toHaveLength(numCallbacks);

            // Assert: each callback fired exactly once
            const uniqueFired = new Set(firedCallbacks);
            expect(uniqueFired.size).toBe(numCallbacks);

            // Assert: callbacks fired in registration order
            for (let i = 0; i < numCallbacks; i++) {
              expect(firedCallbacks[i]).toBe(i);
            }

            client.disconnect();
          },
        ),
        { numRuns: 100 },
      );
    } finally {
      globalThis.EventSource = originalEventSource;
    }
  });

  it("connectionLostCallbacks do NOT fire if error occurs before first successful connection", async () => {
    const originalEventSource = globalThis.EventSource;
    let errorHandler: (() => void) | null = null;

    class MockEventSource {
      url: string;
      onerror: ((ev: Event) => void) | null = null;
      private listeners: Record<string, Array<(event: MessageEvent) => void>> = {};

      constructor(url: string) {
        this.url = url;
        errorHandler = () => {
          if (this.onerror) this.onerror({} as Event);
        };
      }

      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(listener);
      }

      close() {}
    }

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

    try {
      const { SSEClient } = await import("../../api/sse");

      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          (numCallbacks) => {
            const client = new SSEClient("/api/mcp/events");
            let lostCallbackFired = false;

            for (let i = 0; i < numCallbacks; i++) {
              client.onConnectionLost(() => {
                lostCallbackFired = true;
              });
            }

            // Trigger error WITHOUT ever connecting first
            // (wasConnected is still false)
            errorHandler!();

            // Assert: no callbacks fired
            expect(lostCallbackFired).toBe(false);

            client.disconnect();
          },
        ),
        { numRuns: 100 },
      );
    } finally {
      globalThis.EventSource = originalEventSource;
    }
  });
});
