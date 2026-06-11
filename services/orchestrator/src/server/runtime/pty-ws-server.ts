// Authenticated PTY WebSocket server. Next.js App Router route handlers cannot
// perform a WebSocket upgrade, so the interactive worktree shell (feature 2=b)
// is served by a dedicated `ws` server started from instrumentation.ts on a
// localhost-bound port (ORCH_PTY_WS_PORT).
//
// Security posture (3=c):
//   • bound to 127.0.0.1 (see startPtyWsServer) — not reachable off-host;
//   • Origin must be localhost (browsers send Origin on the upgrade);
//   • the Clerk session cookie is verified directly via verifyToken (auth() needs
//     a Next request scope we don't have here), with a dev-only bypass;
//   • the worktree is resolved ONLY from an owner-scoped Run document, so a user
//     can never attach a shell to a run/worktree they don't own;
//   • idle sessions are reaped by PtySessionManager.
//
// The connection handler is split out + dependency-injected so the security flow
// is unit-tested with fakes (no real socket / DB / shell).
import type { IncomingMessage } from "node:http";
import { ulid } from "ulid";
import { sharedPtySessionManager, type PtySessionManager } from "./pty-session-manager";

/** Minimal structural socket type (the `ws` WebSocket satisfies it). */
export interface WsLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message" | "close" | "error", cb: (...args: unknown[]) => void): void;
}

