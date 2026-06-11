import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel } from "../../db/models/graph.model";
import { UserSettingsModel } from "../../db/models/settings.model";

// Integration test — requires local Mongo. Covers the additive graphs.spawnChild
// mutation (5.8b): owner-scoped child sub-graph linked to a parent node.
const createCaller = createCallerFactory(appRouter);
const ME = "test_user_spawn";
const OTHER = "test_user_spawn_other";
const me = createCaller({ userId: ME });
const other = createCaller({ userId: OTHER });

beforeAll(async () => {
  await connectDB();
  await GraphModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
});

afterAll(async () => {
  await GraphModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await UserSettingsModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await disconnectDB();
});

describe("graphs.spawnChild", () => {
  it("creates an owner-scoped child linked to the parent node, seeding a fixer", async () => {
    const parent = await me.graphs.create({
      name: "Parent",
      rootRepoPath: "/repo",
    });
    const parentGraphId = String(parent._id);

    const child = await me.graphs.spawnChild({
      parentGraphId,
      parentNodeId: "node_abc",
      name: "Fix the failing test",
    });

    expect(child.ownerId).toBe(ME);
    expect(child.status).toBe("draft");
    expect(child.parentGraphId).toBe(parentGraphId);
    expect(child.parentNodeId).toBe("node_abc");
    // Inherits the parent repo context.
    expect(child.rootRepoPath).toBe("/repo");
    // Defaults to a single Execute "fixer" node when none supplied.
    expect(child.nodes).toHaveLength(1);
    expect(child.nodes[0].kind).toBe("execute");

    // Idempotency: the parent is untouched (still has zero nodes).
    const reloadedParent = await me.graphs.getById({ id: parentGraphId });
    expect(reloadedParent.nodes).toHaveLength(0);
  });

  it("persists caller-supplied seed nodes instead of the default fixer", async () => {
    const parent = await me.graphs.create({ name: "Parent 2" });
    const child = await me.graphs.spawnChild({
      parentGraphId: String(parent._id),
      parentNodeId: "n1",
      name: "Seeded child",
      nodes: [
        {
          id: "seed1",
          kind: "execute",
          label: "Seeded fixer",
          position: { x: 0, y: 0 },
          status: "pending",
          data: { persona: "frontend_architect", prompt: "fix it" },
        },
      ],
    });
    expect(child.nodes).toHaveLength(1);
    expect(child.nodes[0].label).toBe("Seeded fixer");
    expect(child.nodes[0].data).toMatchObject({ persona: "frontend_architect" });
  });

  it("seeds the default fixer node from the owner's fixerConfig settings", async () => {
    await me.settings.update({
      fixerConfig: { cli: "codex", model: "gpt-4.1", persona: "backend_engineer" },
    });
    const parent = await me.graphs.create({ name: "Parent fixerconfig" });
    const child = await me.graphs.spawnChild({
      parentGraphId: String(parent._id),
      parentNodeId: "n1",
      name: "Default fixer from settings",
    });
    expect(child.nodes).toHaveLength(1);
    expect(child.nodes[0].data).toMatchObject({
      cli: "codex",
      model: "gpt-4.1",
      persona: "backend_engineer",
    });
  });

  it("rejects spawning under a parent the caller does not own (404)", async () => {
    const mine = await me.graphs.create({ name: "Private parent" });
    await expect(
      other.graphs.spawnChild({
        parentGraphId: String(mine._id),
        parentNodeId: "n1",
        name: "hijack",
      }),
    ).rejects.toThrow("NOT_FOUND");
  });
});
