/**
 * MCP Config Builder — the sponsor integration hub (ADR AD-9).
 *
 * Builds the `mcpServers` map injected into every CLI subprocess. Stephen's
 * execute-runner calls `serializeMCPConfig(overrides)`, writes it to a temp file,
 * and passes `--mcp-config <path>` to the CLI.
 *
 * Config-driven via env flags:
 *   - mcp-context-manager : ALWAYS on (node-child when packaged, docker-exec in dev)
 *   - mongodb             : default ON, read-only (sponsor anchor)
 *   - per-node overrides (Context nodes) merge last-write-wins
 */

export interface McpServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpServerRef extends McpServerSpec {
  name: string;
}

export interface MCPConfig {
  mcpServers: Record<string, McpServerSpec>;
}

export function buildMCPConfig(
  overrides: McpServerRef[] = [],
  env: NodeJS.ProcessEnv = process.env,
): MCPConfig {
  const servers: Record<string, McpServerSpec> = {};

  // 1) mcp-context-manager — ALWAYS injected (15 code-analysis tools).
  //    Packaged desktop has no Docker → spawn the Node server directly.
  if ((env.MCP_CONTEXT_MANAGER_MODE ?? "docker") === "node") {
    const serverPath =
      env.MCP_CONTEXT_MANAGER_PATH ??
      "/app/services/mcp-context-manager/dist/server.js";
    servers["mcp-context-manager"] = {
      command: "node",
      args: [serverPath, "--stdio-only"],
    };
  } else {
    servers["mcp-context-manager"] = {
      command: "docker",
      args: ["exec", "-i", "mcp-context-manager", "node", "dist/server.js", "--stdio-only"],
    };
  }

  // 2) MongoDB MCP (SPONSOR ANCHOR) — default ON, read-only.
  if (env.ENABLE_MCP_MONGODB !== "0") {
    servers["mongodb"] = {
      command: "npx",
      args: ["-y", "mongodb-mcp-server@latest"],
      env: {
        MDB_MCP_CONNECTION_STRING:
          env.MDB_MCP_CONNECTION_STRING ??
          env.MONGODB_URI ??
          "mongodb://localhost:27017/orchestrator",
        MDB_MCP_READ_ONLY: env.MDB_MCP_READ_ONLY ?? "true",
        MDB_MCP_DISABLED_TOOLS: env.MDB_MCP_DISABLED_TOOLS ?? "atlas",
      },
    };
  }

  // 3) Per-node Context overrides — last-write-wins.
  for (const o of overrides) {
    servers[o.name] = { command: o.command, args: o.args, ...(o.env ? { env: o.env } : {}) };
  }

  return { mcpServers: servers };
}

export function serializeMCPConfig(overrides: McpServerRef[] = []): string {
  return JSON.stringify(buildMCPConfig(overrides), null, 2);
}
