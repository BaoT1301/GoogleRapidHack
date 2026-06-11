import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeMcpConfig, materializePlannerMcpConfig } from "./runtime-mcp-config";

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tmpWorktree(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mcp-materialize-"));
  tmpDirs.push(dir);
  return dir;
}

describe("materializeMcpConfig (real per-run MCP config)", () => {
  it("writes the real config to Kiro's workspace path with mcp-context-manager", async () => {
    const worktreePath = await tmpWorktree();
    const result = await materializeMcpConfig({
      runId: "run1",
      nodeId: "node1",
      worktreePath,
      cli: "kiro",
    });

    // kiro-cli auto-discovers <cwd>/.kiro/settings/mcp.json.
    expect(result.mcpConfigPath).toBe(path.join(worktreePath, ".kiro", "settings", "mcp.json"));
    expect(result.servers).toContain("mcp-context-manager");
    expect(result.servers).toContain("mongodb");

    const written = JSON.parse(await readFile(result.mcpConfigPath, "utf8"));
    expect(written.mcpServers["mcp-context-manager"]).toBeDefined();
    expect(written.mcpServers["mcp-context-manager"].args).toContain("--stdio-only");
    // No placeholder note key — this is the real builder output.
    expect(written.note).toBeUndefined();
  });

  it("writes under the gitignored .orchestrator/ tree for non-Kiro CLIs", async () => {
    const worktreePath = await tmpWorktree();
    const result = await materializeMcpConfig({
      runId: "run2",
      nodeId: "node2",
      worktreePath,
      cli: "fake",
    });
    expect(result.mcpConfigPath).toContain(`${path.sep}.orchestrator${path.sep}mcp${path.sep}`);
    expect(result.servers).toContain("mcp-context-manager");
  });
});

describe("materializeMcpConfig reachability filtering (MCP-RESILIENCE)", () => {
  it("drops an unreachable mcp-context-manager and records it, run still proceeds", async () => {
    const worktreePath = await tmpWorktree();
    const result = await materializeMcpConfig({
      runId: "run3",
      nodeId: "node3",
      worktreePath,
      cli: "kiro",
      filterUnreachable: true,
      reachabilityDeps: {
        probeContextManager: async () => ({ reachable: false, reason: "container down" }),
        probeMongodbServer: async () => ({ reachable: true }),
      },
    });
    expect(result.servers).not.toContain("mcp-context-manager");
    expect(result.servers).toContain("mongodb");
    expect(result.serversRemain).toBe(true);
    expect(result.skipped).toEqual([
      { name: "mcp-context-manager", reason: "container down" },
    ]);
    const written = JSON.parse(await readFile(result.mcpConfigPath, "utf8"));
    expect(written.mcpServers["mcp-context-manager"]).toBeUndefined();
    expect(written.mcpServers["mongodb"]).toBeDefined();
  });

  it("reports serversRemain=false when every default server is unreachable", async () => {
    const worktreePath = await tmpWorktree();
    const result = await materializeMcpConfig({
      runId: "run4",
      nodeId: "node4",
      worktreePath,
      cli: "kiro",
      filterUnreachable: true,
      reachabilityDeps: {
        probeContextManager: async () => ({ reachable: false, reason: "down" }),
        probeMongodbServer: async () => ({ reachable: false, reason: "no db" }),
      },
    });
    expect(result.servers).toEqual([]);
    expect(result.serversRemain).toBe(false);
    expect(result.skipped.map((s) => s.name).sort()).toEqual(["mcp-context-manager", "mongodb"]);
  });

  it("does not probe (keeps all servers) when filterUnreachable is omitted", async () => {
    const worktreePath = await tmpWorktree();
    let probed = false;
    const result = await materializeMcpConfig({
      runId: "run5",
      nodeId: "node5",
      worktreePath,
      cli: "kiro",
      reachabilityDeps: {
        probeContextManager: async () => {
          probed = true;
          return { reachable: false };
        },
      },
    });
    expect(probed).toBe(false);
    expect(result.servers).toContain("mcp-context-manager");
    expect(result.skipped).toEqual([]);
  });
});

describe("materializePlannerMcpConfig (PLAN-8b — codebase-aware local planner)", () => {
  it("writes the real config to <cwd>/.kiro/settings/mcp.json", async () => {
    const cwd = await tmpWorktree();
    const result = await materializePlannerMcpConfig({ cwd });
    expect(result.mcpConfigPath).toBe(path.join(cwd, ".kiro", "settings", "mcp.json"));
    expect(result.servers).toContain("mcp-context-manager");
    const written = JSON.parse(await readFile(result.mcpConfigPath, "utf8"));
    expect(written.mcpServers["mcp-context-manager"]).toBeDefined();
  });

  it("is idempotent and NON-DESTRUCTIVELY merges a pre-existing user server", async () => {
    const cwd = await tmpWorktree();
    const settingsDir = path.join(cwd, ".kiro", "settings");
    await mkdir(settingsDir, { recursive: true });
    await writeFile(
      path.join(settingsDir, "mcp.json"),
      JSON.stringify({ mcpServers: { "user-custom": { command: "echo", args: ["hi"] } } }),
      "utf8",
    );

    const first = await materializePlannerMcpConfig({ cwd });
    // User's server is preserved; ours are added.
    expect(first.servers).toContain("user-custom");
    expect(first.servers).toContain("mcp-context-manager");

    // Idempotent: running again yields the same server set.
    const second = await materializePlannerMcpConfig({ cwd });
    expect(new Set(second.servers)).toEqual(new Set(first.servers));

    const written = JSON.parse(await readFile(first.mcpConfigPath, "utf8"));
    expect(written.mcpServers["user-custom"]).toEqual({ command: "echo", args: ["hi"] });
  });
});
