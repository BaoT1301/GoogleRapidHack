import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectDB, disconnectDB } from "../../db/client";
import { ProjectModel } from "../../db/models/project.model";
import { CodebaseKbModel } from "../../db/models/codebase-kb.model";
import { ensureFreshProjectKb, syncProjectKb } from "./sync-project-kb";

// Integration test — requires local Mongo + git. Proves auto-sync: a project KB
// re-syncs when the repo changed, and is left alone when it hasn't.
const ex = promisify(execFile);
const ME = "test_user_autosync";
let repo = "";
const PID = "proj_autosync";

async function commitAll(msg: string) {
  await ex("git", ["-C", repo, "add", "-A"]);
  await ex("git", ["-C", repo, "commit", "-m", msg]);
}

beforeAll(async () => {
  delete process.env.MCP_CONTEXT_URL;
  delete process.env.ORCH_KB_EMBEDDINGS; // pure lexical — no LLM dependency in this test
  delete process.env.ORCH_KB_AUTOSYNC;
  await connectDB();
  await ProjectModel.deleteMany({ ownerId: ME });
  await CodebaseKbModel.deleteMany({ ownerId: ME });
  repo = await mkdtemp(path.join(os.tmpdir(), "autosync-"));
  await mkdir(path.join(repo, "src"), { recursive: true });
  await writeFile(path.join(repo, "src/a.ts"), "export function alpha(){}", "utf8");
  await ex("git", ["-C", repo, "init"]);
  await ex("git", ["-C", repo, "config", "user.email", "t@t.co"]);
  await ex("git", ["-C", repo, "config", "user.name", "t"]);
  await commitAll("init");
  await ProjectModel.create({ ownerId: ME, projectId: PID, name: "AutoSync", rootRepoPath: repo });
});

afterEach(() => {
  delete process.env.ORCH_KB_AUTOSYNC;
});

afterAll(async () => {
  await ProjectModel.deleteMany({ ownerId: ME });
  await CodebaseKbModel.deleteMany({ ownerId: ME });
  if (repo) await rm(repo, { recursive: true, force: true });
  await disconnectDB();
});

describe("auto-sync (ensureFreshProjectKb)", () => {
  it("first call syncs (no KB yet), then no-ops when the repo is unchanged", async () => {
    const first = await ensureFreshProjectKb(ME, PID);
    expect(first.resynced).toBe(true);
    const kb1 = await CodebaseKbModel.findOne({ ownerId: ME, projectId: PID }).lean();
    expect(kb1?.symbols?.some((s) => s.startsWith("alpha"))).toBe(true);
    expect(kb1?.repoSignature).toBeTruthy();

    const second = await ensureFreshProjectKb(ME, PID);
    expect(second.resynced).toBe(false); // unchanged repo → no resync
  });

  it("re-syncs after the repo changes (new committed symbol shows up)", async () => {
    await writeFile(path.join(repo, "src/b.ts"), "export function bravo(){}", "utf8");
    await commitAll("add bravo");

    const r = await ensureFreshProjectKb(ME, PID);
    expect(r.resynced).toBe(true);
    const kb = await CodebaseKbModel.findOne({ ownerId: ME, projectId: PID }).lean();
    expect(kb?.symbols?.some((s) => s.startsWith("bravo"))).toBe(true); // new code captured
  });

  it("respects ORCH_KB_AUTOSYNC=false (skips)", async () => {
    process.env.ORCH_KB_AUTOSYNC = "false";
    await writeFile(path.join(repo, "src/c.ts"), "export function charlie(){}", "utf8");
    await commitAll("add charlie");
    const r = await ensureFreshProjectKb(ME, PID);
    expect(r.resynced).toBe(false); // gated off → no resync even though the repo changed
  });

  it("syncProjectKb returns null for an unknown project", async () => {
    expect(await syncProjectKb({ ownerId: ME, projectId: "nope" })).toBeNull();
  });
});
