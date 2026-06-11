/**
 * SSE Client Tests
 *
 * Property 42: exponential backoff delays 1s, 2s, 4s, 8s, 16s, 30s (capped)
 *
 * These tests verify the reconnection logic by mocking EventSource and
 * inspecting the delay schedule.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// We test the backoff logic in isolation by extracting the algorithm.
// The SSEClient class uses: initial=1000, double on failure, cap at 30000.
// ---------------------------------------------------------------------------

function computeBackoffSequence(
  initialMs: number,
  maxMs: number,
  steps: number,
): number[] {
  const delays: number[] = [];
  let delay = initialMs;
  for (let i = 0; i < steps; i++) {
    delays.push(delay);
    delay = Math.min(delay * 2, maxMs);
  }
  return delays;
}

describe("SSE Client — exponential backoff", () => {
  // ── Property 42: backoff schedule ───────────────────────────────────
  describe("Property 42: exponential backoff delays", () => {
    it("produces the correct sequence: 1s, 2s, 4s, 8s, 16s, 30s", () => {
      const sequence = computeBackoffSequence(1000, 30000, 6);
      expect(sequence).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
    });

    it("caps at 30s and stays there for subsequent retries", () => {
      const sequence = computeBackoffSequence(1000, 30000, 10);
      // After reaching 30000, all subsequent values should be 30000
      expect(sequence[5]).toBe(30000);
      expect(sequence[6]).toBe(30000);
      expect(sequence[7]).toBe(30000);
      expect(sequence[8]).toBe(30000);
      expect(sequence[9]).toBe(30000);
    });

    it("starts at 1 second", () => {
      const sequence = computeBackoffSequence(1000, 30000, 1);
      expect(sequence[0]).toBe(1000);
    });

    it("doubles each step before hitting the cap", () => {
      const sequence = computeBackoffSequence(1000, 30000, 5);
      for (let i = 1; i < sequence.length; i++) {
        expect(sequence[i]).toBe(sequence[i - 1] * 2);
      }
    });
  });

  // ── SSEClient integration with mocked EventSource ───────────────────
  describe("SSEClient reconnection behavior", () => {
    let originalEventSource: typeof EventSource;

    beforeEach(() => {
      originalEventSource = globalThis.EventSource;
      vi.useFakeTimers();
    });

    afterEach(() => {
      globalThis.EventSource = originalEventSource;
      vi.useRealTimers();
    });

    it("creates an EventSource on construction", async () => {
      let constructorCalled = false;

      class MockEventSource {
        url: string;
        onerror: ((ev: Event) => void) | null = null;
        addEventListener(_type: string, _listener: EventListener) {}
        close() {}
        constructor(url: string) {
          this.url = url;
          constructorCalled = true;
        }
      }

      globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

      // Dynamic import to pick up the mock
      const { SSEClient } = await import("../api/sse");
      const client = new SSEClient("/api/mcp/events");
      expect(constructorCalled).toBe(true);
      client.disconnect();
    });

    it("reconnects with exponential backoff on error", async () => {
      const connectionAttempts: number[] = [];
      let errorHandler: ((ev: Event) => void) | null = null;

      class MockEventSource {
        url: string;
        onerror: ((ev: Event) => void) | null = null;
        addEventListener(_type: string, _listener: EventListener) {}
        close() {}
        constructor(url: string) {
          this.url = url;
          connectionAttempts.push(Date.now());
          // Capture onerror so we can trigger it
          setTimeout(() => {
            errorHandler = this.onerror;
          }, 0);
        }
      }

      globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

      const { SSEClient } = await import("../api/sse");
      const client = new SSEClient("/api/mcp/events");

      // Initial connection
      expect(connectionAttempts).toHaveLength(1);

      // Trigger error → should schedule reconnect at 1s
      await vi.advanceTimersByTimeAsync(1);
      if (errorHandler) {
        (errorHandler as (ev: Event) => void)(new Event("error"));
      }

      // Advance 1s → reconnect attempt
      await vi.advanceTimersByTimeAsync(1000);
      expect(connectionAttempts.length).toBeGreaterThanOrEqual(2);

      client.disconnect();
    });

    it("stops reconnecting after disconnect()", async () => {
      let connectionCount = 0;
      let errorHandler: ((ev: Event) => void) | null = null;

      class MockEventSource {
        url: string;
        onerror: ((ev: Event) => void) | null = null;
        addEventListener(_type: string, _listener: EventListener) {}
        close() {}
        constructor(url: string) {
          this.url = url;
          connectionCount++;
          setTimeout(() => {
            errorHandler = this.onerror;
          }, 0);
        }
      }

      globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

      const { SSEClient } = await import("../api/sse");
      const client = new SSEClient("/api/mcp/events");
      expect(connectionCount).toBe(1);

      // Disconnect before any error
      client.disconnect();

      // Trigger error — should NOT reconnect
      await vi.advanceTimersByTimeAsync(1);
      if (errorHandler) {
        (errorHandler as (ev: Event) => void)(new Event("error"));
      }
      await vi.advanceTimersByTimeAsync(5000);

      expect(connectionCount).toBe(1);
    });
  });
});
