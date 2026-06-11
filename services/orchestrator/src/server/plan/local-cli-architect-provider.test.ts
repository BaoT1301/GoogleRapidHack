import { describe, expect, it, vi } from "vitest";
import {
  LocalCliArchitectProvider,
  PLANNER_READONLY_TOOLS,
  type PlannerAgent,
} from "./local-cli-architect-provider";
import {
  buildPlannerPrompt,
  extractPlanJson,
  PLAN_SENTINEL_CLOSE,
  PLAN_SENTINEL_OPEN,
} from "./planner-prompt";
import { parsePlanResult } from "./schemas";
import { PLANNER_AGENT_NAME } from "../runtime/planner-agent";
import type { CliCapability } from "../runtime/cli-capabilities";
import type { PlannerProcessResult, PlannerSpawn } from "./types";

const AVAILABLE: CliCapability = {
  available: true,
  command: "kiro-cli",
  authMode: "host-login",
  note: "Signed in via host login.",
};

function sentinelWrap(json: string): string {
  return `Thinking about the repo...\n${PLAN_SENTINEL_OPEN}\n${json}\n${PLAN_SENTINEL_CLOSE}\nDone.`;
}
function fencedWrap(json: string): string {
  return `Here is the plan:\n\n\`\`\`json\n${json}\n\`\`\`\n\nLet me know!`;
}
function bareWrap(json: string): string {
  return `Sure — the plan is:\n${json}\nThat covers it.`;
}

function out(stdout: string): PlannerProcessResult {
  return { exitCode: 0, stdoutText: stdout, stderrText: "", cancelled: false };
}

const VALID_GRAPH_SPEC = JSON.stringify({
  type: "graph_spec",
  version: "1.0",
  featureName: "Add search",
  sprintNumber: 1,
  tracks: [
    { id: "t1", number: 1, execution: "SEQUENTIAL", persona: "backend_engineer", name: "API", status: "PENDING", overview: "build it", checklist: ["do x"], dependsOn: [] },
    { id: "t2", number: 2, execution: "SEQUENTIAL", persona: "integration_reviewer", name: "Review", overview: "", checklist: ["verify"], dependsOn: ["t1"] },
    { id: "t3", number: 3, execution: "SEQUENTIAL", persona: "knowledge_manager", name: "Docs", checklist: ["sync"], dependsOn: ["t2"] },
  ],
  missingContext: [],
});

const VALID_CONTEXT_REQUEST = JSON.stringify({
  type: "context_request",
  confidence: 0.4,
  readyToPlan: false,
  codebaseImpact: "touches the plan router",
  approaches: [{ name: "A", pros: ["fast"], cons: ["risky"] }],
  questions: [{ id: "q1", text: "Cloud or local?" }],
  missingContext: ["auth model"],
});

const NOOP_AGENT: PlannerAgent = {
  agentName: PLANNER_AGENT_NAME,
  agentConfigPath: "/repo/.kiro/agents/orch-planner.json",
  notes: [],
};

function provider(spawn: PlannerSpawn, cap: CliCapability = AVAILABLE) {
  return new LocalCliArchitectProvider({
    spawn,
    checkCapability: async () => cap,
    resolveCwd: () => "/repo",
    // Deterministic, no real FS writes in unit tests.
    materializeMcp: async () => ({ mcpConfigPath: undefined, servers: [], notes: [] }),
    materializeAgent: async () => NOOP_AGENT,
  });
}

describe("planner-prompt: lenient extractPlanJson (PLANFIX-2)", () => {
  it("extracts the LAST sentinel pair", () => {
    const text = `${sentinelWrap('{"a":1}')}\n${sentinelWrap('{"b":2}')}`;
    expect(extractPlanJson(text)).toBe('{"b":2}');
  });

  it("extracts a fenced ```json block when there is no sentinel", () => {
    expect(extractPlanJson(fencedWrap('{"c":3}'))).toBe('{"c":3}');
  });

  it("extracts the last balanced bare top-level object when there is no sentinel/fence", () => {
    expect(extractPlanJson(bareWrap('{"d":4}'))).toBe('{"d":4}');
  });

  it("ignores braces inside JSON strings when scanning bare objects", () => {
    const json = '{"text":"a } looks like a close brace","ok":true}';
    expect(extractPlanJson(`prose ${json} more prose`)).toBe(json);
  });

  it("returns null when there is no JSON at all", () => {
    expect(extractPlanJson("no markers, no json here")).toBeNull();
  });
});

