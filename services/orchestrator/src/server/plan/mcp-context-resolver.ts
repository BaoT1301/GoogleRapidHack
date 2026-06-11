/**
 * mcp-context-manager-backed codebase resolver (Cloud Infra P3).
 *
 * Upgrades the P2 file-scan resolver: instead of just listing files, query the
 * running mcp-context-manager HTTP API for STRUCTURAL facts — repo stats (diag)
 * and "hotspots" (the most-connected functions/classes, i.e. the architecturally
 * important symbols). That is a far stronger signal for the planner than a flat
 * file list. Contract: `.claude/docs/core/api-contracts/mcp-query-api.md`.
 *
 * Robust + additive: returns undefined when MCP is unreachable OR has indexed 0
 * files (its `workspaceRoot` not pointed at a real repo), so the caller falls back
 * to the P2 scan and the plan path stays byte-for-byte backward compatible. Gated
 * by MCP_CONTEXT_URL — unset ⇒ this resolver is never used (pure P2 behavior).
 */
import type { CodebaseContext, CodebaseEdge } from "./codebase-context";

const REQUEST_TIMEOUT_MS = 4000;
// Max LOCAL symbols stored (ranked by connectivity); query_codebase narrows per request.
const HOTSPOT_LIMIT = 500;
// Edges to request from the graph export — generous for good node/symbol coverage; the
// symbol + edge extractors rank/cap locally afterward.
const GRAPH_FETCH_EDGES = 2000;

/**
 * Translate a mcp dependency-graph export into compact {from,to,type} edges keyed by
 * symbol NAME (qualifiedName/label), so the planner can reason about flow. Shape-
 * tolerant (nodes/edges at top level or under `graph`) + pure → unit-tested. Returns
 * [] on any mismatch (best-effort: missing edges never break a plan).
 */
export function extractEdges(graphBody: unknown): CodebaseEdge[] {
  if (!graphBody || typeof graphBody !== "object") return [];
  const b = graphBody as Record<string, unknown>;
  const graph = (b.graph && typeof b.graph === "object" ? b.graph : b) as Record<string, unknown>;
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];

  const idToName = new Map<string, string>();
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    const node = n as Record<string, unknown>;
    const id = typeof node.id === "string" ? node.id : undefined;
    const name =
      (typeof node.qualifiedName === "string" && node.qualifiedName) ||
      (typeof node.label === "string" && node.label) ||
      undefined;
    if (id && name) idToName.set(id, name);
  }

  const out: CodebaseEdge[] = [];
  for (const e of rawEdges) {
    if (!e || typeof e !== "object") continue;
    const edge = e as Record<string, unknown>;
    const from = typeof edge.source === "string" ? idToName.get(edge.source) : undefined;
    const to = typeof edge.target === "string" ? idToName.get(edge.target) : undefined;
    const type = typeof edge.type === "string" ? edge.type : undefined;
    if (from && to && type && from !== to) out.push({ from, to, type });
  }
  return out;
}

/** A local code symbol pulled from the dependency graph (for KB symbols + enrichment). */
export interface GraphSymbol {
  /** "qualifiedName — filePath" display/embed text. */
  symbol: string;
  filePath: string;
  /** 1-based declaration line (from metadata.rangeStart, else parsed from the node id). */
  line?: number;
}

/** Node `type`s that are NOT local code symbols (no signature to read). */
const NON_SYMBOL_TYPES = new Set(["file", "external", "module", "import"]);

/** Symbol-node ids encode "...:<line>:<col>" — recover the line when metadata lacks it. */
function parseLineFromId(id: string): number | undefined {
  const m = /:(\d+):(\d+)$/.exec(id);
  return m ? Number(m[1]) : undefined;
}

/**
 * Pull LOCAL code symbols from a mcp dependency-graph export, ranked by connectivity
 * (our own "hotspots" — far better than the /hotspots endpoint, which only returns
 * external deps). Keeps each symbol's filePath + declaration line so signatures can be
 * read locally (Phase 4). Shape-tolerant + pure → unit-tested. Capped to `limit`.
 */
export function extractGraphSymbols(graphBody: unknown, limit = 500): GraphSymbol[] {
  if (!graphBody || typeof graphBody !== "object") return [];
  const b = graphBody as Record<string, unknown>;
  const graph = (b.graph && typeof b.graph === "object" ? b.graph : b) as Record<string, unknown>;
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];

  // Degree (edges touching a node) → rank the most-connected local symbols first.
  const degree = new Map<string, number>();
  for (const e of rawEdges) {
    if (!e || typeof e !== "object") continue;
    const ed = e as Record<string, unknown>;
    if (typeof ed.source === "string") degree.set(ed.source, (degree.get(ed.source) ?? 0) + 1);
    if (typeof ed.target === "string") degree.set(ed.target, (degree.get(ed.target) ?? 0) + 1);
  }

  const scored: { sym: GraphSymbol; deg: number; idx: number }[] = [];
  nodes.forEach((n, idx) => {
    if (!n || typeof n !== "object") return;
    const node = n as Record<string, unknown>;
    const type =
      (typeof node.type === "string" && node.type) ||
      (typeof node.kind === "string" && node.kind) ||
      "";
    const filePath = typeof node.filePath === "string" ? node.filePath : undefined;
    const name =
      (typeof node.qualifiedName === "string" && node.qualifiedName) ||
      (typeof node.label === "string" && node.label) ||
      "";
    if (!name || !filePath || NON_SYMBOL_TYPES.has(type)) return;
    const id = typeof node.id === "string" ? node.id : "";
    const meta =
      node.metadata && typeof node.metadata === "object"
        ? (node.metadata as Record<string, unknown>)
        : undefined;
    const rs =
      meta && meta.rangeStart && typeof meta.rangeStart === "object"
        ? (meta.rangeStart as Record<string, unknown>)
        : undefined;
    const line = (typeof rs?.line === "number" ? rs.line : undefined) ?? parseLineFromId(id);
    scored.push({ sym: { symbol: `${name} — ${filePath}`, filePath, line }, deg: degree.get(id) ?? 0, idx });
  });

  scored.sort((a, b) => b.deg - a.deg || a.idx - b.idx);
  return scored.slice(0, limit).map((s) => s.sym);
}

