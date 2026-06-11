import { connect, type Socket } from "node:net";
import { resolveSrv } from "node:dns/promises";

/**
 * MCP-RESILIENCE — best-effort reachability probe for the default `mongodb` MCP
 * server. The `mongodb-mcp-server` connects to MongoDB at startup, so when the
 * database is unreachable kiro's `--require-mcp-startup` aborts the whole node.
 * This probe lets the materializer drop the server (best-effort) instead.
 *
 * It NEVER throws — it returns a structured verdict. A conservative "unreachable"
 * only causes the optional mongodb tool to be omitted; the run still proceeds.
 */

export interface MongodbReachability {
  reachable: boolean;
  reason?: string;
}

export interface MongodbProbeDeps {
  env?: NodeJS.ProcessEnv;
  /** TCP connect check (injectable for tests). */
  tcpConnect?: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
  /** SRV resolver (injectable for tests). */
  resolveSrvHosts?: (hostname: string) => Promise<Array<{ name: string; port: number }>>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1500;

/** Default TCP liveness check: resolve on `connect`, reject/false otherwise. */
function defaultTcpConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean, socket?: Socket) => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve(ok);
    };
    try {
      const socket = connect({ host, port });
      socket.setTimeout(timeoutMs);
      socket.once("connect", () => done(true, socket));
      socket.once("timeout", () => done(false, socket));
      socket.once("error", () => done(false, socket));
    } catch {
      resolve(false);
    }
  });
}

async function defaultResolveSrvHosts(hostname: string): Promise<Array<{ name: string; port: number }>> {
  const records = await resolveSrv(`_mongodb._tcp.${hostname}`);
  return records.map((r) => ({ name: r.name, port: r.port }));
}

/**
 * Parse the first host (and port) out of a Mongo connection string. Handles the
 * comma-separated host list of a standard `mongodb://` URI and the single host of
 * a `mongodb+srv://` URI. Returns `null` when no host can be parsed.
 */
export function parseMongoFirstHost(
  connectionString: string,
): { host: string; port: number; srv: boolean } | null {
  const match = /^mongodb(\+srv)?:\/\/([^/?]+)/i.exec(connectionString.trim());
  if (!match) return null;
  const srv = Boolean(match[1]);
  let authority = match[2];
  // Strip any `user:pass@` credential prefix.
  const at = authority.lastIndexOf("@");
  if (at >= 0) authority = authority.slice(at + 1);
  const firstHost = authority.split(",")[0]?.trim();
  if (!firstHost) return null;
  const [host, portRaw] = firstHost.split(":");
  if (!host) return null;
  // SRV URIs do not carry a port (it comes from the SRV record).
  const port = !srv && portRaw ? Number.parseInt(portRaw, 10) : 27017;
  return { host, port: Number.isFinite(port) ? port : 27017, srv };
}

/**
 * Probe whether the default `mongodb` MCP server will be able to reach its
 * database. SRV URIs are resolved to a concrete host:port first; standard URIs
 * use the first listed host. Best-effort + never throws.
 */
export async function probeMongodb(deps: MongodbProbeDeps = {}): Promise<MongodbReachability> {
  const env = deps.env ?? process.env;
  const connectionString =
    env.MDB_MCP_CONNECTION_STRING ??
    env.MONGODB_URI ??
    "mongodb://localhost:27017/orchestrator";

  const parsed = parseMongoFirstHost(connectionString);
  if (!parsed) {
    return { reachable: false, reason: "Could not parse a host from the MongoDB connection string." };
  }

  const tcpConnect = deps.tcpConnect ?? defaultTcpConnect;
  const resolveSrvHosts = deps.resolveSrvHosts ?? defaultResolveSrvHosts;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let host = parsed.host;
  let port = parsed.port;

  if (parsed.srv) {
    try {
      const targets = await resolveSrvHosts(parsed.host);
      if (!targets.length) {
        return { reachable: false, reason: `No SRV records resolved for "${parsed.host}".` };
      }
      host = targets[0].name;
      port = targets[0].port;
    } catch {
      return { reachable: false, reason: `Could not resolve SRV records for "${parsed.host}".` };
    }
  }

  const ok = await tcpConnect(host, port, timeoutMs);
  return ok
    ? { reachable: true }
    : { reachable: false, reason: `Could not connect to MongoDB at ${host}:${port}.` };
}