describe("buildPlannerPrompt: lean user message, NO persona impersonation", () => {
  it("switches mode on `approved` and never impersonates the persona", () => {
    const ctx = buildPlannerPrompt({ prompt: "x", messages: [], approved: false });
    expect(ctx).toContain("context_request");
    expect(ctx).toContain(PLAN_SENTINEL_OPEN);
    // The persona lives in the AGENT system prompt — the user message must not
    // say "you are product_architect" (that tripped the injection refusal).
    expect(ctx.toLowerCase()).not.toContain("you are");
    expect(ctx.toLowerCase()).not.toContain("product_architect");

    const spec = buildPlannerPrompt({ prompt: "x", messages: [], approved: true });
    expect(spec).toContain("graph_spec");
    expect(spec.toLowerCase()).not.toContain("product_architect");
  });
});

describe("parsePlanResult (zod contract — unchanged)", () => {
  it("accepts a valid GraphSpec and ContextRequest", () => {
    expect(parsePlanResult(VALID_GRAPH_SPEC)).toMatchObject({ ok: true });
    expect(parsePlanResult(VALID_CONTEXT_REQUEST)).toMatchObject({ ok: true });
  });
  it("rejects invalid JSON and off-contract objects", () => {
    expect(parsePlanResult("{not json")).toMatchObject({ ok: false });
    expect(parsePlanResult('{"type":"nope"}')).toMatchObject({ ok: false });
    expect(parsePlanResult('{"type":"graph_spec","featureName":"x","tracks":[]}')).toMatchObject({ ok: false });
  });
});

