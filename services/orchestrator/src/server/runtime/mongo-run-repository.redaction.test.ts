import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectDB, disconnectDB } from "../../db/client";
import { RunModel } from "../../db/models";
import { mongoRunRepository } from "./mongo-run-repository";
import { __resetSecretsForTest, registerSecret } from "./secret-redaction";

const ME = "test_user_persist_redaction";

beforeAll(async () => {
  await connectDB();
  await RunModel.deleteMany({ ownerId: ME });
});

afterEach(() => __resetSecretsForTest());

afterAll(async () => {
  await RunModel.deleteMany({ ownerId: ME });
  await disconnectDB();
});

describe("MongoRunRepository — SEC-2 persistence redaction", () => {
  it("scrubs a registered secret from PERSISTED nodeRuns.events", async () => {
    const SECRET = "sk-persisted-secret-0123456789";
    registerSecret(SECRET);

    const run = await RunModel.create({
      graphId: "g_persist",
      ownerId: ME,
      graphSnapshot: {},
      status: "running",
      startedAt: new Date().toISOString(),
      nodeRuns: new Map(),
    });
    const runId = String(run._id);

    await mongoRunRepository.appendNodeEvent({
      type: "node.stderr",
      runId,
      nodeId: "n1",
      timestamp: new Date().toISOString(),
      payload: { line: `export KIRO_API_KEY=${SECRET}` },
    }, ME);

    const reloaded = await RunModel.findById(runId).lean();
    const stored = JSON.stringify(reloaded?.nodeRuns ?? {});
    expect(stored).not.toContain(SECRET);
    expect(stored).toContain("***");
  });

  it("pattern-backstops an UNREGISTERED token at the persistence seam", async () => {
    const run = await RunModel.create({
      graphId: "g_persist2",
      ownerId: ME,
      graphSnapshot: {},
      status: "running",
      startedAt: new Date().toISOString(),
      nodeRuns: new Map(),
    });
    const runId = String(run._id);

    await mongoRunRepository.appendNodeEvent({
      type: "node.stdout",
      runId,
      nodeId: "n1",
      timestamp: new Date().toISOString(),
      payload: { line: "echoed ghp_ABCDEFGHIJ0123456789zzz" },
    }, ME);

    const reloaded = await RunModel.findById(runId).lean();
    const stored = JSON.stringify(reloaded?.nodeRuns ?? {});
    expect(stored).not.toContain("ghp_ABCDEFGHIJ0123456789zzz");
    expect(stored).toContain("***");
  });
});
