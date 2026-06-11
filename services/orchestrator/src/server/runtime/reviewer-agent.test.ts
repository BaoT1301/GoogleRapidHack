import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildReviewerAgentConfig,
  materializeReviewerAgent,
  REVIEWER_AGENT_NAME,
  REVIEWER_AGENT_TOOLS,
  REVIEWER_PERSONA,
  REVIEWER_TRUST_TOOLS,
} from "./reviewer-agent";
import { kiroAdapter } from "./cli-adapters/kiro";

const tmpDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function tmpRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reviewer-agent-"));
  tmpDirs.push(dir);
  return dir;
}

const WRITE_TOOLS = ["write", "shell", "fs_write", "execute_bash", "aws"];

describe("buildReviewerAgentConfig (read-only auditor)", () => {
  it("establishes the integration_reviewer identity + verdict contract", () => {
    const cfg = buildReviewerAgentConfig();
    expect(cfg.name).toBe(REVIEWER_AGENT_NAME);
    expect(cfg.prompt).toContain(REVIEWER_PERSONA);
    expect(cfg.prompt.toUpperCase()).toContain("READ ONLY");
    expect(cfg.prompt.toLowerCase()).toContain("do not refuse");
    expect(cfg.prompt).toContain('"verdict"');
    expect(cfg.includeMcpJson).toBe(true);
  });

  it("is READ-ONLY: no write/shell tool in tools or allowedTools", () => {
    const cfg = buildReviewerAgentConfig();
    expect(cfg.tools).toEqual([...REVIEWER_AGENT_TOOLS]);
    expect(cfg.allowedTools).toEqual(cfg.tools);
    for (const wt of WRITE_TOOLS) {
      expect(cfg.tools).not.toContain(wt);
      expect(cfg.allowedTools).not.toContain(wt);
    }
    expect(cfg.tools).toContain("read");
    expect(cfg.tools).toContain("@mcp-context-manager");
  });

  it("pins the read-only trust-tools constant", () => {
    expect(REVIEWER_TRUST_TOOLS).toBe("fs_read");
  });
});

describe("kiro adapter seam — reviewer spawn is read-only + agent-locked", () => {
  it("emits --trust-tools=fs_read and --agent=orch-reviewer, never fs_write", () => {
    const cmd = kiroAdapter.buildCommand({
      prompt: "audit this",
      nodeId: "rv",
      worktreePath: "/tmp/wt",
      trustTools: REVIEWER_TRUST_TOOLS,
      agent: REVIEWER_AGENT_NAME,
    });
    expect(cmd.command).toBe("kiro-cli");
    expect(cmd.args).toContain("--trust-tools=fs_read");
    expect(cmd.args).toContain(`--agent=${REVIEWER_AGENT_NAME}`);
    expect(cmd.args.join(" ")).not.toContain("fs_write");
  });
});

describe("materializeReviewerAgent", () => {
  it("writes a read-only orch-reviewer.json to <cwd>/.kiro/agents/", async () => {
    const cwd = await tmpRepo();
    const result = await materializeReviewerAgent({ cwd });
    expect(result.agentConfigPath).toBe(
      path.join(cwd, ".kiro", "agents", `${REVIEWER_AGENT_NAME}.json`),
    );
    const written = JSON.parse(await readFile(result.agentConfigPath, "utf8"));
    expect(written.name).toBe(REVIEWER_AGENT_NAME);
    expect(written.tools.join(" ")).not.toContain("write");
    expect(written.tools.join(" ")).not.toContain("shell");
    expect(written.allowedTools).toEqual(written.tools);
  });

  it("is idempotent (byte-identical on a second run)", async () => {
    const cwd = await tmpRepo();
    const a = await readFile((await materializeReviewerAgent({ cwd })).agentConfigPath, "utf8");
    const b = await readFile((await materializeReviewerAgent({ cwd })).agentConfigPath, "utf8");
    expect(b).toBe(a);
  });
});
