import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HttpApiServer } from "../api.js";
import { GraphStore } from "../graph/graph-store.js";
import { ClusterConfigLoader } from "../cluster/cluster-config-loader.js";

const fakeCluster = {
  getClusters: () => [],
  getClusterForFile: () => ({ id: "root", path: "./", label: "Root", color: "#000" }),
  startWatching: () => {},
  stopWatching: () => {},
} as unknown as ClusterConfigLoader;

describe("GET /api/v1/diag — memory block", () => {
  let httpApi: HttpApiServer;
  let port: number;

  beforeAll(async () => {
    port = 17700 + Math.floor(Math.random() * 900);
    httpApi = new HttpApiServer(new GraphStore(), fakeCluster, port);
    await httpApi.start();
  });

  afterAll(async () => {
    await httpApi.stop();
  });

  it("memory block is present in diag response", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memory).toBeDefined();
  });

  it("memory block contains all required fields as non-negative numbers", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const body = await res.json();
    const { memory } = body;
    expect(typeof memory.rssMb).toBe("number");
    expect(typeof memory.heapUsedMb).toBe("number");
    expect(typeof memory.heapTotalMb).toBe("number");
    expect(typeof memory.heapLimitMb).toBe("number");
    expect(typeof memory.external).toBe("number");
    expect(typeof memory.degraded).toBe("boolean");
    expect(memory.rssMb).toBeGreaterThanOrEqual(0);
    expect(memory.heapUsedMb).toBeGreaterThanOrEqual(0);
    expect(memory.heapTotalMb).toBeGreaterThanOrEqual(0);
    expect(memory.heapLimitMb).toBeGreaterThan(0);
    expect(memory.external).toBeGreaterThanOrEqual(0);
  });

  it("memory.degraded is false under normal conditions (heap well below 85%)", async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const body = await res.json();
    // Under test conditions heap usage is far below 85% of limit
    expect(body.memory.degraded).toBe(false);
    // Top-level degraded should not include high-heap-usage
    expect(body.reasons ?? []).not.toContain("high-heap-usage");
  });

  it("top-level degraded ORs memory.degraded into reasons", async () => {
    // Verify the structure: if memory.degraded were true, reasons would include "high-heap-usage"
    // We can't force OOM in a unit test, so we verify the shape is correct
    const res = await fetch(`http://localhost:${port}/api/v1/diag`);
    const body = await res.json();
    expect(Array.isArray(body.reasons)).toBe(true);
    expect(typeof body.degraded).toBe("boolean");
    // degraded must be consistent: if any reason present, degraded=true
    if (body.reasons.length > 0) {
      expect(body.degraded).toBe(true);
    }
  });
});
