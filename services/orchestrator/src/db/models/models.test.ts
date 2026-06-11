import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDB, disconnectDB } from "../client";
import { GraphModel } from "./graph.model";
import { RunModel } from "./run.model";

// Integration test — requires a local Mongo:
//   docker compose -f docker-compose.orchestrator.yml up -d mongo
const OWNER = "test_user_p2";

beforeAll(async () => {
  await connectDB();
  await GraphModel.deleteMany({ ownerId: OWNER });
  await RunModel.deleteMany({ ownerId: OWNER });
});

afterAll(async () => {
  await GraphModel.deleteMany({ ownerId: OWNER });
  await RunModel.deleteMany({ ownerId: OWNER });
  await disconnectDB();
});

describe("Graph model", () => {
  it("creates and reads back a graph with defaults", async () => {
    const created = await GraphModel.create({
      ownerId: OWNER,
      name: "Test Graph",
      nodes: [
        {
          id: "n1",
          kind: "execute",
          label: "Build API",
          position: { x: 10, y: 20 },
          data: { cli: "claude" },
        },
      ],
      edges: [],
    });

    const found = await GraphModel.findById(created._id).lean();
    expect(found).toBeTruthy();
    expect(found?.ownerId).toBe(OWNER);
    expect(found?.status).toBe("draft"); // default
    expect(found?.baseBranch).toBe("main"); // default
    expect(found?.graphSpecVersion).toBe("1.0"); // default
    expect(found?.nodes[0]?.kind).toBe("execute");
    expect(found?.nodes[0]?.status).toBe("pending"); // node default
  });

  it("scopes reads by ownerId (no cross-tenant leakage)", async () => {
    const mine = await GraphModel.create({ ownerId: OWNER, name: "Mine" });
    const other = await GraphModel.findOne({
      _id: mine._id,
      ownerId: "someone_else",
    }).lean();
    expect(other).toBeNull();
    await GraphModel.deleteOne({ _id: mine._id });
  });
});

describe("Run model", () => {
  it("stores an immutable graph snapshot and a keyed nodeRuns map", async () => {
    const run = await RunModel.create({
      graphId: "graph_123",
      ownerId: OWNER,
      graphSnapshot: { name: "frozen", nodes: [] },
      nodeRuns: new Map([
        ["n1", { nodeId: "n1", status: "running", attempt: 1, events: [] }],
      ]),
    });

    const found = await RunModel.findById(run._id).lean();
    expect(found?.status).toBe("running"); // default
    expect((found?.graphSnapshot as { name: string }).name).toBe("frozen");
    // Mongoose Maps deserialize to plain objects via .lean()
    const nodeRuns = found?.nodeRuns as unknown as Record<
      string,
      { status: string }
    >;
    expect(nodeRuns.n1.status).toBe("running");
  });
});
