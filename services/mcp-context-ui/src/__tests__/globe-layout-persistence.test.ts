/**
 * Globe Layout Persistence Tests
 *
 * Tests localStorage save/load/clear for globe positions.
 * Uses a mock localStorage since vitest runs in jsdom.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const STORAGE_KEY = "mcp-globe-layout";

// Inline the persistence functions to test them in isolation
// (they're private in Globe3DPhase2, so we replicate the logic here)

interface GlobePosition {
  clusterId: string;
  x: number;
  y: number;
  z: number;
}

function loadPersistedPositions(clusterIds: string[]): GlobePosition[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { positions?: GlobePosition[]; savedAt?: number };
    if (!Array.isArray(parsed.positions)) return null;

    const persistedIds = new Set(parsed.positions.map((p) => p.clusterId));
    const currentIds = new Set(clusterIds);
    if (persistedIds.size !== currentIds.size) return null;
    for (const id of currentIds) {
      if (!persistedIds.has(id)) return null;
    }
    return parsed.positions;
  } catch {
    return null;
  }
}

function savePositions(positions: GlobePosition[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ positions, savedAt: Date.now() }),
    );
  } catch {
    // Silently ignore
  }
}

describe("Globe Layout Persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when no data is persisted", () => {
    const result = loadPersistedPositions(["backend", "frontend"]);
    expect(result).toBeNull();
  });

  it("saves and loads positions correctly", () => {
    const positions: GlobePosition[] = [
      { clusterId: "backend", x: 5, y: 0, z: 0 },
      { clusterId: "frontend", x: -5, y: 0, z: 0 },
    ];

    savePositions(positions);
    const loaded = loadPersistedPositions(["backend", "frontend"]);

    expect(loaded).not.toBeNull();
    expect(loaded).toHaveLength(2);
    expect(loaded![0].clusterId).toBe("backend");
    expect(loaded![0].x).toBe(5);
    expect(loaded![1].clusterId).toBe("frontend");
    expect(loaded![1].x).toBe(-5);
  });

  it("returns null when cluster IDs don't match", () => {
    const positions: GlobePosition[] = [
      { clusterId: "backend", x: 5, y: 0, z: 0 },
      { clusterId: "frontend", x: -5, y: 0, z: 0 },
    ];

    savePositions(positions);

    // Different cluster IDs
    const loaded = loadPersistedPositions(["backend", "services"]);
    expect(loaded).toBeNull();
  });

  it("returns null when cluster count doesn't match", () => {
    const positions: GlobePosition[] = [
      { clusterId: "backend", x: 5, y: 0, z: 0 },
    ];

    savePositions(positions);

    // More clusters than persisted
    const loaded = loadPersistedPositions(["backend", "frontend"]);
    expect(loaded).toBeNull();
  });

  it("returns null for corrupted JSON", () => {
    localStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    const loaded = loadPersistedPositions(["backend"]);
    expect(loaded).toBeNull();
  });

  it("returns null for missing positions array", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: 123 }));
    const loaded = loadPersistedPositions(["backend"]);
    expect(loaded).toBeNull();
  });

  it("returns null for non-array positions", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ positions: "not-array", savedAt: 123 }),
    );
    const loaded = loadPersistedPositions(["backend"]);
    expect(loaded).toBeNull();
  });

  it("clears persisted data on localStorage.removeItem", () => {
    const positions: GlobePosition[] = [
      { clusterId: "backend", x: 5, y: 0, z: 0 },
    ];

    savePositions(positions);
    expect(loadPersistedPositions(["backend"])).not.toBeNull();

    localStorage.removeItem(STORAGE_KEY);
    expect(loadPersistedPositions(["backend"])).toBeNull();
  });

  it("handles localStorage errors gracefully on save", () => {
    // Mock localStorage.setItem to throw
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    // Should not throw
    expect(() => savePositions([{ clusterId: "a", x: 0, y: 0, z: 0 }])).not.toThrow();

    spy.mockRestore();
  });

  it("preserves savedAt timestamp", () => {
    const positions: GlobePosition[] = [
      { clusterId: "backend", x: 1, y: 2, z: 3 },
    ];

    savePositions(positions);

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(typeof parsed.savedAt).toBe("number");
    expect(parsed.savedAt).toBeGreaterThan(0);
  });
});
