// PtySessionManager — owns interactive PTY shells for the web UI's worktree
// terminal (feature 2=b). Mirrors ProcessManager's role for the non-interactive
// runner, but bidirectional: a shell is spawned in a node's git worktree and its
// raw byte stream is bridged to an xterm.js terminal over a WebSocket (see
// src/instrumentation.ts).
//
// Design notes:
//   • node-pty is a native module and is lazily imported so this file can be
//     imported (and unit-tested with an injected spawn) without it.
//   • Each WebSocket connection gets ONE session, keyed by an opaque sessionId,
//     and also tagged with {runId,nodeId} so a worktree teardown can kill any
//     live shell for that node (killForNode — wired into executeRun's GIT-4
//     cleanup).
//   • An idle timeout reaps abandoned shells (no secret redaction happens on this
//     raw stream, so we don't want forgotten root shells lingering).
import { existsSync } from "node:fs";

export interface PtyLike {
  readonly pid: number;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export type PtySpawnFn = (
  file: string,
  args: string[] | string,
  opts: { cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv; name?: string },
) => PtyLike;

export interface CreateSessionInput {
  sessionId: string;
  runId: string;
  nodeId: string;
  cwd: string;
  cols?: number;
  rows?: number;
  /** Streamed PTY output. */
  onData: (data: string) => void;
  /** Fired when the shell exits (or is killed/reaped). */
  onExit: (e: { exitCode: number; signal?: number }) => void;
}

interface Session {
  id: string;
  runId: string;
  nodeId: string;
  pty: PtyLike;
  idleTimer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_IDLE_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_MAX_SESSIONS = 16;

/** Resolve the idle-reap timeout: explicit `>0` wins, else `ORCH_PTY_IDLE_MS`, else 10m. */
export function resolvePtyIdleMs(explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const env = Number(process.env.ORCH_PTY_IDLE_MS);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_IDLE_MS;
}

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === "win32") {
    return { file: process.env.COMSPEC || "powershell.exe", args: [] };
  }
  // Login shell so the user's PATH/aliases are present.
  return { file: process.env.SHELL || "/bin/bash", args: ["-l"] };
}

export class PtySessionManager {
  private readonly sessions = new Map<string, Session>();
  private spawnFn?: PtySpawnFn;

  constructor(
    private readonly opts: {
      spawn?: PtySpawnFn;
      idleMs?: number;
      maxSessions?: number;
    } = {},
  ) {
    this.spawnFn = opts.spawn;
  }

  get size(): number {
    return this.sessions.size;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  private async resolveSpawn(): Promise<PtySpawnFn> {
    if (this.spawnFn) return this.spawnFn;
    // Lazy native import — only when a real session is actually created.
    // `webpackIgnore` keeps this a genuine runtime import so Next/webpack never
    // tries to bundle node-pty's platform-specific internals (it's a native
    // module listed in serverExternalPackages and copied into the standalone
    // node_modules at build time).
    const pty = await import(/* webpackIgnore: true */ "node-pty");
    this.spawnFn = (file, args, o) =>
      pty.spawn(file, args, o) as unknown as PtyLike;
    return this.spawnFn;
  }

  async create(input: CreateSessionInput): Promise<{ pid: number }> {
    if (this.sessions.has(input.sessionId)) {
      throw new Error(`Session already exists: ${input.sessionId}`);
    }
    const max = this.opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
    if (this.sessions.size >= max) {
      throw new Error(`Too many active shell sessions (max ${max})`);
    }
    if (!input.cwd || !existsSync(input.cwd)) {
      throw new Error(`Worktree path does not exist: ${input.cwd}`);
    }

    const spawn = await this.resolveSpawn();
    const { file, args } = defaultShell();
    // Clean env (drop CLAUDECODE like the runner) + a sane TERM for xterm.
    const { CLAUDECODE: _drop, ...cleanEnv } = process.env;
    const child = spawn(file, args, {
      cwd: input.cwd,
      cols: input.cols ?? 80,
      rows: input.rows ?? 24,
      name: "xterm-256color",
      env: { ...cleanEnv, TERM: "xterm-256color" } as NodeJS.ProcessEnv,
    });

    const session: Session = {
      id: input.sessionId,
      runId: input.runId,
      nodeId: input.nodeId,
      pty: child,
    };
    this.sessions.set(input.sessionId, session);

    child.onData((data) => {
      this.touch(input.sessionId);
      input.onData(data);
    });
    child.onExit((e) => {
      this.clearIdle(session);
      this.sessions.delete(input.sessionId);
      input.onExit(e);
    });

    this.touch(input.sessionId);
    return { pid: child.pid };
  }

  write(sessionId: string, data: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.touch(sessionId);
    s.pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (cols > 0 && rows > 0) s.pty.resize(cols, rows);
  }

  kill(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    this.clearIdle(s);
    try {
      s.pty.kill();
    } catch {
      /* already gone */
    }
    this.sessions.delete(sessionId);
    return true;
  }

  /** Kill every live shell bound to a node (used on worktree teardown). */
  killForNode(runId: string, nodeId: string): number {
    let killed = 0;
    for (const [id, s] of this.sessions) {
      if (s.runId === runId && s.nodeId === nodeId) {
        if (this.kill(id)) killed += 1;
      }
    }
    return killed;
  }

  /** Kill all sessions (shutdown). */
  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }

  private touch(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.clearIdle(s);
    const idleMs = resolvePtyIdleMs(this.opts.idleMs);
    s.idleTimer = setTimeout(() => {
      // Reap: kill the idle shell; onExit cleans the map + notifies the bridge.
      try {
        s.pty.kill();
      } catch {
        /* already gone */
      }
    }, idleMs);
    // Don't keep the process alive just for an idle reaper.
    (s.idleTimer as { unref?: () => void }).unref?.();
  }

  private clearIdle(s: Session): void {
    if (s.idleTimer) {
      clearTimeout(s.idleTimer);
      s.idleTimer = undefined;
    }
  }
}

// HMR-safe shared singleton (mirrors run-executor's sharedProcessManager) so the
// ws server (instrumentation) and the runner's cleanup hook reach the same map.
const g = globalThis as unknown as { __orchPtyManager?: PtySessionManager };
export const sharedPtySessionManager: PtySessionManager =
  g.__orchPtyManager ?? (g.__orchPtyManager = new PtySessionManager());
