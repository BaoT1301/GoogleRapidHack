import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildMCPConfig, type McpServerRef } from "./mcp-config-builder";
import { probeMcpContextManager } from "./mcp-context-reachability";
import { probeMongodb } from "./mcp-mongodb-reachability";
import type { SupportedCli } from "./types";

const execFileAsync = promisify(execFile);

/** A default MCP server that was dropped because it was unreachable. */
export interface SkippedMcpServer {
  name: string;
  reason: string;
}

/**
 * MCP-RESILIENCE: probe the two default MCP servers and report which are
 * unreachable. Injectable so the run-executor (and tests) can substitute probes.
 * Per-node `overrides` are explicit user context servers and are never probed.
 */
export interface McpReachabilityDeps {
  probeContextManager?: () => Promise<{ reachable: boolean; reason?: string }>;
  probeMongodbServer?: () => Promise<{ reachable: boolean; reason?: string }>;
}

/**
 * Materialize the REAL per-run MCP config (mcp-config-builder) into the worktree
 * so the spawned CLI can call `mcp-context-manager` (+ default `mongodb`) tools.
 *
 * kiro-cli has NO `--mcp-config` flag (verified, kiro-cli 2.5.1); it auto-discovers
 * workspace servers at `<cwd>/.kiro/settings/mcp.json`. So for Kiro we write there
 * (cwd = worktree) and exclude `.kiro/` from this worktree's tracked diff. Other
 * CLIs get the config under the gitignored `.orchestrator/` tree.
 */
export async function materializeMcpConfig(input: {
  runId: string;
  nodeId: string;
  worktreePath: string;
  cli?: SupportedCli;
  overrides?: McpServerRef[];
  /**
   * MCP-RESILIENCE: when true, probe the default servers and drop any that are
   * unreachable so the spawned CLI is not forced to hard-fail on startup. When
   * false/undefined the config is materialized exactly as before (no probing).
   */
  filterUnreachable?: boolean;
  /** Injectable probes (tests / run-executor); defaults probe docker + MongoDB. */
  reachabilityDeps?: McpReachabilityDeps;
}): Promise<{
  mcpConfigPath: string;
  servers: string[];
  notes: string[];
  skipped: SkippedMcpServer[];
  /** True when at least one MCP server remained after filtering. */
  serversRemain: boolean;
}> {
  const config = buildMCPConfig(input.overrides ?? []);

  // Names supplied by per-node overrides are explicit user context servers — they
  // are never probed/dropped here.
  const overrideNames = new Set((input.overrides ?? []).map((o) => o.name));
  const skipped: SkippedMcpServer[] = [];

  if (input.filterUnreachable) {
    const probeContextManager =
      input.reachabilityDeps?.probeContextManager ??
      (() => probeMcpContextManager().then((r) => ({ reachable: r.reachable, reason: r.reason })));
    const probeMongodbServer =
      input.reachabilityDeps?.probeMongodbServer ?? (() => probeMongodb());

    // Probe only the default servers that are actually present and not overridden.
    const checks: Array<Promise<void>> = [];
    if (config.mcpServers["mcp-context-manager"] && !overrideNames.has("mcp-context-manager")) {
      checks.push(
        probeContextManager().then((r) => {
          if (!r.reachable) {
            delete config.mcpServers["mcp-context-manager"];
            skipped.push({
              name: "mcp-context-manager",
              reason: r.reason ?? "unreachable",
            });
          }
        }),
      );
    }
    if (config.mcpServers["mongodb"] && !overrideNames.has("mongodb")) {
      checks.push(
        probeMongodbServer().then((r) => {
          if (!r.reachable) {
            delete config.mcpServers["mongodb"];
            skipped.push({ name: "mongodb", reason: r.reason ?? "unreachable" });
          }
        }),
      );
    }
    await Promise.all(checks);
  }

  const servers = Object.keys(config.mcpServers);
  const json = `${JSON.stringify(config, null, 2)}\n`;
  const isKiro = input.cli === "kiro";

  const mcpConfigPath = isKiro
    ? path.join(input.worktreePath, ".kiro", "settings", "mcp.json")
    : path.join(input.worktreePath, ".orchestrator", "mcp", input.runId, input.nodeId, "mcp.json");

  await mkdir(path.dirname(mcpConfigPath), { recursive: true });
  await writeFile(mcpConfigPath, json, "utf8");

  const notes = [`Materialized real MCP config (${servers.length} servers: ${servers.join(", ") || "none"}).`];
  for (const s of skipped) {
    notes.push(`Skipped unreachable MCP server "${s.name}": ${s.reason}`);
  }

  if (isKiro) {
    notes.push("Written to .kiro/settings/mcp.json — kiro-cli auto-discovers it (cwd = worktree).");
    // Keep orchestrator plumbing out of the captured agent patch (this worktree only).
    await excludeFromWorktree(input.worktreePath, ".kiro/");
  } else {
    notes.push("Written under .orchestrator/ (gitignored).");
    // Keep runtime plumbing out of captured agent patches and path-policy checks.
    await excludeFromWorktree(input.worktreePath, ".orchestrator/");
  }

  return { mcpConfigPath, servers, notes, skipped, serversRemain: servers.length > 0 };
}

