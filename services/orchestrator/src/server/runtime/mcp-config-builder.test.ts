import { describe, expect, it } from "vitest";
import { buildMCPConfig, serializeMCPConfig } from "./mcp-config-builder";

const baseEnv = {
  MONGODB_URI: "mongodb://localhost:27017/orchestrator",
} as unknown as NodeJS.ProcessEnv;

describe("buildMCPConfig", () => {
  it("always includes mcp-context-manager and mongodb by default", () => {
    const cfg = buildMCPConfig([], baseEnv);
    expect(Object.keys(cfg.mcpServers)).toEqual(
      expect.arrayContaining(["mcp-context-manager", "mongodb"]),
    );
    expect(cfg.mcpServers.mongodb.env?.MDB_MCP_READ_ONLY).toBe("true");
    expect(cfg.mcpServers.mongodb.env?.MDB_MCP_CONNECTION_STRING).toContain(
      "localhost:27017",
    );
  });

  it("context-manager uses docker-exec in dev, node-child when packaged", () => {
    const dev = buildMCPConfig([], baseEnv).mcpServers["mcp-context-manager"];
    expect(dev.command).toBe("docker");

    const packaged = buildMCPConfig([], {
      ...baseEnv,
      MCP_CONTEXT_MANAGER_MODE: "node",
      MCP_CONTEXT_MANAGER_PATH: "/app/x/server.js",
    } as NodeJS.ProcessEnv).mcpServers["mcp-context-manager"];
    expect(packaged.command).toBe("node");
    expect(packaged.args).toContain("/app/x/server.js");
    expect(packaged.args).toContain("--stdio-only");
  });

  it("MongoDB MCP can be disabled with ENABLE_MCP_MONGODB=0", () => {
    const cfg = buildMCPConfig([], {
      ...baseEnv,
      ENABLE_MCP_MONGODB: "0",
    } as NodeJS.ProcessEnv);
    expect(cfg.mcpServers.mongodb).toBeUndefined();
    expect(cfg.mcpServers["mcp-context-manager"]).toBeDefined();
  });

  it("does not add removed sponsor MCPs even if their legacy flags are set", () => {
    // Phoenix / Dynatrace / GitLab were removed — MongoDB is the only sponsor MCP.
    const cfg = buildMCPConfig([], {
      ...baseEnv,
      ENABLE_MCP_PHOENIX: "1",
      ENABLE_MCP_GITLAB: "1",
      ENABLE_MCP_DYNATRACE: "1",
    } as NodeJS.ProcessEnv);
    expect(cfg.mcpServers.phoenix).toBeUndefined();
    expect(cfg.mcpServers.gitlab).toBeUndefined();
    expect(cfg.mcpServers.dynatrace).toBeUndefined();
    // MongoDB + context-manager remain.
    expect(cfg.mcpServers.mongodb).toBeDefined();
    expect(cfg.mcpServers["mcp-context-manager"]).toBeDefined();
  });

  it("applies per-node overrides (last-write-wins)", () => {
    const cfg = buildMCPConfig(
      [{ name: "custom", command: "node", args: ["x.js"] }],
      baseEnv,
    );
    expect(cfg.mcpServers.custom).toEqual({ command: "node", args: ["x.js"] });
  });

  it("serializeMCPConfig returns valid JSON with both required servers", () => {
    const parsed = JSON.parse(serializeMCPConfig());
    expect(parsed.mcpServers["mcp-context-manager"]).toBeDefined();
    expect(parsed.mcpServers.mongodb).toBeDefined();
  });
});
