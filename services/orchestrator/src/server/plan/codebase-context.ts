/**
 * Server-resolved codebase context (PLAN-1, Sprint 5).
 *
 * The orchestrator bakes a **bounded, secret-free, server-resolved** snapshot of
 * the repo into every `POST /api/v1/plan` request so the Architect reasons from
 * real codebase facts (contract: `architect-plan-api.md` §2 + §8a). This field is
 * additive/optional — the Cloud path is byte-for-byte backward compatible when it
 * is absent.
 *
 * SECURITY POSTURE (Zero-Secret Leakage + Blast Radius §8):
 *   - **Never client-trusted.** Any inbound blob is treated as an untrusted hint
 *     and sanitized; a server-side resolver (MCP facts / repo summary) is preferred.
 *   - **Bounded.** Every field is size-capped so the plan request stays small.
 *   - **Secret-free.** Entries that look like keys/tokens/credentialed URIs / .env
 *     assignments are dropped or redacted before they ever leave the orchestrator.
 */

export interface CodebaseContextStats {
  fileCount?: number;
  symbolCount?: number;
  languages?: string[];
}

/** A directed relationship between two symbols (e.g. "calls", "imports"). */
export interface CodebaseEdge {
  from: string;
  to: string;
  type: string;
}

export interface CodebaseContext {
  repoSummary?: string;
  files?: string[];
  symbols?: string[];
  /** Track E: a compact slice of the call/import graph among the kept symbols. */
  edges?: CodebaseEdge[];
  stats?: CodebaseContextStats;
}

/** Per-REQUEST caps — keep the slice baked into a plan request small + predictable. */
export const CODEBASE_CONTEXT_LIMITS = {
  summaryChars: 4000,
  maxListItems: 100,
  itemChars: 200,
  maxLanguages: 20,
  maxEdges: 60,
} as const;

export interface CodebaseContextLimits {
  summaryChars: number;
  maxListItems: number;
  itemChars: number;
  maxLanguages: number;
  maxEdges: number;
}

/**
 * STORAGE caps (Track B1) — used when persisting the KB to the DB. Much higher
 * than the per-request caps because the DB is cheap and `query_codebase` narrows
 * to the relevant top-K at request time. Storing a rich KB means a big repo isn't
 * truncated to ~100 items before retrieval even runs.
 */
export const CODEBASE_STORAGE_LIMITS: CodebaseContextLimits = {
  summaryChars: 8000,
  maxListItems: 1500,
  itemChars: 200,
  maxLanguages: 40,
  maxEdges: 400,
};

/**
 * Heuristic secret detector. Flags strings that look like credentials so they are
 * never forwarded to the Architect. Conservative by design — false positives only
 * drop a single list entry / redact a substring, never the whole context.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, // AWS access key id
  /\bsk-[A-Za-z0-9]{16,}\b/, // OpenAI-style secret key
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, // GitHub token
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack token
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key
  /[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/i, // URI with user:pass@ credentials
  /\b(?:[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|APIKEY|API_KEY|CREDENTIAL|PRIVATE_KEY)[A-Z0-9_]*)\s*[=:]\s*\S+/i, // KEY=value
];

/** True when the string contains anything that looks like a secret. */
export function looksLikeSecret(value: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(value));
}

function clampString(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}… [truncated]`;
}

/**
 * Redact secret-looking substrings from free-form prose (the repo summary). We do
 * not drop the whole summary — we replace the offending span with `[redacted]`.
 */
function redactSecrets(value: string): string {
  let out = value;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`), "[redacted]");
  }
  return out;
}

function sanitizeList(
  raw: unknown,
  limits: CodebaseContextLimits = CODEBASE_CONTEXT_LIMITS,
): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const cleaned = raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && !looksLikeSecret(v))
    .map((v) => clampString(v, limits.itemChars))
    .slice(0, limits.maxListItems);
  return cleaned.length > 0 ? cleaned : undefined;
}

