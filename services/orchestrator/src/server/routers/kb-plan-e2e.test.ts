import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "../init";
import { appRouter } from "./app";
import { connectDB, disconnectDB } from "../../db/client";
import { ProjectModel } from "../../db/models/project.model";
import { CodebaseKbModel } from "../../db/models/codebase-kb.model";

// Integration test — requires a local Mongo (docker compose ... mongo). Exercises
// the full Cloud Infra pipeline: create project → sync repo KB to the DB
// (Clerk-scoped = "through auth") → plan.generate(projectId) reads the synced KB
// from the DB and bakes it into the Architect request.
const createCaller = createCallerFactory(appRouter);
const ME = "test_user_kb_e2e";
const me = createCaller({ userId: ME});

const tempRoots: string[] = [];

async function makeRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "kb-e2e-"));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return root;
}

beforeAll(async () => {
  // This e2e verifies the ONE-SHOT cloud path (synced KB → /api/v1/plan request).
  // The agentic path (→ /api/v1/generate) has its own tests; pin it off here.
  process.env.ORCH_PLAN_AGENTIC = "false";
  await connectDB();
  await ProjectModel.deleteMany({ ownerId: ME });
  await CodebaseKbModel.deleteMany({ ownerId: ME });
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  delete process.env.ORCH_PLAN_AGENTIC;
  await ProjectModel.deleteMany({ ownerId: ME });
  await CodebaseKbModel.deleteMany({ ownerId: ME });
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
  await disconnectDB();
});

describe("KB sync → DB → planning pipeline (P1 + P3)", () => {
  it("throws a repo at kb.sync, persists context to the DB, and the plan reasons from it", async () => {
    // Deterministic: force the local file-scan path (no live mcp-context-manager).
    delete process.env.MCP_CONTEXT_URL;

    const repo = await makeRepo({
      "package.json": JSON.stringify({ name: "e2e-demo", description: "pipeline repo" }),
      "src/auth.ts": "export function authenticateUser(token: string) { return token; }",
      "src/billing.ts": "export class BillingService { charge() {} }",
    });

    // 1) Create the project (owner-scoped, server-generated projectId).
    const project = await me.projects.create({ name: "E2E Demo", rootRepoPath: repo });
    expect(project.projectId).toBeTruthy();
    const projectId = project.projectId;

    // 2) Sync the repo's codebase KB into the DB ("through auth" = Clerk-scoped).
    const sync = await me.kb.sync({ projectId });
    expect(sync.source).toBe("repo-scan");
    expect(sync.fileCount).toBeGreaterThan(0);
    expect(sync.symbolCount).toBeGreaterThan(0);

    // 3) Read it back — it really landed in the DB, scoped to this owner/project.
    const stored = await me.kb.get({ projectId });
    expect(stored).not.toBeNull();
    expect(stored?.files).toEqual(
      expect.arrayContaining(["src/auth.ts", "src/billing.ts"]),
    );
    expect(stored?.symbols?.some((s) => s.startsWith("authenticateUser"))).toBe(true);

    // 3b) query_codebase (P4): the retrieval tool returns only the relevant slice.
    const hits = await me.kb.query({ projectId, query: "authenticate auth" });
    expect(hits.found).toBe(true);
    expect(hits.symbols.some((s) => s.startsWith("authenticateUser"))).toBe(true);
    expect(hits.symbols.some((s) => s.startsWith("BillingService"))).toBe(false);

    // 4) Plan WITH the projectId → the planner loads the synced KB from the DB and
    //    bakes it into the Architect request. Mock the Cloud Architect transport
    //    and assert the request body carries the synced context.
    process.env.LLM_API_URL = "http://llm.test";
    process.env.LLM_SERVICE_TOKEN = "tok_e2e";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ type: "graph_spec", version: "1.0", featureName: "demo", tracks: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await me.plan.generate({ prompt: "add 2FA to auth", projectId, provider: "cloud" });

    const [, init] = fetchSpy.mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    // The plan request reasons from the DB-synced codebase context.
    expect(sent.codebaseContext).toBeDefined();
    expect(sent.codebaseContext.files).toEqual(
      expect.arrayContaining(["src/auth.ts", "src/billing.ts"]),
    );
    expect(
      sent.codebaseContext.symbols.some((s: string) => s.startsWith("authenticateUser")),
    ).toBe(true);
  });

  it("isolates KB by owner — another user cannot read this project's KB", async () => {
    const other = createCaller({ userId: "test_user_kb_e2e_other"});
    const project = await me.projects.create({ name: "Private", rootRepoPath: process.cwd() });
    await me.kb.sync({ projectId: project.projectId });
    // The other user does not own the project → NOT_FOUND on sync, null on get.
    await expect(other.kb.get({ projectId: project.projectId })).resolves.toBeNull();
    await expect(other.kb.sync({ projectId: project.projectId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
