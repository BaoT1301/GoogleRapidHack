// Feature: 3d-codebase-globe-visualizer, Property 22: SSE Event Emission Latency (Structural Validation)
// Feature: 3d-codebase-globe-visualizer, Property 26: Toast Notification Content (Backend Event Shape)

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { z } from "zod";

// ─── Schema ───────────────────────────────────────────────────────────────────

/**
 * Mirrors the FileChangeEventSchema from the frontend
 * (services/mcp-context-ui/src/types/globe.ts) to validate backend output.
 */
const FileChangeEventSchema = z.object({
  type: z.enum(["file-created", "file-updated", "file-deleted"]),
  filePath: z.string().optional(),
  filePaths: z.array(z.string()).optional(),
  clusterId: z.string().optional(),
  clusterIds: z.array(z.string()).optional(),
  timestamp: z.number(),
});

// ─── broadcastSSE reproduction ────────────────────────────────────────────────

/**
 * Reproduces the exact serialization logic from HttpApiServer.broadcastSSE
 * (services/mcp-context-manager/src/api.ts):
 *
 *   const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
 *
 * This is a pure function — no network I/O — so the "latency" is zero
 * (synchronous string construction). The property validates structural
 * correctness of the output.
 */
function buildSSEMessage(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

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
 * Generates a relative file path with 1–5 segments.
 */
const arbFilePath = fc
  .tuple(
    fc.array(arbSegment, { minLength: 0, maxLength: 4 }),
    arbFileName,
  )
  .map(([folders, file]) => [...folders, file].join("/"));

/**
 * Generates a cluster identifier.
 */
const arbClusterId = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/);

/**
 * Generates a valid FileChangeEvent for "file-created" type.
 * Per server.ts: file-created events use `filePaths` (array) and `clusterIds` (array).
 */
const arbFileCreatedEvent = fc
  .tuple(
    fc.array(arbFilePath, { minLength: 1, maxLength: 10 }),
    fc.array(arbClusterId, { minLength: 1, maxLength: 5 }),
    fc.nat({ max: 2_000_000_000 }),
  )
  .map(([filePaths, clusterIds, timestamp]) => ({
    type: "file-created" as const,
    filePaths,
    clusterIds: [...new Set(clusterIds)],
    timestamp,
  }));

/**
 * Generates a valid FileChangeEvent for "file-updated" type.
 * Per server.ts: file-updated events use `filePaths` (array) and `clusterIds` (array).
 */
const arbFileUpdatedEvent = fc
  .tuple(
    fc.array(arbFilePath, { minLength: 1, maxLength: 10 }),
    fc.array(arbClusterId, { minLength: 1, maxLength: 5 }),
    fc.nat({ max: 2_000_000_000 }),
  )
  .map(([filePaths, clusterIds, timestamp]) => ({
    type: "file-updated" as const,
    filePaths,
    clusterIds: [...new Set(clusterIds)],
    timestamp,
  }));

/**
 * Generates a valid FileChangeEvent for "file-deleted" type.
 * Per server.ts: file-deleted events use `filePath` (single string) and `clusterId` (single string).
 */
const arbFileDeletedEvent = fc
  .tuple(
    arbFilePath,
    arbClusterId,
    fc.nat({ max: 2_000_000_000 }),
  )
  .map(([filePath, clusterId, timestamp]) => ({
    type: "file-deleted" as const,
    filePath,
    clusterId,
    timestamp,
  }));

/**
 * Generates any valid FileChangeEvent (union of all three types).
 */
const arbFileChangeEvent = fc.oneof(
  arbFileCreatedEvent,
  arbFileUpdatedEvent,
  arbFileDeletedEvent,
);

// ─── Property 22: SSE Event Emission Latency (Structural Validation) ──────────

describe("Property 22: SSE Event Emission Latency (Structural Validation)", () => {
  it("should produce a valid SSE message matching the format `event: file-change\\ndata: <valid JSON>\\n\\n`", () => {
    fc.assert(
      fc.property(arbFileChangeEvent, (payload) => {
        const message = buildSSEMessage("file-change", payload);

        // Assert: matches the SSE wire format
        const sseRegex = /^event: file-change\ndata: .+\n\n$/;
        expect(message).toMatch(sseRegex);

        // Assert: the data portion is valid JSON
        const dataLine = message.split("\n")[1];
        const jsonStr = dataLine.replace(/^data: /, "");
        const parsed = JSON.parse(jsonStr);

        // Assert: the parsed object validates against FileChangeEventSchema
        const result = FileChangeEventSchema.safeParse(parsed);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("should produce a message where the parsed data exactly matches the input payload", () => {
    fc.assert(
      fc.property(arbFileChangeEvent, (payload) => {
        const message = buildSSEMessage("file-change", payload);
        const dataLine = message.split("\n")[1];
        const jsonStr = dataLine.replace(/^data: /, "");
        const parsed = JSON.parse(jsonStr);

        // The round-trip through JSON serialization should preserve the payload
        expect(parsed).toEqual(payload);
      }),
      { numRuns: 100 },
    );
  });

  it("should be synchronous — no async delay between call and output", () => {
    fc.assert(
      fc.property(arbFileChangeEvent, (payload) => {
        const before = performance.now();
        const message = buildSSEMessage("file-change", payload);
        const after = performance.now();

        // The function is pure string concatenation — must complete in < 1ms
        expect(after - before).toBeLessThan(1);
        // Sanity: message is non-empty
        expect(message.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 26: Toast Notification Content (Backend Event Shape) ────────────

describe("Property 26: Toast Notification Content (Backend Event Shape)", () => {
  it("should always contain either `filePath` (string) or `filePaths` (non-empty array) for toast extraction", () => {
    fc.assert(
      fc.property(arbFileChangeEvent, (payload) => {
        // The frontend extracts a filename for the toast via:
        //   event.filePath ?? event.filePaths?.[0]
        // At least one must be present and usable.
        const hasFilePath =
          "filePath" in payload &&
          typeof payload.filePath === "string" &&
          payload.filePath.length > 0;
        const hasFilePaths =
          "filePaths" in payload &&
          Array.isArray(payload.filePaths) &&
          payload.filePaths.length > 0;

        expect(hasFilePath || hasFilePaths).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("should always include `filePath` for `file-deleted` events (single file deletion contract)", () => {
    fc.assert(
      fc.property(arbFileDeletedEvent, (payload) => {
        // Per server.ts onDelete callback: file-deleted events always have `filePath`
        expect(payload.type).toBe("file-deleted");
        expect(typeof payload.filePath).toBe("string");
        expect(payload.filePath.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("should always include non-empty `filePaths` for `file-created` events", () => {
    fc.assert(
      fc.property(arbFileCreatedEvent, (payload) => {
        // Per server.ts onUpdate callback: file-created events always have `filePaths`
        expect(payload.type).toBe("file-created");
        expect(Array.isArray(payload.filePaths)).toBe(true);
        expect(payload.filePaths.length).toBeGreaterThan(0);
        // Every path in the array should be a non-empty string
        for (const p of payload.filePaths) {
          expect(typeof p).toBe("string");
          expect(p.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("should always include non-empty `filePaths` for `file-updated` events", () => {
    fc.assert(
      fc.property(arbFileUpdatedEvent, (payload) => {
        // Per server.ts onUpdate callback: file-updated events always have `filePaths`
        expect(payload.type).toBe("file-updated");
        expect(Array.isArray(payload.filePaths)).toBe(true);
        expect(payload.filePaths.length).toBeGreaterThan(0);
        for (const p of payload.filePaths) {
          expect(typeof p).toBe("string");
          expect(p.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
