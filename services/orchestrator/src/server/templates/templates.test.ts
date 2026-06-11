import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { createCallerFactory } from "../init";
import { appRouter } from "../routers/app";
import { connectDB, disconnectDB } from "../../db/client";
import { TemplateModel } from "../../db/models/template.model";
import { seedPersonas, seedRules } from "./seed";

const createCaller = createCallerFactory(appRouter);
const ME = "test_user_p6_tpl";
const OTHER = "test_user_p6_tpl_other";
const me = createCaller({ userId: ME });
const other = createCaller({ userId: OTHER });
let seededCount = 0;
let seededRuleCount = 0;

beforeAll(async () => {
  await connectDB();
  await TemplateModel.deleteMany({ ownerId: ME });
  await TemplateModel.deleteMany({ ownerId: OTHER });
  const personasDir = path.resolve(process.cwd(), "../../.claude/rules/personas");
  const rulesDir = path.resolve(process.cwd(), "../../.claude/rules");
  seededCount = await seedPersonas(personasDir);
  seededRuleCount = await seedRules(rulesDir);
});

afterAll(async () => {
  await TemplateModel.deleteMany({ ownerId: ME });
  await TemplateModel.deleteMany({ ownerId: OTHER });
  await disconnectDB();
});

describe("persona seed + templates router", () => {
  it("seeds the 8 default personas", () => {
    // The repo ships 8 persona definitions in .claude/personas (the set listed in
    // CLAUDE.md's domain mappings: backend_engineer, frontend_architect,
    // internal_tooling_engineer, devops_qa_engineer, integration_reviewer,
    // release_manager, product_architect, knowledge_manager).
    expect(seededCount).toBe(8);
  });

  it("seeds the 2 default rules", () => {
    expect(seededRuleCount).toBe(2);
  });

  it("lists default personas (incl. backend_engineer)", async () => {
    const list = await me.templates.list({ kind: "persona" });
    expect(list.length).toBeGreaterThanOrEqual(7);
    expect(list.some((t) => t.id === "backend_engineer")).toBe(true);
  });

  it("lists default rules (incl. the global master rules)", async () => {
    const list = await me.templates.list({ kind: "rule" });
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((t) => t.kind === "rule")).toBe(true);
    expect(list.some((t) => t.id === "01-global-master-rules")).toBe(true);
  });

  it("fork creates a workspace copy; update changes content + sha/version", async () => {
    const forked = await me.templates.fork({ templateId: "backend_engineer" });
    expect(forked?.source).toBe("workspace");
    expect(forked?.ownerId).toBe(ME);

    const updated = await me.templates.update({
      id: "backend_engineer",
      content: "# edited persona",
    });
    expect(updated.content).toBe("# edited persona");
    expect(updated.version.startsWith("workspace@")).toBe(true);
  });

  it("create makes a blank owner-scoped workspace template", async () => {
    const created = await me.templates.create({
      kind: "persona",
      name: "My Custom Persona",
    });
    expect(created.source).toBe("workspace");
    expect(created.ownerId).toBe(ME);
    expect(created.id).toBe("my_custom_persona");
    expect(created.content).toBe("# My Custom Persona\n");
    expect(created.version.startsWith("workspace@")).toBe(true);
  });

  it("create rejects a colliding workspace id", async () => {
    await expect(
      me.templates.create({ kind: "persona", name: "My Custom Persona" }),
    ).rejects.toThrow();
  });

  it("duplicate forks default→workspace into a new id", async () => {
    const dup = await me.templates.duplicate({
      id: "integration_reviewer",
      kind: "persona",
      newName: "Reviewer Variant A",
    });
    expect(dup.source).toBe("workspace");
    expect(dup.ownerId).toBe(ME);
    expect(dup.id).toBe("reviewer_variant_a");
    // content copied from the default source
    const def = await me.templates.getById({
      id: "integration_reviewer",
      source: "default",
    });
    expect(dup.content).toBe(def.content);
  });

  it("duplicate forks workspace→workspace into another new id", async () => {
    const dup = await me.templates.duplicate({
      id: "reviewer_variant_a",
      kind: "persona",
      newName: "Reviewer Variant B",
    });
    expect(dup.source).toBe("workspace");
    expect(dup.id).toBe("reviewer_variant_b");
  });

  it("delete removes only the owner's fork", async () => {
    const res = await me.templates.delete({
      id: "reviewer_variant_b",
      kind: "persona",
    });
    expect(res.deleted).toBe(true);
    const gone = await TemplateModel.findOne({
      id: "reviewer_variant_b",
      ownerId: ME,
    }).lean();
    expect(gone).toBeNull();
  });

  it("delete refuses a default template (no owner fork exists)", async () => {
    // ME has NOT forked product_architect → no workspace row to delete.
    await expect(
      me.templates.delete({ id: "product_architect", kind: "persona" }),
    ).rejects.toThrow();
    // The default persona must still exist.
    const def = await TemplateModel.findOne({
      id: "product_architect",
      source: "default",
    }).lean();
    expect(def).not.toBeNull();
  });

  it("cross-owner isolation: another user cannot see/delete my fork", async () => {
    // Re-create a fork owned by ME.
    const mine = await me.templates.create({
      kind: "rule",
      name: "Isolation Rule",
    });
    expect(mine.ownerId).toBe(ME);

    // OTHER does not see it in their list.
    const otherList = await other.templates.list({ kind: "rule" });
    expect(otherList.some((t) => t.id === "isolation_rule")).toBe(false);

    // OTHER cannot delete it.
    await expect(
      other.templates.delete({ id: "isolation_rule", kind: "rule" }),
    ).rejects.toThrow();

    // It still belongs to ME.
    const still = await TemplateModel.findOne({
      id: "isolation_rule",
      ownerId: ME,
    }).lean();
    expect(still).not.toBeNull();
  });
});
