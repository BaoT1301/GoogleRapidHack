import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";
import { connectDB, disconnectDB } from "../../db/client";
import { RunModel } from "../../db/models/run.model";
import { GraphModel } from "../../db/models/graph.model";

// Integration test — requires local Mongo. Covers the additive runs.cancel
// mutation (Stop button): owner-scoped, idempotent, marks the run cancelled.
const createCaller = createCallerFactory(appRouter);
const ME = "test_user_cancel";
const OTHER = "test_user_cancel_other";
const me = createCaller({ userId: ME });
const other = createCaller({ userId: OTHER });

beforeAll(async () => {
  await connectDB();
  await GraphModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await RunModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
});

afterAll(async () => {
  await GraphModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await RunModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await disconnectDB();
});

async function makeRun() {
  const graph = await me.graphs.create({ name: "Cancel me" });
  const run = await me.runs.create({ graphId: String(graph._id) });
  return String(run._id);
}

describe("runs.cancel", () => {
  it("cancels an owned run idempotently (no live processes ⇒ killed: 0) and marks it cancelled", async () => {
    const runId = await makeRun();
    const res = await me.runs.cancel({ runId });
    expect(res).toMatchObject({ cancelled: true, runId, killed: 0 });

    const run = await me.runs.getById({ runId });
    expect(run.status).toBe("cancelled");
  });

  it("rejects cancelling a run the caller does not own (404)", async () => {
    const runId = await makeRun();
    await expect(other.runs.cancel({ runId })).rejects.toThrow("NOT_FOUND");
  });
});
