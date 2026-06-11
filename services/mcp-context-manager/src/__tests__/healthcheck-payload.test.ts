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

describe("GET /api/ready — readiness probe", () => {
  let httpApi: HttpApiServer;
  let port: number;

  beforeAll(async () => {
    port = 17900 + Math.floor(Math.random() * 900);
    httpApi = new HttpApiServer(new GraphStore(), fakeCluster, port);
    await httpApi.start();
  });

  afterAll(async () => {
    await httpApi.stop();
  });

  it("returns 503 { ready: false } before setReady(true)", async () => {
    const res = await fetch(`http://localhost:${port}/api/ready`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ready).toBe(false);
    expect(body.reason).toBe("indexing");
  });

  it("returns 200 { ready: true } after setReady(true)", async () => {
    httpApi.setReady(true);
    const res = await fetch(`http://localhost:${port}/api/ready`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ready).toBe(true);
  });

  it("returns 503 again after setReady(false)", async () => {
    httpApi.setReady(false);
    const res = await fetch(`http://localhost:${port}/api/ready`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ready).toBe(false);
  });

  it("GET /api/health always returns 200 regardless of ready state", async () => {
    // ready is currently false from previous test
    const res = await fetch(`http://localhost:${port}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
