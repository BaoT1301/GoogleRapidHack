/**
 * Managed mcp-context-manager — auto-spawn the mcp indexer per project repo so the KB
 * sync gets RICH context (signatures + call-graph edges) without the user manually
 * starting a server or setting MCP_CONTEXT_URL.
 *
 * mcp indexes a single WORKSPACE_ROOT and has no runtime "switch repo" endpoint, so we
 * keep one instance PER repo path (reused across syncs; spawned on first need). A sync
 * waits a short bounded time for readiness — if mcp is slow to index, this sync falls
 * back to repo-scan while the instance keeps warming, so the NEXT sync uses mcp. Best-
 * effort throughout: any failure (mcp not built, spawn error, timeout) → undefined →
 * the caller uses repo-scan. Disable with ORCH_MCP_AUTOSPAWN=false.
 *
 * The core is dependency-injected (spawn/port/ready/delay) so it's unit-tested without
 * spawning real processes; the default singleton wires the real Node implementations.
 */
import { spawn as nodeSpawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import path from "node:path";

/** Minimal handle over a spawned process (so the core can be faked in tests). */
export interface McpProcHandle {
  kill: () => void;
  onExit: (cb: () => void) => void;
  exited: () => boolean;
}

export interface McpManagerDeps {
  /** Locate the mcp server entry (dist/server.js); undefined → mcp unavailable. */
  resolveEntry: () => string | undefined;
  spawn: (entry: string, env: Record<string, string>) => McpProcHandle;
  findFreePort: () => Promise<number>;
  /** Resolve true once `${url}/api/ready` returns 200 (within timeout). */
  waitReady: (readyUrl: string, timeoutMs: number) => Promise<boolean>;
  delay: (ms: number) => Promise<void>;
  /** How long a single sync waits for readiness before falling back (default 8s). */
  readyWaitMs?: number;
  /** Overall readiness budget for an instance (default 120s). */
  readyTimeoutMs?: number;
}

interface Instance {
  url: string;
  ready: Promise<boolean>;
  handle: McpProcHandle;
}

export interface McpManager {
  /** Ensure mcp is running for `repoPath`; returns its URL when ready, else undefined. */
  ensure: (repoPath: string) => Promise<string | undefined>;
  /** Kill all managed instances (registered on process exit). */
  shutdown: () => void;
  /** Test/introspection hook. */
  readonly size: () => number;
}

export function createMcpManager(deps: McpManagerDeps): McpManager {
  const instances = new Map<string, Instance>();

  async function ensure(repoPath: string): Promise<string | undefined> {
    if (process.env.ORCH_MCP_AUTOSPAWN === "false") return undefined;
    const key = path.resolve(repoPath);

    let inst = instances.get(key);
    if (!inst || inst.handle.exited()) {
      const entry = deps.resolveEntry();
      if (!entry) return undefined; // mcp not built/available → repo-scan
      let port: number;
      try {
        port = await deps.findFreePort();
      } catch {
        return undefined;
      }
      const url = `http://localhost:${port}`;
      const handle = deps.spawn(entry, { WORKSPACE_ROOT: key, HTTP_PORT: String(port) });
      const ready = deps.waitReady(`${url}/api/ready`, deps.readyTimeoutMs ?? 120_000);
      inst = { url, ready, handle };
      instances.set(key, inst);
      handle.onExit(() => {
        if (instances.get(key) === inst) instances.delete(key);
      });
    }

    // Wait a bounded time; if mcp is ready, use it. Otherwise leave it warming and let
    // this sync fall back to repo-scan (the next sync picks up the ready instance).
    const captured = inst;
    const readyWithin = await Promise.race([
      captured.ready.catch(() => false),
      deps.delay(deps.readyWaitMs ?? 8_000).then(() => false),
    ]);
    return readyWithin ? captured.url : undefined;
  }

  function shutdown(): void {
    for (const inst of instances.values()) {
      try {
        inst.handle.kill();
      } catch {
        /* best-effort */
      }
    }
    instances.clear();
  }

  return { ensure, shutdown, size: () => instances.size };
}

// ── Real Node wiring ────────────────────────────────────────────────────────────

/** Find the mcp server bundle in the monorepo (or an explicit override). */
function realResolveEntry(): string | undefined {
  const override = process.env.ORCH_MCP_SERVER_ENTRY;
  const candidates = [
    override,
    // orchestrator cwd is services/orchestrator at runtime → sibling service:
    path.resolve(process.cwd(), "../mcp-context-manager/dist/server.js"),
    path.resolve(process.cwd(), "services/mcp-context-manager/dist/server.js"),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p));
}

function realSpawn(entry: string, env: Record<string, string>): McpProcHandle {
  // cwd = the mcp package root (parent of dist/) so its node_modules resolve.
  const cwd = path.dirname(path.dirname(entry));
  const proc = nodeSpawn(process.execPath, [entry], {
    cwd,
    env: { ...process.env, ...env },
    stdio: "ignore",
    windowsHide: true,
  });
  return {
    kill: () => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
    },
    onExit: (cb) => proc.once("exit", cb),
    exited: () => proc.exitCode !== null || proc.signalCode !== null,
  };
}

function realFindFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}

async function realWaitReady(readyUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(readyUrl, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

const realDelay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Process-wide singleton wired to the real Node implementations. */
export const mcpManager: McpManager = createMcpManager({
  resolveEntry: realResolveEntry,
  spawn: realSpawn,
  findFreePort: realFindFreePort,
  waitReady: realWaitReady,
  delay: realDelay,
});

// Clean up spawned mcp processes when the orchestrator server exits.
let cleanupRegistered = false;
function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  const bye = () => mcpManager.shutdown();
  process.once("exit", bye);
  process.once("SIGINT", () => {
    bye();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    bye();
    process.exit(0);
  });
}

/**
 * Auto-spawn entry for the sync path: ensure a managed mcp for `repoPath` and return
 * its URL when ready (else undefined → repo-scan). Registers exit cleanup on first use.
 */
export async function ensureManagedMcp(repoPath: string): Promise<string | undefined> {
  registerCleanup();
  return mcpManager.ensure(repoPath);
}