describe("LocalCliArchitectProvider.generate (lenient parse + agent)", () => {
  it("sentinel block → typed GraphSpec", async () => {
    const spawn = vi.fn<PlannerSpawn>().mockResolvedValue(out(sentinelWrap(VALID_GRAPH_SPEC)));
    const res = (await provider(spawn).generate({ prompt: "build search", messages: [], approved: true })) as { type: string };
    expect(res.type).toBe("graph_spec");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("sentinel block → typed ContextRequest (Socratic, approved=false)", async () => {
    const spawn = vi.fn<PlannerSpawn>().mockResolvedValue(out(sentinelWrap(VALID_CONTEXT_REQUEST)));
    const res = (await provider(spawn).generate({ prompt: "build search", messages: [], approved: false })) as { type: string };
    expect(res.type).toBe("context_request");
  });

  it("fenced ```json (no sentinel) → typed GraphSpec", async () => {
    const spawn = vi.fn<PlannerSpawn>().mockResolvedValue(out(fencedWrap(VALID_GRAPH_SPEC)));
    const res = (await provider(spawn).generate({ prompt: "x", messages: [], approved: true })) as { type: string };
    expect(res.type).toBe("graph_spec");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("bare top-level object (no sentinel/fence) → typed ContextRequest", async () => {
    const spawn = vi.fn<PlannerSpawn>().mockResolvedValue(out(bareWrap(VALID_CONTEXT_REQUEST)));
    const res = (await provider(spawn).generate({ prompt: "x", messages: [], approved: false })) as { type: string };
    expect(res.type).toBe("context_request");
  });

  it("malformed → retry once → success", async () => {
    const spawn = vi
      .fn<PlannerSpawn>()
      .mockResolvedValueOnce(out("garbage with no json"))
      .mockResolvedValueOnce(out(sentinelWrap(VALID_GRAPH_SPEC)));
    const res = (await provider(spawn).generate({ prompt: "x", messages: [], approved: true })) as { type: string };
    expect(res.type).toBe("graph_spec");
    expect(spawn).toHaveBeenCalledTimes(2);
    // the retry prompt carries the reminder
    expect(spawn.mock.calls[1][0].args.at(-1)).toContain("could not be parsed");
  });

  it("still no plan after retry → HONEST LOCAL error (names the local planner, not the Architect API)", async () => {
    const spawn = vi.fn<PlannerSpawn>().mockResolvedValue(out("never any json"));
    const err = await provider(spawn)
      .generate({ prompt: "x", messages: [], approved: true })
      .then(() => null)
      .catch((e) => e as { code: string; message: string });
    expect(err?.code).toBe("INTERNAL_SERVER_ERROR");
    expect(err?.message).toMatch(/local planner/i);
    expect(err?.message).not.toMatch(/Architect API/i);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("kiro unavailable → PRECONDITION_FAILED with the fix hint, never spawns", async () => {
    const spawn = vi.fn<PlannerSpawn>();
    const cap: CliCapability = {
      available: false,
      command: "kiro-cli",
      authMode: "unauthenticated",
      note: "kiro-cli is installed but not signed in.",
      suggestedFix: "Run `kiro-cli login`",
    };
    await expect(
      provider(spawn, cap).generate({ prompt: "x", messages: [], approved: true }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns under --agent=orch-planner, READ-ONLY, with NO persona impersonation in the user message", async () => {
    const spawn = vi.fn<PlannerSpawn>().mockResolvedValue(out(sentinelWrap(VALID_GRAPH_SPEC)));
    await provider(spawn).generate({ prompt: "x", messages: [], approved: true });
    const cmd = spawn.mock.calls[0][0];
    expect(cmd.command).toBe("kiro-cli");
    // Agent flag present (defeats the injection refusal).
    expect(cmd.args).toContain(`--agent=${PLANNER_AGENT_NAME}`);
    // Read-only trust tools; never a write tool.
    expect(cmd.args).toContain(`--trust-tools=${PLANNER_READONLY_TOOLS}`);
    expect(cmd.args.join(" ")).not.toContain("fs_write");
    expect(cmd.cwd).toBe("/repo");
    // The user message (last arg) carries the feature request only — no persona text.
    const userMsg = cmd.args.at(-1) ?? "";
    expect(userMsg.toLowerCase()).not.toContain("you are product_architect");
    expect(userMsg.toLowerCase()).not.toContain("product_architect");
  });

  it("materializes the read-only agent at the cwd", async () => {
    const spawn = vi.fn<PlannerSpawn>().mockResolvedValue(out(sentinelWrap(VALID_GRAPH_SPEC)));
    const materializeAgent = vi.fn(async () => NOOP_AGENT);
    const p = new LocalCliArchitectProvider({
      spawn,
      checkCapability: async () => AVAILABLE,
      resolveCwd: () => "/repo",
      materializeMcp: async () => ({ mcpConfigPath: undefined, servers: [], notes: [] }),
      materializeAgent,
    });
    await p.generate({ prompt: "x", messages: [], approved: true });
    expect(materializeAgent).toHaveBeenCalledWith("/repo");
  });

  it("PLAN-8b: materializes MCP at the cwd and requires MCP startup (codebase-aware)", async () => {
    const spawn = vi.fn<PlannerSpawn>().mockResolvedValue(out(sentinelWrap(VALID_GRAPH_SPEC)));
    const materializeMcp = vi.fn(async (cwd: string) => ({
      mcpConfigPath: `${cwd}/.kiro/settings/mcp.json`,
      servers: ["mcp-context-manager", "mongodb"],
      notes: [],
    }));
    const p = new LocalCliArchitectProvider({
      spawn,
      checkCapability: async () => AVAILABLE,
      resolveCwd: () => "/repo",
      materializeMcp,
      materializeAgent: async () => NOOP_AGENT,
    });
    await p.generate({ prompt: "x", messages: [], approved: true });
    expect(materializeMcp).toHaveBeenCalledWith("/repo");
    const cmd = spawn.mock.calls[0][0];
    expect(cmd.args).toContain("--require-mcp-startup");
    expect(cmd.args).toContain(`--agent=${PLANNER_AGENT_NAME}`);
    expect(cmd.args.join(" ")).not.toContain("fs_write");
  });

  it("PLAN-8b: a failed MCP materialization is best-effort (planner still runs, no --require-mcp-startup)", async () => {
    const spawn = vi.fn<PlannerSpawn>().mockResolvedValue(out(sentinelWrap(VALID_GRAPH_SPEC)));
    const p = new LocalCliArchitectProvider({
      spawn,
      checkCapability: async () => AVAILABLE,
      resolveCwd: () => "/repo",
      materializeMcp: async () => ({ mcpConfigPath: undefined, servers: [], notes: ["MCP config not materialized: EROFS"] }),
      materializeAgent: async () => NOOP_AGENT,
    });
    const res = (await p.generate({ prompt: "x", messages: [], approved: true })) as { type: string };
    expect(res.type).toBe("graph_spec");
    expect(spawn.mock.calls[0][0].args).not.toContain("--require-mcp-startup");
  });
});

describe("LocalCliArchitectProvider.health", () => {
  it("reports ready / not_signed_in / not_installed from the capability", async () => {
    const ready = await provider(vi.fn<PlannerSpawn>()).health();
    expect(ready).toMatchObject({ provider: "local", available: true, status: "ready" });

    const notInstalled = await provider(vi.fn<PlannerSpawn>(), {
      available: false,
      command: "kiro-cli",
      authMode: "unauthenticated",
      note: "Kiro CLI not found",
    }).health();
    expect(notInstalled).toMatchObject({ status: "not_installed" });

    const notSignedIn = await provider(vi.fn<PlannerSpawn>(), {
      available: false,
      command: "kiro-cli",
      authMode: "unauthenticated",
      note: "kiro-cli is installed but not signed in.",
    }).health();
    expect(notSignedIn).toMatchObject({ status: "not_signed_in" });
  });
});
