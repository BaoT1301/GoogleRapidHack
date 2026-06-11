import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { cleanupTempSnapshots, isSnapshotStale } from "../graph/graph-persistence.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "snapshot-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const snapshotPath = () => path.join(tmpDir, "graph-snapshot.json");

describe("cleanupTempSnapshots", () => {
  it("deletes .tmp.* siblings of the snapshot file", async () => {
    const snap = snapshotPath();
    await fs.writeFile(snap, "{}");
    await fs.writeFile(`${snap}.tmp.12345`, "partial");
    await fs.writeFile(`${snap}.tmp.99999`, "partial2");

    await cleanupTempSnapshots(snap);

    const entries = await fs.readdir(tmpDir);
    expect(entries).not.toContain("graph-snapshot.json.tmp.12345");
    expect(entries).not.toContain("graph-snapshot.json.tmp.99999");
    expect(entries).toContain("graph-snapshot.json"); // canonical file untouched
  });

  it("does not delete the canonical snapshot file", async () => {
    const snap = snapshotPath();
    await fs.writeFile(snap, "{}");
    await cleanupTempSnapshots(snap);
    const entries = await fs.readdir(tmpDir);
    expect(entries).toContain("graph-snapshot.json");
  });

  it("is a no-op when no .tmp.* files exist", async () => {
    const snap = snapshotPath();
    await fs.writeFile(snap, "{}");
    await expect(cleanupTempSnapshots(snap)).resolves.toBeUndefined();
  });

  it("is a no-op when the directory does not exist", async () => {
    const nonExistentSnap = path.join(tmpDir, "nonexistent", "graph-snapshot.json");
    await expect(cleanupTempSnapshots(nonExistentSnap)).resolves.toBeUndefined();
  });
});

describe("isSnapshotStale", () => {
  it("returns false for a freshly written snapshot (age < maxAgeDays)", async () => {
    const snap = snapshotPath();
    await fs.writeFile(snap, "{}");
    const stale = await isSnapshotStale(snap, 7);
    expect(stale).toBe(false);
  });

  it("returns true for a snapshot whose mtime is backdated beyond maxAgeDays", async () => {
    const snap = snapshotPath();
    await fs.writeFile(snap, "{}");
    // Backdate mtime by 8 days
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await fs.utimes(snap, eightDaysAgo, eightDaysAgo);
    const stale = await isSnapshotStale(snap, 7);
    expect(stale).toBe(true);
  });

  it("returns false when the snapshot file does not exist", async () => {
    const snap = snapshotPath();
    const stale = await isSnapshotStale(snap, 7);
    expect(stale).toBe(false);
  });
});
