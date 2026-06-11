import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { serializeMCPConfig, type McpServerRef } from "./mcp-config-builder";

export interface MaterializeMcpConfigInput {
  rootRepoPath: string;
  runId: string;
  nodeId: string;
  worktreePath: string;
  overrides?: McpServerRef[];
}

export interface MaterializedMcpConfig {
  mcpConfigPath: string;
  notes: string[];
}

export async function materializeMcpConfig(
  input: MaterializeMcpConfigInput,
): Promise<MaterializedMcpConfig> {
  const safeRunId = sanitizePathSegment(input.runId);
  const safeNodeId = sanitizePathSegment(input.nodeId);
  const configDirectory = path.join(
    input.rootRepoPath,
    ".orchestrator",
    "tmp",
    safeRunId,
    safeNodeId,
  );
  const mcpConfigPath = path.join(configDirectory, "mcp-config.json");
  const serializedConfig = serializeMCPConfig(input.overrides ?? []);

  await mkdir(configDirectory, { recursive: true });
  await writeFile(mcpConfigPath, `${serializedConfig}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  return {
    mcpConfigPath,
    notes: [
      "Per-node MCP config materialized for CLI adapters that support explicit config files.",
      "Codex currently keeps using the existing global ~/.codex/config.toml MCP behavior until local config injection is verified.",
      "MCP config content is intentionally not emitted through SSE or logs.",
    ],
  };
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || "unknown";
}
