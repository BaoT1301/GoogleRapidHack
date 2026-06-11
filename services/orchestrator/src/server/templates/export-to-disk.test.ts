import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  resolveExportPath,
  writeTemplateToDisk,
  ExportContainmentError,
} from "./export-to-disk";
import { createCallerFactory } from "../init";
import { appRouter } from "../routers/app";
import { connectDB, disconnectDB } from "../../db/client";
import { TemplateModel } from "../../db/models/template.model";

// A fake "orchestrator self repo" the export guard must always refuse to write into.
const SELF_REPO = resolve(tmpdir(), "orch-self-repo-fixture");

describe("resolveExportPath (TPL-3 containment)", () => {
  it("resolves a persona into <target>/.claude/rules/personas/<id>.md", () => {
    const r = resolveExportPath({
      rootRepoPath: "/tmp/target-repo",
      kind: "persona",
      id: "backend_engineer",
      selfRepoPath: SELF_REPO,
    });
    expect(r.filePath).toBe(
      resolve("/tmp/target-repo/.claude/rules/personas/backend_engineer.md"),
    );
  });

  it("resolves a rule into <target>/.claude/rules/<id>.md", () => {
    const r = resolveExportPath({
      outDir: "/tmp/target-repo",
      kind: "rule",
      id: "01-global-master-rules",
      selfRepoPath: SELF_REPO,
    });
    expect(r.filePath).toBe(
      resolve("/tmp/target-repo/.claude/rules/01-global-master-rules.md"),
    );
  });

  it("REFUSES the orchestrator's own .claude/ tree", () => {
    expect(() =>
      resolveExportPath({
        rootRepoPath: SELF_REPO,
        kind: "persona",
        id: "backend_engineer",
        selfRepoPath: SELF_REPO,
      }),
    ).toThrow(ExportContainmentError);
  });

  it("REFUSES id traversal", () => {
    expect(() =>
      resolveExportPath({
        rootRepoPath: "/tmp/target-repo",
        kind: "persona",
        id: "../../etc/passwd",
        selfRepoPath: SELF_REPO,
      }),
    ).toThrow(ExportContainmentError);
  });

  it("REFUSES an unsupported kind (workflow)", () => {
    expect(() =>
      resolveExportPath({
        rootRepoPath: "/tmp/target-repo",
        kind: "workflow",
        id: "anything",
        selfRepoPath: SELF_REPO,
      }),
    ).toThrow(ExportContainmentError);
  });

  it("REFUSES when no target is provided", () => {
    expect(() =>
      resolveExportPath({ kind: "persona", id: "x", selfRepoPath: SELF_REPO }),
    ).toThrow(ExportContainmentError);
  });
});

describe("writeTemplateToDisk (integration)", () => {
  let target: string;
  beforeAll(async () => {
    target = await mkdtemp(join(tmpdir(), "tpl-export-"));
  });
  afterAll(async () => {
    await rm(target, { recursive: true, force: true });
  });

  it("writes a fork and reads it back", async () => {
    const written = await writeTemplateToDisk({
      rootRepoPath: target,
      kind: "persona",
      id: "my_fork",
      content: "# my forked persona\n",
      selfRepoPath: SELF_REPO,
    });
    expect(written).toBe(resolve(target, ".claude/rules/personas/my_fork.md"));
    const back = await readFile(written, "utf8");
    expect(back).toBe("# my forked persona\n");
  });

  it("rejects writing into the orchestrator's own repo", async () => {
    await mkdir(SELF_REPO, { recursive: true });
    await expect(
      writeTemplateToDisk({
        rootRepoPath: SELF_REPO,
        kind: "rule",
        id: "x",
        content: "nope",
        selfRepoPath: SELF_REPO,
      }),
    ).rejects.toThrow(ExportContainmentError);
    await rm(SELF_REPO, { recursive: true, force: true });
  });
});

describe("templates.exportToDisk (router)", () => {
  const createCaller = createCallerFactory(appRouter);
  const ME = "test_user_tpl3_export";
  const me = createCaller({ userId: ME });
  let target: string;

  beforeAll(async () => {
    await connectDB();
    await TemplateModel.deleteMany({ ownerId: ME });
    target = await mkdtemp(join(tmpdir(), "tpl-export-router-"));
    // Seed an owner workspace fork to export.
    await TemplateModel.create({
      id: "exporter_persona",
      name: "Exporter Persona",
      kind: "persona",
      source: "workspace",
      ownerId: ME,
      content: "# exporter\n",
      sha: "deadbeef",
      version: "workspace@deadbeef",
    });
  });

  afterAll(async () => {
    await TemplateModel.deleteMany({ ownerId: ME });
    await rm(target, { recursive: true, force: true });
    await disconnectDB();
  });

  it("exports the owner's fork to the target repo .claude/rules/personas/", async () => {
    const res = await me.templates.exportToDisk({
      id: "exporter_persona",
      kind: "persona",
      rootRepoPath: target,
    });
    expect(res.writtenPath).toBe(
      resolve(target, ".claude/rules/personas/exporter_persona.md"),
    );
    const back = await readFile(res.writtenPath, "utf8");
    expect(back).toBe("# exporter\n");
  });

  it("404s when the owner has no such fork", async () => {
    await expect(
      me.templates.exportToDisk({
        id: "does_not_exist",
        kind: "persona",
        rootRepoPath: target,
      }),
    ).rejects.toThrow();
  });
});