/**
 * Best-effort add a path entry to a worktree/repo's local git exclude
 * (`.git/info/exclude`) so orchestrator plumbing (`.kiro/`) never dirties the
 * user's tracked tree. Idempotent (no duplicate lines) and never throws — a run
 * must not fail because the exclude file is unavailable. Exported so sibling
 * runtime materializers (e.g. `planner-agent.ts`) reuse it instead of
 * duplicating the logic.
 */
export async function excludeFromWorktree(worktreePath: string, entry: string): Promise<void> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", worktreePath, "rev-parse", "--git-path", "info/exclude"],
      { encoding: "utf8", timeout: 10_000 },
    );
    const raw = stdout.trim();
    const excludePath = path.isAbsolute(raw) ? raw : path.join(worktreePath, raw);
    let current = "";
    try {
      current = await readFile(excludePath, "utf8");
    } catch {
      // No exclude file yet.
    }
    if (!current.split(/\r?\n/).includes(entry)) {
      const sep = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
      await appendFile(excludePath, `${sep}${entry}\n`, "utf8");
    }
  } catch {
    // Best-effort: never fail a run because the exclude file is unavailable.
  }
}


/**
 * Materialize the REAL MCP config for the LOCAL PLANNER (PLAN-8b) into the
 * planner's working directory so `kiro-cli` auto-discovers `mcp-context-manager`
 * (+ default `mongodb`) and the planner can scan the actual repo it runs in.
 *
 * Unlike the per-run path, the planner cwd is the user's PERSISTENT repo, so this
 * is **non-destructive + idempotent**: if a `.kiro/settings/mcp.json` already
 * exists we MERGE (our servers win per key; the user's other servers are kept).
 * `.kiro/` is added to the repo's git exclude (best-effort) so orchestrator
 * plumbing never dirties the user's tracked tree. Never throws on FS issues — the
 * caller treats materialization as best-effort.
 */
export async function materializePlannerMcpConfig(input: {
  cwd: string;
  overrides?: McpServerRef[];
}): Promise<{ mcpConfigPath: string; servers: string[]; notes: string[] }> {
  const built = buildMCPConfig(input.overrides ?? []);
  const mcpConfigPath = path.join(input.cwd, ".kiro", "settings", "mcp.json");
  const notes: string[] = [];

  // Merge with any pre-existing user config (preserve their servers).
  let merged = built.mcpServers;
  let existedBefore = false;
  try {
    const current = await readFile(mcpConfigPath, "utf8");
    existedBefore = true;
    const parsed = JSON.parse(current) as { mcpServers?: Record<string, unknown> };
    if (parsed && typeof parsed === "object" && parsed.mcpServers) {
      // User servers first, then ours (ours win for shared keys).
      merged = { ...(parsed.mcpServers as typeof built.mcpServers), ...built.mcpServers };
    }
  } catch {
    // No existing file (or unreadable/invalid) → write a fresh config.
  }

  const servers = Object.keys(merged);
  await mkdir(path.dirname(mcpConfigPath), { recursive: true });
  await writeFile(mcpConfigPath, `${JSON.stringify({ mcpServers: merged }, null, 2)}\n`, "utf8");

  notes.push(
    `${existedBefore ? "Merged into" : "Wrote"} planner MCP config at .kiro/settings/mcp.json (${servers.length} servers: ${servers.join(", ")}); kiro-cli auto-discovers it (cwd = repo root).`,
  );
  // Keep orchestrator plumbing out of the user's tracked tree (best-effort).
  await excludeFromWorktree(input.cwd, ".kiro/");

  return { mcpConfigPath, servers, notes };
}
