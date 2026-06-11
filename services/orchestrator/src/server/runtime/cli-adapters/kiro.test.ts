import { afterEach, describe, expect, it } from "vitest";
import { kiroAdapter } from "./kiro";

const KEYS = ["KIRO_REQUIRE_MCP_STARTUP", "KIRO_TRUST_TOOLS"] as const;
const saved: Record<string, string | undefined> = {};

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function snapshotEnv() {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
}

describe("kiroAdapter MCP consumption (MCP-1)", () => {
  it("requires MCP startup when a per-run config was materialized", () => {
    snapshotEnv();
    const cmd = kiroAdapter.buildCommand({
      prompt: "do it",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
      mcpConfigPath: "/tmp/wt/.kiro/settings/mcp.json",
    });
    expect(cmd.command).toBe("kiro-cli");
    expect(cmd.args).toContain("--require-mcp-startup");
    expect(cmd.args.at(-1)).toBe("do it");
  });

  it("can be opted out with KIRO_REQUIRE_MCP_STARTUP=false even with a config", () => {
    snapshotEnv();
    process.env.KIRO_REQUIRE_MCP_STARTUP = "false";
    const cmd = kiroAdapter.buildCommand({
      prompt: "p",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
      mcpConfigPath: "/tmp/wt/.kiro/settings/mcp.json",
    });
    expect(cmd.args).not.toContain("--require-mcp-startup");
  });

  it("requireMcpStartup=true forces the flag even without a config (explicit policy)", () => {
    snapshotEnv();
    const cmd = kiroAdapter.buildCommand({
      prompt: "p",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
      requireMcpStartup: true,
    });
    expect(cmd.args).toContain("--require-mcp-startup");
  });

  it("requireMcpStartup=false suppresses the flag even when a config was materialized", () => {
    snapshotEnv();
    const cmd = kiroAdapter.buildCommand({
      prompt: "p",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
      mcpConfigPath: "/tmp/wt/.kiro/settings/mcp.json",
      requireMcpStartup: false,
    });
    expect(cmd.args).not.toContain("--require-mcp-startup");
  });
});

describe("kiroAdapter model flag (MODEL-1)", () => {
  it("emits --model=<m> when a model is resolved for the node", () => {
    snapshotEnv();
    const cmd = kiroAdapter.buildCommand({
      prompt: "p",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
      model: "claude-sonnet-4",
    });
    expect(cmd.args).toContain("--model=claude-sonnet-4");
    expect(cmd.args.at(-1)).toBe("p");
  });

  it("omits the model flag when no model is provided", () => {
    snapshotEnv();
    const cmd = kiroAdapter.buildCommand({
      prompt: "p",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
    });
    expect(cmd.args.join(" ")).not.toContain("--model");
  });

  it("rejects a model id with shell metacharacters", () => {
    snapshotEnv();
    expect(() =>
      kiroAdapter.buildCommand({
        prompt: "p",
        nodeId: "n1",
        worktreePath: "/tmp/wt",
        model: "evil; rm -rf /",
      }),
    ).toThrow(/invalid model id/i);
  });
});

describe("kiroAdapter command shape (CLI-1)", () => {
  it("builds `kiro-cli chat --no-interactive --trust-tools=fs_read <prompt>` by default (read-only)", () => {
    snapshotEnv();
    const cmd = kiroAdapter.buildCommand({
      prompt: "edit the file",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
    });
    expect(cmd.command).toBe("kiro-cli");
    expect(cmd.args[0]).toBe("chat");
    expect(cmd.args).toContain("--no-interactive");
    expect(cmd.args).toContain("--trust-tools=fs_read"); // read-only default (fs_read is the real tool name)
    expect(cmd.cwd).toBe("/tmp/wt");
    expect(cmd.args.at(-1)).toBe("edit the file");
  });

  it("write tools are opt-in via KIRO_TRUST_TOOLS", () => {
    snapshotEnv();
    process.env.KIRO_TRUST_TOOLS = "fs_read,fs_write";
    const cmd = kiroAdapter.buildCommand({
      prompt: "p",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
    });
    expect(cmd.args).toContain("--trust-tools=fs_read,fs_write");
  });
});

