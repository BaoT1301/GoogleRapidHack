import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPlannerAgentConfig,
  materializePlannerAgent,
  PLANNER_AGENT_NAME,
  PLANNER_AGENT_TOOLS,
} from "./planner-agent";

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tmpRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "planner-agent-"));
  tmpDirs.push(dir);
  return dir;
}

const WRITE_TOOLS = ["write", "shell", "fs_write", "execute_bash", "aws"];

describe("buildPlannerAgentConfig (pure shape)", () => {
  it("has a non-empty trusted prompt establishing the planner identity + contract", () => {
    const cfg = buildPlannerAgentConfig();
    expect(cfg.name).toBe(PLANNER_AGENT_NAME);
    expect(cfg.prompt.length).toBeGreaterThan(0);
    expect(cfg.prompt).toContain("product_architect");
    // Defeats the injection refusal from inside the TRUSTED system prompt.
    expect(cfg.prompt.toLowerCase()).toContain("do not refuse");
    // Questions must go inside the JSON array (not asked conversationally).
    expect(cfg.prompt).toContain("questions[]");
    // Sentinel-preferred output protocol.
    expect(cfg.prompt).toContain("<!-- orch:plan -->");
    expect(cfg.prompt).toContain("<!-- /orch:plan -->");
    // Both modes documented.
    expect(cfg.prompt).toContain("context_request");
    expect(cfg.prompt).toContain("graph_spec");
  });

  it("is READ-ONLY: tools + allowedTools contain no write/shell tool", () => {
    const cfg = buildPlannerAgentConfig();
    expect(cfg.tools).toEqual([...PLANNER_AGENT_TOOLS]);
    // allowedTools auto-approves the SAME read-only set (no escalation).
    expect(cfg.allowedTools).toEqual(cfg.tools);
    for (const wt of WRITE_TOOLS) {
      expect(cfg.tools).not.toContain(wt);
      expect(cfg.allowedTools).not.toContain(wt);
    }
    // Read + read-only MCP analysis present.
    expect(cfg.tools).toContain("read");
    expect(cfg.tools).toContain("@mcp-context-manager");
    // Auto-includes the workspace MCP config (codebase-aware).
    expect(cfg.includeMcpJson).toBe(true);
  });
});

describe("materializePlannerAgent (workspace agent discovery path)", () => {
  it("writes a valid, read-only agent JSON to <cwd>/.kiro/agents/orch-planner.json", async () => {
    const cwd = await tmpRepo();
    const result = await materializePlannerAgent({ cwd });

    expect(result.agentName).toBe(PLANNER_AGENT_NAME);
    expect(result.agentConfigPath).toBe(
      path.join(cwd, ".kiro", "agents", `${PLANNER_AGENT_NAME}.json`),
    );

    const written = JSON.parse(await readFile(result.agentConfigPath, "utf8"));
    expect(written.name).toBe(PLANNER_AGENT_NAME);
    expect(typeof written.prompt).toBe("string");
    expect(written.prompt.length).toBeGreaterThan(0);
    expect(written.includeMcpJson).toBe(true);
    // Read-only invariant on the materialized file.
    expect(written.tools.join(" ")).not.toContain("write");
    expect(written.tools.join(" ")).not.toContain("shell");
    expect(written.allowedTools).toEqual(written.tools);
  });

  it("is idempotent: a second run yields byte-identical config", async () => {
    const cwd = await tmpRepo();
    const first = await materializePlannerAgent({ cwd });
    const a = await readFile(first.agentConfigPath, "utf8");
    const second = await materializePlannerAgent({ cwd });
    const b = await readFile(second.agentConfigPath, "utf8");
    expect(b).toBe(a);
    expect(second.agentConfigPath).toBe(first.agentConfigPath);
  });

  it("is NON-DESTRUCTIVE: never touches the user's other agents", async () => {
    const cwd = await tmpRepo();
    const agentsDir = path.join(cwd, ".kiro", "agents");
    await mkdir(agentsDir, { recursive: true });
    const userAgent = path.join(agentsDir, "my-custom-agent.json");
    await writeFile(userAgent, JSON.stringify({ name: "my-custom-agent", prompt: "keep me" }), "utf8");

    await materializePlannerAgent({ cwd });

    // The user's agent is untouched, and ours exists alongside it.
    const preserved = JSON.parse(await readFile(userAgent, "utf8"));
    expect(preserved).toEqual({ name: "my-custom-agent", prompt: "keep me" });
    const ours = JSON.parse(
      await readFile(path.join(agentsDir, `${PLANNER_AGENT_NAME}.json`), "utf8"),
    );
    expect(ours.name).toBe(PLANNER_AGENT_NAME);
  });
});
