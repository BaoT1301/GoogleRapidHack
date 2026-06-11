import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { buildMCPConfig } from "./mcp-config-builder";

const execFileAsync = promisify(execFile);

/**
 * MCP-3 — `mcp-context-manager` reachability probe (dev docker-exec + packaged
 * node-child). Scope is **env-flag + reachability only** — the `buildMCPConfig`
 * server-entry shape is UNCHANGED (`runtime-run-sse-api.md` §6). Before a run the
 * orchestrator can call {@link probeMcpContextManager} to fail FAST with an
 * actionable message instead of letting the spawned CLI hang on a dead server.
 *
 * The actual per-platform native bundling (a real `dist/server.js` inside the
 * packaged app) is **PKG-3** (Sprint 10, deferred) — see `issues.md`. This probe
 * verifies reachability and tells the user exactly what to fix; it does not bundle.
 */

export type McpContextManagerMode = "docker" | "node";

/** The dev container name the docker-exec entry targets. */
export const MCP_CONTEXT_MANAGER_CONTAINER = "mcp-context-manager";

export interface McpReachability {
  mode: McpContextManagerMode;
  /** The exact command/args that would be spawned (mirrors buildMCPConfig step 1). */
  command: string;
  args: string[];
  reachable: boolean;
  /** Why it is unreachable (omitted when reachable). */
  reason?: string;
  /** Actionable remediation hint (omitted when reachable). */
  suggestedFix?: string;
}

export interface ProbeDeps {
  env?: NodeJS.ProcessEnv;
  /** Returns true when the named docker container is running. Injectable for tests. */
  dockerContainerRunning?: (container: string) => Promise<boolean>;
  /** Returns true when the path exists/readable. Injectable for tests. */
  fileExists?: (path: string) => Promise<boolean>;
}

/** Resolve the effective mode (docker default; `node` when packaged). */
export function resolveMcpContextManagerMode(
  env: NodeJS.ProcessEnv = process.env,
): McpContextManagerMode {
  return (env.MCP_CONTEXT_MANAGER_MODE ?? "docker") === "node" ? "node" : "docker";
}

/** Default docker liveness check: `docker inspect -f {{.State.Running}} <name>`. */
async function defaultDockerContainerRunning(container: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["inspect", "-f", "{{.State.Running}}", container],
      { encoding: "utf8", timeout: 10_000 },
    );
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

/** Default fs existence check (readable). */
async function defaultFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe whether the spawned CLI will actually be able to reach
 * `mcp-context-manager`. Reads the exact command/args from `buildMCPConfig` so the
 * probe can never drift from what is spawned.
 *
 *  - **docker** (dev): the `mcp-context-manager` container must be running.
 *  - **node** (packaged): the bundled `dist/server.js` (`MCP_CONTEXT_MANAGER_PATH`)
 *    must exist on disk.
 *
 * Never throws — it returns a structured verdict with an actionable `suggestedFix`.
 */
export async function probeMcpContextManager(deps: ProbeDeps = {}): Promise<McpReachability> {
  const env = deps.env ?? process.env;
  const mode = resolveMcpContextManagerMode(env);
  const dockerContainerRunning = deps.dockerContainerRunning ?? defaultDockerContainerRunning;
  const fileExists = deps.fileExists ?? defaultFileExists;

  // Read the exact entry that will be spawned (single source of truth).
  const entry = buildMCPConfig([], env).mcpServers["mcp-context-manager"];
  const command = entry.command;
  const args = entry.args;

  if (mode === "docker") {
    const running = await dockerContainerRunning(MCP_CONTEXT_MANAGER_CONTAINER);
    if (running) return { mode, command, args, reachable: true };
    return {
      mode,
      command,
      args,
      reachable: false,
      reason: `Docker container "${MCP_CONTEXT_MANAGER_CONTAINER}" is not running.`,
      suggestedFix:
        "Start the MCP stack with `./mcp.sh up` (or `docker compose -f docker-compose.mcp.yml up -d`), then retry. To run packaged without Docker set MCP_CONTEXT_MANAGER_MODE=node and MCP_CONTEXT_MANAGER_PATH=<path to dist/server.js>.",
    };
  }

  // node (packaged) mode — the bundled server path must exist.
  const serverPath = args[0];
  const exists = await fileExists(serverPath);
  if (exists) return { mode, command, args, reachable: true };
  return {
    mode,
    command,
    args,
    reachable: false,
    reason: `Bundled mcp-context-manager server not found at "${serverPath}".`,
    suggestedFix:
      "Set MCP_CONTEXT_MANAGER_PATH to the bundled dist/server.js, or build it (`npm --prefix services/mcp-context-manager run build`). Native per-platform bundling is tracked as PKG-3.",
  };
}
