import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDocAgentConfig,
  materializeDocAgent,
  DOC_AGENT_NAME,
  DOC_AGENT_TOOLS,
  DOC_PERSONA,
  DOC_TRUST_TOOLS,
} from "./doc-agent";
import { kiroAdapter } from "./cli-adapters/kiro";

const tmpDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function tmpRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "doc-agent-"));
  tmpDirs.push(dir);
  return dir;
}

describe("buildDocAgentConfig (doc-scoped writer)", () => {
  it("establishes the knowledge_manager identity + the hard doc write-scope", () => {
    const cfg = buildDocAgentConfig();
    expect(cfg.name).toBe(DOC_AGENT_NAME);
    expect(cfg.prompt).toContain(DOC_PERSONA);
    expect(cfg.prompt).toContain(".claude/**");
    expect(cfg.prompt).toContain("*.md");
    expect(cfg.prompt.toLowerCase()).toContain("do not refuse");
    expect(cfg.includeMcpJson).toBe(true);
  });

  it("grants write (docs) + read, but NEVER shell/execute_bash", () => {
    const cfg = buildDocAgentConfig();
    expect(cfg.tools).toEqual([...DOC_AGENT_TOOLS]);
    expect(cfg.allowedTools).toEqual(cfg.tools);
    expect(cfg.tools).toContain("write");
    expect(cfg.tools).toContain("read");
    expect(cfg.tools).not.toContain("shell");
    expect(cfg.tools).not.toContain("execute_bash");
  });

  it("pins the read+write trust-tools constant", () => {
    expect(DOC_TRUST_TOOLS).toBe("fs_read,fs_write");
  });
});

describe("kiro adapter seam — doc spawn is agent-locked with write trust", () => {
  it("emits --trust-tools=fs_read,fs_write and --agent=orch-doc", () => {
    const cmd = kiroAdapter.buildCommand({
      prompt: "update docs",
      nodeId: "dc",
      worktreePath: "/tmp/wt",
      trustTools: DOC_TRUST_TOOLS,
      agent: DOC_AGENT_NAME,
    });
    expect(cmd.args).toContain("--trust-tools=fs_read,fs_write");
    expect(cmd.args).toContain(`--agent=${DOC_AGENT_NAME}`);
  });
});

describe("materializeDocAgent", () => {
  it("writes orch-doc.json to <cwd>/.kiro/agents/ (write but no shell)", async () => {
    const cwd = await tmpRepo();
    const result = await materializeDocAgent({ cwd });
    const written = JSON.parse(await readFile(result.agentConfigPath, "utf8"));
    expect(written.name).toBe(DOC_AGENT_NAME);
    expect(written.tools).toContain("write");
    expect(written.tools.join(" ")).not.toContain("shell");
  });
});