interface McpDiag {
  fileCount?: { total?: number; python?: number; ts?: number };
  degraded?: boolean;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function getJson<T>(
  fetchImpl: FetchLike,
  url: string,
): Promise<T | undefined> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}


function languagesFromDiag(diag: McpDiag): string[] {
  const langs: string[] = [];
  if ((diag.fileCount?.ts ?? 0) > 0) langs.push("TypeScript/JavaScript");
  if ((diag.fileCount?.python ?? 0) > 0) langs.push("Python");
  return langs;
}

/**
 * Query mcp-context-manager and map to a CodebaseContext. Returns undefined when
 * the service is unreachable or has indexed nothing (so the caller can fall back).
 */
export async function fetchMcpContext(
  baseUrl: string,
  fetchImpl: FetchLike,
  repoPath?: string,
): Promise<CodebaseContext | undefined> {
  const base = baseUrl.replace(/\/+$/, "");
  const diag = await getJson<McpDiag>(fetchImpl, `${base}/api/v1/diag`);
  const total = diag?.fileCount?.total ?? 0;
  // Nothing indexed (workspaceRoot not pointed at a repo) → let the caller fall back.
  if (!diag || total === 0) return undefined;

  // Symbols + edges both come from the dependency-graph export (ONE fetch). The
  // /hotspots endpoint only returns external deps with no file/line, so we derive our
  // own LOCAL hotspots from the graph (ranked by connectivity) — these carry filePath +
  // declaration line, which the /hotspots nodes lack.
  const graphBody = await getJson<unknown>(
    fetchImpl,
    `${base}/api/v1/mcp/graph?max_edges=${GRAPH_FETCH_EDGES}`,
  );
  const graphSymbols = extractGraphSymbols(graphBody, HOTSPOT_LIMIT);

  // Phase 4: fold each symbol's signature + leading doc-comment (read LOCALLY) into the
  // text we store/embed — richer vectors + the planner sees signatures. Gated + best-
  // effort; falls back to the bare names. Disable with ORCH_KB_SIGNATURES=false.
  let symbols: string[];
  if (repoPath && process.env.ORCH_KB_SIGNATURES !== "false") {
    const { enrichSymbols } = await import("./extract-signatures");
    symbols = await enrichSymbols(repoPath, graphSymbols);
  } else {
    symbols = graphSymbols.map((s) => s.symbol);
  }

  // Distinct files that hold the ranked symbols (the architecturally central files).
  const files = [...new Set(graphSymbols.map((s) => s.filePath))];

  // Phase 5: a compact slice of the call/import graph (who calls/imports whom), so the
  // planner reasons about FLOW, not just location. Same graph body. Disable with
  // ORCH_KB_EDGES=false.
  let edges: CodebaseEdge[] | undefined;
  if (process.env.ORCH_KB_EDGES !== "false") {
    const extracted = extractEdges(graphBody);
    if (extracted.length > 0) edges = extracted;
  }

  const langs = languagesFromDiag(diag);
  const summaryParts = [
    `Structural index (mcp-context-manager): ${total} files indexed${
      langs.length ? ` (${langs.join(", ")})` : ""
    }.`,
  ];
  if (graphSymbols.length > 0) {
    summaryParts.push(
      `Most-connected symbols: ${graphSymbols
        .slice(0, 15)
        .map((s) => s.symbol.split(" — ")[0])
        .join(", ")}.`,
    );
  }

  const context: CodebaseContext = {
    repoSummary: summaryParts.join(" "),
    files: files.length > 0 ? files : undefined,
    symbols: symbols.length > 0 ? symbols : undefined,
    edges,
    stats: {
      fileCount: total,
      symbolCount: symbols.length > 0 ? symbols.length : undefined,
      languages: langs.length > 0 ? langs : undefined,
    },
  };
  return context;
}

/**
 * Build an mcp-context-manager-backed resolver. Never throws — any failure (and
 * an empty/unindexed graph) resolves to undefined so the caller falls back to the
 * P2 file-scan resolver. `fetchImpl` is injectable for tests.
 */
export function createMcpContextResolver(opts: {
  baseUrl: string;
  /** Local repo root — enables Phase 4 signature enrichment (read files locally). */
  repoPath?: string;
  fetchImpl?: FetchLike;
}): () => Promise<CodebaseContext | undefined> {
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  return async () => {
    try {
      return await fetchMcpContext(opts.baseUrl, fetchImpl, opts.repoPath);
    } catch {
      return undefined;
    }
  };
}