export interface PtyRequestLike {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface PtyTarget {
  runId: string;
  nodeId: string;
}

const WS_BAD_REQUEST = 4400;
const WS_UNAUTHORIZED = 4401;
const WS_FORBIDDEN = 4403;
const WS_NOT_FOUND = 4404;
const WS_INTERNAL = 4500;

/** Parse `/pty?runId=..&nodeId=..`. Returns null on any malformed input. */
export function parsePtyTarget(rawUrl: string | undefined): PtyTarget | null {
  if (!rawUrl) return null;
  let u: URL;
  try {
    u = new URL(rawUrl, "http://localhost");
  } catch {
    return null;
  }
  if (u.pathname !== "/pty") return null;
  const runId = u.searchParams.get("runId");
  const nodeId = u.searchParams.get("nodeId");
  if (!runId || !nodeId) return null;
  return { runId, nodeId };
}

/** Allow only same-host (localhost/127.0.0.1) origins, or a non-browser client
 *  (no Origin header) since the server is already bound to loopback. */
export function isLocalhostOrigin(origin?: string): boolean {
  if (!origin) return true; // non-browser (e.g. wscat / tests) — loopback-bound anyway
  try {
    const h = new URL(origin).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

function headerVal(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function readCookie(cookieHeader: string | undefined, key: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === key) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

/**
 * Default request authorizer → resolves a Clerk userId from the session cookie
 * (production/desktop), with a dev-only bypass. Returns null when unauthenticated.
 */
export async function authorizeRequest(req: PtyRequestLike): Promise<string | null> {
  // Dev bypass: ?dev_user=<id> (browsers can't set WS request headers, so a
  // query param is the only viable dev channel). Never honored in production.
  if (process.env.ALLOW_DEV_AUTH === "1" && process.env.NODE_ENV !== "production") {
    const target = parsePtyTarget(req.url);
    if (target) {
      try {
        const u = new URL(req.url as string, "http://localhost");
        const dev = u.searchParams.get("dev_user");
        if (dev) return dev;
      } catch {
        /* fall through */
      }
    }
  }

  const token = readCookie(headerVal(req.headers, "cookie"), "__session");
  if (!token) return null;

  // BFF mode: the laptop holds NO CLERK_SECRET_KEY — verify the session token via
  // the cloud BFF (which owns the secret), mirroring createTRPCContext's auth path.
  if (process.env.BFF_URL) {
    try {
      const { resolveUserIdViaBff } = await import("@/bff/whoami");
      return await resolveUserIdViaBff(token);
    } catch {
      return null;
    }
  }

  if (!process.env.CLERK_SECRET_KEY) return null;
  try {
    const { verifyToken } = await import("@clerk/nextjs/server");
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    return (payload.sub as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Default worktree resolver — owner-scoped lookup in the Run document. */
export async function resolveOwnedWorktree(
  runId: string,
  nodeId: string,
  userId: string,
): Promise<string | null> {
  // Owner-scoped lookup via the run gateway (BFF in BFF mode; direct Mongo
  // otherwise) — the terminal must not require a local Mongo when secrets/data
  // live in the cloud.
  const { getRunGateway } = await import("@/server/data/run-gateway");
  const run = await getRunGateway().getById(userId, runId);
  if (!run) return null;
  const nodeRuns = run.nodeRuns as unknown as
    | Record<string, { worktreePath?: string }>
    | Map<string, { worktreePath?: string }>
    | undefined;
  const entry =
    nodeRuns instanceof Map ? nodeRuns.get(nodeId) : nodeRuns?.[nodeId];
  return entry?.worktreePath || null;
}

export interface PtyHandlerDeps {
  manager: PtySessionManager;
  authorize: (req: PtyRequestLike) => Promise<string | null>;
  resolveWorktree: (runId: string, nodeId: string, userId: string) => Promise<string | null>;
  originAllowed?: (origin?: string) => boolean;
  genId?: () => string;
}

interface ClientMsg {
  type?: string;
  data?: string;
  cols?: number;
  rows?: number;
}

/**
 * Build the WS `connection` handler. Runs the full security flow, then bridges
 * the socket to a PTY session. Exported (and injected) so the flow is testable.
 */
export function createPtyConnectionHandler(deps: PtyHandlerDeps) {
  const originAllowed = deps.originAllowed ?? isLocalhostOrigin;

  return async function handleConnection(socket: WsLike, req: PtyRequestLike): Promise<void> {
    const reject = (code: number, message: string) => {
      try {
        socket.send(JSON.stringify({ type: "error", message }));
      } catch {
        /* socket may already be gone */
      }
      try {
        socket.close(code, message);
      } catch {
        /* ignore */
      }
    };

    if (!originAllowed(headerVal(req.headers, "origin"))) {
      return reject(WS_FORBIDDEN, "Forbidden origin");
    }
    const target = parsePtyTarget(req.url);
    if (!target) return reject(WS_BAD_REQUEST, "Bad request");

    let userId: string | null;
    try {
      userId = await deps.authorize(req);
    } catch {
      userId = null;
    }
    if (!userId) return reject(WS_UNAUTHORIZED, "Unauthorized");

    let worktreePath: string | null;
    try {
      worktreePath = await deps.resolveWorktree(target.runId, target.nodeId, userId);
    } catch {
      return reject(WS_INTERNAL, "Failed to resolve worktree");
    }
    if (!worktreePath) return reject(WS_NOT_FOUND, "No worktree for this node");

    const sessionId = deps.genId?.() ?? ulid();
    let creating: Promise<void> | null = null;
    let created = false;
    let closed = false;

    const ensureSession = async (cols?: number, rows?: number): Promise<void> => {
      if (created) return;
      if (creating) return creating;
      creating = (async () => {
        await deps.manager.create({
          sessionId,
          runId: target.runId,
          nodeId: target.nodeId,
          cwd: worktreePath as string,
          cols,
          rows,
          onData: (data) => {
            if (!closed) socket.send(JSON.stringify({ type: "data", data }));
          },
          onExit: (e) => {
            if (!closed) {
              socket.send(JSON.stringify({ type: "exit", code: e.exitCode }));
              socket.close(1000, "shell exited");
            }
          },
        });
        created = true;
      })();
      try {
        await creating;
      } catch (err) {
        reject(WS_INTERNAL, err instanceof Error ? err.message : "Failed to start shell");
      }
    };

    socket.on("message", (raw: unknown) => {
      void (async () => {
        let msg: ClientMsg;
        try {
          const text =
            typeof raw === "string"
              ? raw
              : Buffer.isBuffer(raw)
                ? raw.toString("utf8")
                : String(raw);
          msg = JSON.parse(text) as ClientMsg;
        } catch {
          return; // ignore non-JSON frames
        }
        if (msg.type === "init") {
          await ensureSession(msg.cols, msg.rows);
        } else if (msg.type === "data" && typeof msg.data === "string") {
          await ensureSession();
          deps.manager.write(sessionId, msg.data);
        } else if (msg.type === "resize") {
          await ensureSession(msg.cols, msg.rows);
          if (typeof msg.cols === "number" && typeof msg.rows === "number") {
            deps.manager.resize(sessionId, msg.cols, msg.rows);
          }
        }
      })();
    });

    socket.on("close", () => {
      closed = true;
      deps.manager.kill(sessionId);
    });
    socket.on("error", () => {
      closed = true;
      deps.manager.kill(sessionId);
    });
  };
}

/** Resolve the PTY ws port (env > default 3031). 3031 avoids the mcp-context
 *  stack's 3001 (see README) and the Next app's 3000. */
export function resolvePtyWsPort(): number {
  const env = Number(process.env.ORCH_PTY_WS_PORT);
  return Number.isFinite(env) && env > 0 ? env : 3031;
}

let started = false;

/**
 * Start the localhost-bound PTY ws server. Idempotent (guards against Next's
 * double `register()` in dev). No-op return value; logs on bind.
 */
export async function startPtyWsServer(): Promise<void> {
  if (started) return;
  started = true;

  const { WebSocketServer } = await import("ws");
  const port = resolvePtyWsPort();
  const wss = new WebSocketServer({ host: "127.0.0.1", port });

  const handler = createPtyConnectionHandler({
    manager: sharedPtySessionManager,
    authorize: authorizeRequest,
    resolveWorktree: resolveOwnedWorktree,
  });

  wss.on("connection", (socket: unknown, req: IncomingMessage) => {
    void handler(socket as WsLike, { url: req.url, headers: req.headers });
  });

  wss.on("error", (err: Error) => {
    console.error("[pty-ws] server error:", err.message);
  });

  console.log(`[pty-ws] interactive shell server listening on 127.0.0.1:${port}`);
}
