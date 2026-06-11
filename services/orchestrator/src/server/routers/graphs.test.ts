import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";
import { connectDB, disconnectDB } from "../../db/client";
import { GraphModel } from "../../db/models/graph.model";
import { NodeSpecZ } from "../../db/models/graph-spec.zod";

// Integration test — requires local Mongo.
const createCaller = createCallerFactory(appRouter);
const ME = "test_user_p4";
const OTHER = "test_user_p4_other";

const me = createCaller({ userId: ME });
const other = createCaller({ userId: OTHER });

beforeAll(async () => {
  await connectDB();
  await GraphModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
});

afterAll(async () => {
  await GraphModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await disconnectDB();
});

describe("graphs router — CRUD", () => {
  it("create → list → getById round-trips, scoped to the owner", async () => {
    const created = await me.graphs.create({ name: "My Sprint" });
    expect(created.ownerId).toBe(ME);
    expect(created.status).toBe("draft");

    const list = await me.graphs.list();
    expect(list.some((g) => String(g._id) === String(created._id))).toBe(true);

    const fetched = await me.graphs.getById({ id: String(created._id) });
    expect(fetched.name).toBe("My Sprint");
  });

  it("update mutates fields; archive sets status; delete removes", async () => {
    const g = await me.graphs.create({ name: "Edit Me" });
    const id = String(g._id);

    const updated = await me.graphs.update({ id, name: "Edited" });
    expect(updated.name).toBe("Edited");

    const archived = await me.graphs.archive({ id });
    expect(archived.status).toBe("archived");

    const del = await me.graphs.delete({ id });
    expect(del.success).toBe(true);

    await expect(me.graphs.getById({ id })).rejects.toThrow("NOT_FOUND");
  });
});

describe("graphs router — ownership isolation", () => {
  it("a user cannot read another user's graph", async () => {
    const mine = await me.graphs.create({ name: "Private" });
    const id = String(mine._id);

    await expect(other.graphs.getById({ id })).rejects.toThrow("NOT_FOUND");
    await expect(other.graphs.update({ id, name: "hacked" })).rejects.toThrow(
      "NOT_FOUND",
    );

    // OTHER's delete should affect nothing; mine still readable.
    const del = await other.graphs.delete({ id });
    expect(del.success).toBe(false);
    expect((await me.graphs.getById({ id })).name).toBe("Private");
  });
});

describe("graphs router — MODEL-1 typed NodeSpec/EdgeSpec validation on save", () => {
  it("accepts a realistic canvas-serialized graph (mixed kinds + data + edge kinds)", async () => {
    const g = await me.graphs.create({ name: "Typed save" });
    const id = String(g._id);

    const updated = await me.graphs.update({
      id,
      nodes: [
        {
          id: "n1",
          kind: "execute",
          label: "Build",
          position: { x: 10, y: 20 },
          status: "pending",
          data: { cli: "fake", prompt: "do the thing", nested: { a: 1 } },
        },
        {
          id: "n2",
          kind: "gate",
          label: "Merge",
          position: { x: 260, y: 0 },
          status: "pending",
          data: {},
        },
        {
          id: "n3",
          kind: "context",
          label: "Notes",
          position: { x: 0, y: 140 },
          status: "pending",
          notes: "reference material",
          data: { text: "be accessible" },
        },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2", kind: "flow" },
        { id: "e2", source: "n3", target: "n1", kind: "attaches-to" },
        { id: "e3", source: "n1", target: "n2", kind: "data", outputKey: "summary", inputKey: "in" },
      ],
    });

    expect(updated.nodes).toHaveLength(3);
    expect(updated.edges).toHaveLength(3);
    expect(updated.nodes.find((n) => n.id === "n1")?.data.prompt).toBe("do the thing");
  });

  it("validates additive data.skills (SKILL-1): array-of-strings ok; malformed rejected", () => {
    // Absent skills → fine.
    expect(NodeSpecZ.parse({ id: "n1", kind: "execute", label: "x" }).data.skills).toBeUndefined();
    // Array of strings → preserved.
    const ok = NodeSpecZ.parse({
      id: "n1",
      kind: "execute",
      label: "x",
      data: { skills: ["minimalist-ui", "high-end-visual-design"] },
    });
    expect(ok.data.skills).toEqual(["minimalist-ui", "high-end-visual-design"]);
    // Malformed skills (not a string[]) → rejected.
    expect(() =>
      NodeSpecZ.parse({ id: "n1", kind: "execute", label: "x", data: { skills: [1, 2] } }),
    ).toThrow();
  });

  it("defaults position/status/data so a minimally-specified node still saves", async () => {
    // zod applies the model defaults at the boundary (proven directly here).
    const parsed = NodeSpecZ.parse({ id: "n1", kind: "plan", label: "Plan" });
    expect(parsed.status).toBe("pending");
    expect(parsed.data).toEqual({});

    const g = await me.graphs.create({ name: "Defaults" });
    const updated = await me.graphs.update({
      id: String(g._id),
      nodes: [{ id: "n1", kind: "plan", label: "Plan" }],
      edges: [],
    });
    const n = updated.nodes[0];
    expect(n.status).toBe("pending");
    expect(n.position).toEqual({ x: 0, y: 0 });
    // (Mongoose does not persist an empty Mixed object, so a round-tripped empty
    // `data` may be absent — the zod default is asserted directly above.)
    expect(n.data ?? {}).toEqual({});
  });

  it("REJECTS an invalid node kind", async () => {
    const g = await me.graphs.create({ name: "Bad kind" });
    await expect(
      me.graphs.update({
        id: String(g._id),
        nodes: [{ id: "n1", kind: "bogus", label: "x", data: {} }] as never,
        edges: [],
      }),
    ).rejects.toThrow();
  });

  it("REJECTS an invalid node status", async () => {
    const g = await me.graphs.create({ name: "Bad status" });
    await expect(
      me.graphs.update({
        id: String(g._id),
        nodes: [{ id: "n1", kind: "execute", label: "x", status: "exploded", data: {} }] as never,
        edges: [],
      }),
    ).rejects.toThrow();
  });

  it("REJECTS an invalid edge kind", async () => {
    const g = await me.graphs.create({ name: "Bad edge" });
    await expect(
      me.graphs.update({
        id: String(g._id),
        nodes: [],
        edges: [{ id: "e1", source: "a", target: "b", kind: "teleport" }] as never,
      }),
    ).rejects.toThrow();
  });

  it("REJECTS a node missing its id", async () => {
    const g = await me.graphs.create({ name: "No id" });
    await expect(
      me.graphs.update({
        id: String(g._id),
        nodes: [{ kind: "execute", label: "x", data: {} }] as never,
        edges: [],
      }),
    ).rejects.toThrow();
  });
});