describe("kiroAdapter agent flag (PLANFIX-2)", () => {
  it("emits --agent=<name> when input.agent is provided (planner)", () => {
    snapshotEnv();
    const cmd = kiroAdapter.buildCommand({
      prompt: "plan it",
      nodeId: "architect",
      worktreePath: "/repo",
      agent: "orch-planner",
      trustTools: "fs_read",
    });
    expect(cmd.args).toContain("--agent=orch-planner");
    // Still read-only; prompt remains the last arg.
    expect(cmd.args).toContain("--trust-tools=fs_read");
    expect(cmd.args.join(" ")).not.toContain("fs_write");
    expect(cmd.args.at(-1)).toBe("plan it");
  });

  it("omits --agent when no agent is provided (execute nodes → default agent)", () => {
    snapshotEnv();
    const cmd = kiroAdapter.buildCommand({
      prompt: "p",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
    });
    expect(cmd.args.join(" ")).not.toContain("--agent");
  });
});

describe("kiroAdapter allowed-tools mapping (CLI-4)", () => {
  it("an execute node's configured allowedTools map to --trust-tools (writes opt-in)", () => {
    snapshotEnv();
    const cmd = kiroAdapter.buildCommand({
      prompt: "edit files",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
      trustTools: "fs_read,fs_write,execute_bash",
    });
    expect(cmd.args).toContain("--trust-tools=fs_read,fs_write,execute_bash");
  });

  it("input.trustTools (UI-configured) wins over the KIRO_TRUST_TOOLS env", () => {
    snapshotEnv();
    process.env.KIRO_TRUST_TOOLS = "fs_read,fs_write";
    const cmd = kiroAdapter.buildCommand({
      prompt: "p",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
      trustTools: "fs_read", // explicit read-only pin
    });
    expect(cmd.args).toContain("--trust-tools=fs_read");
    expect(cmd.args.join(" ")).not.toContain("fs_write");
  });

  it("defaults to read-only fs_read when neither input nor env is set (never trust-all)", () => {
    snapshotEnv();
    const cmd = kiroAdapter.buildCommand({
      prompt: "p",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
    });
    expect(cmd.args).toContain("--trust-tools=fs_read");
    expect(cmd.args.join(" ")).not.toContain("fs_write");
  });
});

describe("kiroAdapter input safety and sanitization", () => {
  it("throws if worktreePath is missing or not a string", () => {
    expect(() =>
      kiroAdapter.buildCommand({
        prompt: "do something",
        nodeId: "n1",
        worktreePath: "" as any,
      })
    ).toThrow(/worktreePath is required/i);
  });

  it("throws if prompt is missing or empty", () => {
    expect(() =>
      kiroAdapter.buildCommand({
        prompt: "   ",
        nodeId: "n1",
        worktreePath: "/tmp/wt",
      })
    ).toThrow(/prompt is required/i);
  });

  it("throws if agent contains invalid characters", () => {
    expect(() =>
      kiroAdapter.buildCommand({
        prompt: "do something",
        nodeId: "n1",
        worktreePath: "/tmp/wt",
        agent: "invalid agent name; --dangerous-flag",
      })
    ).toThrow(/invalid agent name/i);
  });

  it("accepts valid agent name characters", () => {
    const cmd = kiroAdapter.buildCommand({
      prompt: "do something",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
      agent: "orch-planner_v2",
    });
    expect(cmd.args).toContain("--agent=orch-planner_v2");
  });

  it("normalizes and allowlists trustTools to filter unknown tools", () => {
    snapshotEnv();
    const cmd = kiroAdapter.buildCommand({
      prompt: "do something",
      nodeId: "n1",
      worktreePath: "/tmp/wt",
      trustTools: "fs_read,arbitrary_tool,fs_write,*",
    });
    expect(cmd.args).toContain("--trust-tools=fs_read,fs_write");
  });
});
