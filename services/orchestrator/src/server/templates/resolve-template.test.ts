import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDB, disconnectDB } from "../../db/client";
import { TemplateModel } from "../../db/models/template.model";
import { resolvePersona } from "./resolve-template";

const ME = "test_user_tpl4_resolve";
const OTHER = "test_user_tpl4_resolve_other";

beforeAll(async () => {
  await connectDB();
  await TemplateModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await TemplateModel.deleteMany({ id: "tpl4_persona", source: "default" });

  // A seeded default.
  await TemplateModel.create({
    id: "tpl4_persona",
    name: "tpl4 persona",
    kind: "persona",
    source: "default",
    content: "# default content",
    sha: "d",
    version: "default@d",
  });
  // ME forks it with edited content.
  await TemplateModel.create({
    id: "tpl4_persona",
    name: "tpl4 persona",
    kind: "persona",
    source: "workspace",
    ownerId: ME,
    content: "# MY forked content",
    sha: "f",
    version: "workspace@f",
  });
});

afterAll(async () => {
  await TemplateModel.deleteMany({ ownerId: { $in: [ME, OTHER] } });
  await TemplateModel.deleteMany({ id: "tpl4_persona", source: "default" });
  await disconnectDB();
});

describe("resolvePersona (TPL-4)", () => {
  it("the owner's workspace fork wins over the default", async () => {
    const r = await resolvePersona(ME, "tpl4_persona");
    expect(r?.source).toBe("workspace");
    expect(r?.content).toBe("# MY forked content");
    expect(r?.version).toBe("workspace@f");
  });

  it("falls back to the default when the owner has no fork", async () => {
    const r = await resolvePersona(OTHER, "tpl4_persona");
    expect(r?.source).toBe("default");
    expect(r?.content).toBe("# default content");
  });

  it("returns null for an unknown persona id", async () => {
    const r = await resolvePersona(ME, "no_such_persona_xyz");
    expect(r).toBeNull();
  });

  it("cross-owner isolation: never returns another owner's fork", async () => {
    // OTHER must NOT see ME's edited fork — they get the default.
    const r = await resolvePersona(OTHER, "tpl4_persona");
    expect(r?.content).not.toBe("# MY forked content");
  });
});