function sanitizeStats(
  raw: unknown,
  limits: CodebaseContextLimits = CODEBASE_CONTEXT_LIMITS,
): CodebaseContextStats | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const stats: CodebaseContextStats = {};
  if (typeof r.fileCount === "number" && Number.isFinite(r.fileCount) && r.fileCount >= 0) {
    stats.fileCount = Math.floor(r.fileCount);
  }
  if (typeof r.symbolCount === "number" && Number.isFinite(r.symbolCount) && r.symbolCount >= 0) {
    stats.symbolCount = Math.floor(r.symbolCount);
  }
  if (Array.isArray(r.languages)) {
    const langs = r.languages
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 0 && !looksLikeSecret(v))
      .map((v) => clampString(v, limits.itemChars))
      .slice(0, limits.maxLanguages);
    if (langs.length > 0) stats.languages = langs;
  }
  return Object.keys(stats).length > 0 ? stats : undefined;
}

/**
 * Sanitize an arbitrary value into a bounded, secret-free `CodebaseContext`.
 * Returns `undefined` when nothing usable survives (so the field is omitted and
 * the Cloud path stays byte-for-byte backward compatible).
 */
export function sanitizeCodebaseContext(
  raw: unknown,
  limits: CodebaseContextLimits = CODEBASE_CONTEXT_LIMITS,
): CodebaseContext | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;

  const out: CodebaseContext = {};

  if (typeof r.repoSummary === "string" && r.repoSummary.trim().length > 0) {
    out.repoSummary = clampString(redactSecrets(r.repoSummary.trim()), limits.summaryChars);
  }

  const files = sanitizeList(r.files, limits);
  if (files) out.files = files;

  const symbols = sanitizeList(r.symbols, limits);
  if (symbols) out.symbols = symbols;

  const edges = sanitizeEdges(r.edges, limits);
  if (edges) out.edges = edges;

  const stats = sanitizeStats(r.stats, limits);
  if (stats) out.stats = stats;

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Sanitize the edge slice: keep only well-formed {from,to,type} with non-empty,
 * secret-free, clamped strings; cap the count. Returns undefined when none survive
 * (field omitted → backward compatible).
 */
function sanitizeEdges(
  raw: unknown,
  limits: CodebaseContextLimits = CODEBASE_CONTEXT_LIMITS,
): CodebaseEdge[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CodebaseEdge[] = [];
  for (const e of raw) {
    if (out.length >= limits.maxEdges) break;
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (typeof r.from !== "string" || typeof r.to !== "string" || typeof r.type !== "string") {
      continue;
    }
    const from = clampString(r.from.trim(), limits.itemChars);
    const to = clampString(r.to.trim(), limits.itemChars);
    const type = clampString(r.type.trim(), 32);
    if (!from || !to || !type) continue;
    if (looksLikeSecret(from) || looksLikeSecret(to)) continue;
    out.push({ from, to, type });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * A server-side resolver of codebase facts (e.g. derived from
 * `mcp-context-manager`). Injectable so the plan path can be unit-tested without
 * a live MCP, and so a richer MCP-backed resolver can be wired in later without
 * touching the router.
 */
export type CodebaseContextResolver = () =>
  | Promise<CodebaseContext | undefined>
  | CodebaseContext
  | undefined;

export interface ResolveCodebaseContextDeps {
  /** Preferred server-side facts source. When it yields a value, the client hint is ignored. */
  resolver?: CodebaseContextResolver;
}

/**
 * Resolve the codebase context the orchestrator will forward.
 *
 * Precedence: a server-side `resolver` (MCP facts / repo summary) wins; otherwise
 * the (untrusted) client hint is sanitized. EITHER way the result passes through
 * {@link sanitizeCodebaseContext} so nothing is ever forwarded raw — satisfying
 * "server-resolved, not client-trusted" (§8a). Never throws.
 */
export async function resolveCodebaseContext(
  clientHint: unknown,
  deps: ResolveCodebaseContextDeps = {},
): Promise<CodebaseContext | undefined> {
  let resolved: CodebaseContext | undefined;
  if (deps.resolver) {
    try {
      resolved = (await deps.resolver()) ?? undefined;
    } catch {
      resolved = undefined;
    }
  }
  return sanitizeCodebaseContext(resolved ?? clientHint);
}
