import http from "node:http";
import { GraphStore } from "./graph/graph-store.js";
import { ClusterConfigLoader } from "./cluster/cluster-config-loader.js";
import { mapFileToCoordinates } from "./geographic-mapper.js";
import type { GraphNode, GraphEdge } from "./types/schema.js";
import {
  QueryTimeoutError,
  withTimeout,
  withRetry,
  paginate,
  parsePaginationParams,
  buildErrorResponse,
  errorStatusCode,
  type QueryErrorResponse,
} from "./utils/query-guards.js";
import { resolveGlobPatterns } from "./indexer/incremental-indexer.js";
import { resolveIgnorePatterns, validateGlob, validateRegex } from "./utils/glob-utils.js";
import { ToolInputError } from "./utils/tool-input-error.js";
import { detectLanguage } from "./parsers/common.js";

/** Returns a standardised 400 error response for bad tool inputs. */
function toolInputErrorResponse(err: ToolInputError): ApiResponse {
  return {
    statusCode: 400,
    headers: {},
    body: { error: err.message, code: "INVALID_PARAMS", retryable: false },
  };
}

/**
 * Returns a human-readable reason string when a tool returns zero results
 * because no files matched the supplied pattern.
 */
function zeroFilesReason(pattern: string, paramName: "file_pattern" | "file_path"): string {
  return (
    `no files matched the \`${paramName}\` glob "${pattern}" — ` +
    `check the pattern is relative to the workspace root and uses correct brace-expansion syntax (e.g. "*.{ts,tsx}").`
  );
}

/**
 * Strip the WORKSPACE_ROOT prefix from an absolute file path to produce
 * a relative path suitable for cluster prefix matching.
 *
 * Example: "/workspace/backend/app/main.py" → "backend/app/main.py"
 */
function toRelativePath(filePath: string): string {
  const workspaceRoot = (process.env.WORKSPACE_ROOT || "").replace(/\/+$/, "");
  if (workspaceRoot && filePath.startsWith(workspaceRoot)) {
    return filePath.slice(workspaceRoot.length).replace(/^\//, "");
  }
  return filePath;
}

interface ApiRequest {
  method: string;
  url: string;
  body?: any;
}

interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
}

// Transform backend GraphNode to frontend Node format
function transformNode(node: GraphNode): any {
  return {
    id: node.id,
    type: node.kind, // Frontend expects 'type' instead of 'kind'
    label: node.label,
    filePath: node.filePath,
    qualifiedName: node.qualifiedName,
    metadata: {
      language: node.language,
      rangeStart: node.rangeStart,
      rangeEnd: node.rangeEnd,
    },
  };
}

// Transform backend GraphEdge to frontend Edge format
function transformEdge(edge: GraphEdge): any {
  return {
    source: edge.source,
    target: edge.target,
    type: edge.type,
    metadata: {
      weight: edge.weight,
      filePath: edge.filePath,
    },
  };
}

export class HttpApiServer {
  private server: http.Server | null = null;
  private graphStore: GraphStore;
  private clusterConfig: ClusterConfigLoader;
  private port: number;
  private readonly sseClients = new Set<http.ServerResponse>();
  private keepaliveInterval: NodeJS.Timeout | null = null;
  private indexingState: { complete: boolean; indexedFiles?: number } = { complete: false };
  private workspaceRoot: string = "";
  private degradedState: { degraded: boolean; reasons: string[] } = { degraded: false, reasons: [] };
  private ready: boolean = false;

  /** Default timeout for query endpoints (ms). */
  private static readonly DEFAULT_TIMEOUT_MS = 5000;

  /** Max retries for query endpoints on timeout. */
  private static readonly MAX_RETRIES = 2;

  /** Backoff between retries (ms). */
  private static readonly RETRY_BACKOFF_MS = 500;

  constructor(graphStore: GraphStore, clusterConfig: ClusterConfigLoader, port: number = 3001) {
    this.graphStore = graphStore;
    this.clusterConfig = clusterConfig;
    this.port = port;
  }

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // SSE endpoint — handled separately (long-lived connection)
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      if (url.pathname === "/api/v1/mcp/events" && req.method === "GET") {
        this.handleSSEConnection(req, res);
        return;
      }
      // Legacy SSE path — redirect to versioned
      if (url.pathname === "/api/mcp/events" && req.method === "GET") {
        // For SSE, we serve directly rather than redirect (EventSource doesn't follow redirects well)
        this.handleSSEConnection(req, res);
        return;
      }

      try {
        const response = await this.handleRequest(req);
        res.writeHead(response.statusCode, {
          "Content-Type": "application/json",
          ...response.headers,
        });
        res.end(JSON.stringify(response.body));
      } catch (error) {
        console.error("[http-api] error handling request:", error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    });

    return new Promise((resolve) => {
      this.server!.listen(this.port, () => {
        console.error(`[http-api] listening on port ${this.port}`);

        // Start SSE keepalive interval (30 seconds)
        this.keepaliveInterval = setInterval(() => {
          this.broadcastSSE("keepalive", { timestamp: Date.now() });
        }, 30_000);

        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }

    // Close all SSE connections
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();

    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          console.error("[http-api] server stopped");
          resolve();
        });
      });
    }
  }

  private async handleRequest(req: http.IncomingMessage): Promise<ApiResponse> {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = url.pathname;

    // --- Backward-compatible redirects: /api/mcp/* → /api/v1/mcp/* (HTTP 301) ---
    if (pathname.startsWith("/api/mcp/") || pathname === "/api/mcp") {
      const newPath = pathname.replace("/api/mcp", "/api/v1/mcp");
      const qs = url.search || "";
      return {
        statusCode: 301,
        headers: { Location: `${newPath}${qs}` },
        body: { message: `Moved permanently to ${newPath}${qs}` },
      };
    }

    // Legacy /api/health → alias (still works, no redirect needed)
    if (pathname === "/api/health" && req.method === "GET") {
      return {
        statusCode: 200,
        headers: {},
        body: { status: "ok" },
      };
    }

    // Readiness probe — 200 when graph is ready, 503 while indexing
    if (pathname === "/api/ready" && req.method === "GET") {
      if (this.ready) {
        return { statusCode: 200, headers: {}, body: { ready: true } };
      }
      return { statusCode: 503, headers: {}, body: { ready: false, reason: "indexing" } };
    }

    // Parse body for POST requests
    let body: any = null;
    if (req.method === "POST") {
      body = await this.parseBody(req);
    }

    // --- Versioned routes: /api/v1/* ---

    // Health endpoint (versioned)
    if (pathname === "/api/v1/health" && req.method === "GET") {
      if (this.degradedState.degraded) {
        return {
          statusCode: 200,
          headers: {},
          body: { status: "degraded", reasons: this.degradedState.reasons },
        };
      }
      return {
        statusCode: 200,
        headers: {},
        body: { status: "ok" },
      };
    }

    // Diagnostics endpoint
    if (pathname === "/api/v1/diag" && req.method === "GET") {
      return await this.handleDiag();
    }

    // Route handling — all under /api/v1/mcp/*
    if (pathname === "/api/v1/mcp/graph" && req.method === "GET") {
      return this.handleExportGraph(url.searchParams);
    }

    if (pathname === "/api/v1/mcp/clusters" && req.method === "GET") {
      return this.handleGetClusters();
    }

    if (pathname.startsWith("/api/v1/mcp/function/") && req.method === "GET") {
      const functionName = decodeURIComponent(pathname.split("/api/v1/mcp/function/")[1]);
      return this.handleFunctionContext(functionName, url.searchParams);
    }

    if (pathname === "/api/v1/mcp/function" && req.method === "POST") {
      return this.handleFunctionContextPost(body);
    }

    if (pathname.startsWith("/api/v1/mcp/file/") && pathname.endsWith("/dependents") && req.method === "GET") {
      const pathParts = pathname.split("/api/v1/mcp/file/")[1].split("/dependents")[0];
      const filePath = decodeURIComponent(pathParts);
      return this.handleFileDependents(filePath, url.searchParams);
    }

    if (pathname === "/api/v1/mcp/dependents" && req.method === "POST") {
      return this.handleFileDependentsPost(body);
    }

    if (pathname.startsWith("/api/v1/mcp/symbol/") && pathname.endsWith("/references") && req.method === "GET") {
      const pathParts = pathname.split("/api/v1/mcp/symbol/")[1].split("/references")[0];
      const symbolName = decodeURIComponent(pathParts);
      return this.handleSymbolReferences(symbolName, url.searchParams);
    }

    if (pathname === "/api/v1/mcp/references" && req.method === "POST") {
      return this.handleSymbolReferencesPost(body);
    }

    // --- get_callers endpoints ---
    if (pathname.startsWith("/api/v1/mcp/callers/") && req.method === "GET") {
      const functionName = decodeURIComponent(pathname.split("/api/v1/mcp/callers/")[1]);
      return this.handleGetCallers(functionName, url.searchParams);
    }

    if (pathname === "/api/v1/mcp/callers" && req.method === "POST") {
      return this.handleGetCallersPost(body);
    }

    // --- get_call_chain endpoints ---
    if (pathname.startsWith("/api/v1/mcp/call-chain/") && req.method === "GET") {
      const functionName = decodeURIComponent(pathname.split("/api/v1/mcp/call-chain/")[1]);
      return this.handleGetCallChain(functionName, url.searchParams);
    }

    if (pathname === "/api/v1/mcp/call-chain" && req.method === "POST") {
      return this.handleGetCallChainPost(body);
    }

    // --- get_dead_code endpoints ---
    if (pathname === "/api/v1/mcp/dead-code" && req.method === "GET") {
      return this.handleGetDeadCode(url.searchParams);
    }

    if (pathname === "/api/v1/mcp/dead-code" && req.method === "POST") {
      return this.handleGetDeadCodePost(body);
    }

    // --- get_hotspots endpoints ---
    if (pathname === "/api/v1/mcp/hotspots" && req.method === "GET") {
      return this.handleGetHotspots(url.searchParams);
    }

    if (pathname === "/api/v1/mcp/hotspots" && req.method === "POST") {
      return this.handleGetHotspotsPost(body);
    }

    // --- get_impact_analysis endpoints ---
    if (pathname.startsWith("/api/v1/mcp/impact/") && req.method === "GET") {
      const filePath = decodeURIComponent(pathname.split("/api/v1/mcp/impact/")[1]);
      return this.handleGetImpactAnalysis(filePath, url.searchParams);
    }

    if (pathname === "/api/v1/mcp/impact" && req.method === "POST") {
      return this.handleGetImpactAnalysisPost(body);
    }

    // --- get_module_coupling endpoints ---
    if (pathname.startsWith("/api/v1/mcp/coupling/") && req.method === "GET") {
      // URL pattern: /api/v1/mcp/coupling/:filePathA/:filePathB
      const rest = pathname.slice("/api/v1/mcp/coupling/".length);
      const segments = rest.split("/");
      if (segments.length >= 2) {
        const filePathA = decodeURIComponent(segments[0]);
        const filePathB = decodeURIComponent(segments.slice(1).join("/"));
        return this.handleGetModuleCoupling(filePathA, filePathB, url.searchParams);
      }
    }

    if (pathname === "/api/v1/mcp/coupling" && req.method === "POST") {
      return this.handleGetModuleCouplingPost(body);
    }

    // --- get_class_hierarchy endpoints ---
    if (pathname.startsWith("/api/v1/mcp/class-hierarchy/") && req.method === "GET") {
      const className = decodeURIComponent(pathname.split("/api/v1/mcp/class-hierarchy/")[1]);
      return this.handleGetClassHierarchy(className, url.searchParams);
    }

    if (pathname === "/api/v1/mcp/class-hierarchy" && req.method === "POST") {
      return this.handleGetClassHierarchyPost(body);
    }

    // --- search_symbols endpoints ---
    if (pathname === "/api/v1/mcp/search" && req.method === "GET") {
      return this.handleSearchSymbols(url.searchParams);
    }

    if (pathname === "/api/v1/mcp/search" && req.method === "POST") {
      return this.handleSearchSymbolsPost(body);
    }

    // --- get_circular_dependencies endpoints ---
    if (pathname === "/api/v1/mcp/circular-deps" && req.method === "GET") {
      return this.handleGetCircularDeps(url.searchParams);
    }

    if (pathname === "/api/v1/mcp/circular-deps" && req.method === "POST") {
      return this.handleGetCircularDepsPost(body);
    }

    // --- get_complexity_metrics endpoints ---
    if (pathname === "/api/v1/mcp/complexity" && req.method === "GET") {
      return this.handleGetComplexity(url.searchParams);
    }

    if (pathname === "/api/v1/mcp/complexity" && req.method === "POST") {
      return this.handleGetComplexityPost(body);
    }

    // --- get_change_risk endpoints ---
    if (pathname === "/api/v1/mcp/change-risk" && req.method === "GET") {
      return this.handleGetChangeRisk(url.searchParams);
    }

    if (pathname === "/api/v1/mcp/change-risk" && req.method === "POST") {
      return this.handleGetChangeRiskPost(body);
    }

    // --- get_unresolved_imports endpoint ---
    if (pathname === "/api/v1/mcp/unresolved_imports" && req.method === "GET") {
      return this.handleGetUnresolvedImports(url.searchParams);
    }

    return {
      statusCode: 404,
      headers: {},
      body: { error: "Not found" },
    };
  }

  private async handleDiag(): Promise<ApiResponse> {
    const { pythonPatterns, tsPatterns } = resolveGlobPatterns();
    const resolvedIgnores = resolveIgnorePatterns();
    const filePaths = this.graphStore.getIndexedFilePaths();

    let python = 0;
    let ts = 0;
    for (const fp of filePaths) {
      const lang = detectLanguage(fp);
      if (lang === "python") python++;
      else if (lang === "typescript") ts++;
    }

    // Count files per cluster
    const clusterHits: Record<string, number> = {};
    for (const fp of filePaths) {
      const cluster = this.clusterConfig.getClusterForFile(fp);
      if (cluster?.id) {
        clusterHits[cluster.id] = (clusterHits[cluster.id] ?? 0) + 1;
      }
    }

    // Import resolution summary
    const importSummary = this.graphStore.getUnresolvedSummary();
    const { resolvedEdges, unresolvedSpecifiers, skippedExternals, topUnresolvedReasons } = importSummary;

    // Degraded: high unresolved ratio (>25% with n>10)
    const degradedReasons = [...this.degradedState.reasons];
    const total = resolvedEdges + unresolvedSpecifiers;
    if (unresolvedSpecifiers > 10 && total > 0 && unresolvedSpecifiers / total > 0.25) {
      if (!degradedReasons.includes("high-unresolved-import-ratio")) {
        degradedReasons.push("high-unresolved-import-ratio");
      }
    }

    // Memory diagnostics
    const memUsage = process.memoryUsage();
    const toMb = (bytes: number) => Math.round(bytes / 1024 / 1024);
    const rssMb = toMb(memUsage.rss);
    const heapUsedMb = toMb(memUsage.heapUsed);
    const heapTotalMb = toMb(memUsage.heapTotal);
    const externalMb = toMb(memUsage.external);
    // Effective heap limit: use v8.getHeapStatistics if available, else heapTotal
    let heapLimitMb = heapTotalMb;
    try {
      const v8 = await import("node:v8");
      const stats = v8.getHeapStatistics();
      if (stats.heap_size_limit > 0) {
        heapLimitMb = toMb(stats.heap_size_limit);
      }
    } catch {
      // v8 not available — fall back to heapTotal
    }
    const memoryDegraded = heapLimitMb > 0 && heapUsedMb / heapLimitMb > 0.85;
    if (memoryDegraded && !degradedReasons.includes("high-heap-usage")) {
      degradedReasons.push("high-heap-usage");
    }

    const degraded = this.degradedState.degraded || degradedReasons.length > this.degradedState.reasons.length;

    return {
      statusCode: 200,
      headers: {},
      body: {
        workspaceRoot: this.workspaceRoot,
        resolvedPythonGlobs: pythonPatterns,
        resolvedTsGlobs: tsPatterns,
        resolvedIgnores,
        fileCount: { total: filePaths.length, python, ts },
        clusterHits,
        importResolution: {
          resolvedEdges,
          unresolvedSpecifiers,
          skippedExternals,
          topUnresolvedReasons,
        },
        memory: {
          rssMb,
          heapUsedMb,
          heapTotalMb,
          heapLimitMb,
          external: externalMb,
          degraded: memoryDegraded,
        },
        degraded,
        reasons: degradedReasons,
      },
    };
  }

  private handleGetUnresolvedImports(params: URLSearchParams): ApiResponse {
    const filePattern = params.get("file_pattern") ?? undefined;
    const limitParam = params.get("limit");
    const reasonFilter = params.get("reason") ?? undefined;
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 200, 1000) : 200;

    if (filePattern) {
      try { validateGlob(filePattern); } catch (e) { return toolInputErrorResponse(e as ToolInputError); }
    }

    let entries = this.graphStore.getUnresolvedImports(filePattern);

    if (reasonFilter) {
      entries = entries
        .map(({ filePath, unresolved }) => ({
          filePath,
          unresolved: unresolved.filter((u) => u.reason === reasonFilter),
        }))
        .filter(({ unresolved }) => unresolved.length > 0);
    }

    const totalFiles = entries.length;
    const totalSpecifiers = entries.reduce((sum, e) => sum + e.unresolved.length, 0);
    const truncated = entries.length > limit;
    const sliced = entries.slice(0, limit);

    return {
      statusCode: 200,
      headers: {},
      body: { totalFiles, totalSpecifiers, entries: sliced, truncated },
    };
  }

  private handleGetClusters(): ApiResponse {
    return {
      statusCode: 200,
      headers: {},
      body: {
        clusters: this.clusterConfig.getClusters().map((c) => ({
          id: c.id,
          path: c.path,
          label: c.label,
          color: c.color,
        })),
      },
    };
  }

  /**
   * Mark indexing as complete so that late-connecting SSE clients
   * receive an immediate `indexing-complete` event after `connected`.
   */
  markIndexingComplete(indexedFiles: number): void {
    this.indexingState = { complete: true, indexedFiles };
  }

  /** Store the resolved workspace root for the /api/v1/diag endpoint. */
  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  /** Set readiness state (false = indexing in progress, true = graph ready). */
  setReady(flag: boolean): void {
    this.ready = flag;
  }

  /** Returns true once the initial graph build has completed. */
  isReady(): boolean {
    return this.ready;
  }

  /** Update degraded state (called after initial index). */
  setDegradedState(degraded: boolean, reasons: string[]): void {
    this.degradedState = { degraded, reasons };
  }

  private handleSSEConnection(_req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

    // If indexing already finished, immediately notify the late-connecting client
    if (this.indexingState.complete) {
      res.write(
        `event: indexing-complete\ndata: ${JSON.stringify({
          indexedFiles: this.indexingState.indexedFiles,
          timestamp: Date.now(),
        })}\n\n`,
      );
    }

    this.sseClients.add(res);
    console.error(`[http-api] SSE client connected (total: ${this.sseClients.size})`);

    _req.on("close", () => {
      this.sseClients.delete(res);
      console.error(`[http-api] SSE client disconnected (total: ${this.sseClients.size})`);
    });
  }

  broadcastSSE(event: string, data: object): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(message);
      } catch {
        // Client disconnected — will be cleaned up on 'close' event
        this.sseClients.delete(client);
      }
    }
  }

  private async handleGetCallers(functionName: string, params: URLSearchParams): Promise<ApiResponse> {
    const filePath = params.get("file_path") || params.get("filePath") || undefined;
    const maxDepth = parseInt(params.get("max_depth") || params.get("maxDepth") || "3", 10);
    const maxResults = parseInt(params.get("max_results") || params.get("maxResults") || "100", 10);

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getCallers({
        functionName,
        filePath,
        maxDepth,
        maxResults,
        signal,
      });
      return result;
    });
  }

  private async handleGetCallersPost(body: any): Promise<ApiResponse> {
    const functionName = body.function_name || body.functionName;
    if (!functionName) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "function_name is required", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getCallers({
        functionName,
        filePath: body.file_path || body.filePath,
        maxDepth: body.max_depth || body.maxDepth || 3,
        maxResults: body.max_results || body.maxResults || 100,
        signal,
      });
      return result;
    });
  }

  private async handleGetCallChain(functionName: string, params: URLSearchParams): Promise<ApiResponse> {
    const filePath = params.get("file_path") || params.get("filePath") || undefined;
    const direction = (params.get("direction") || "both") as "upstream" | "downstream" | "both";
    const maxDepth = parseInt(params.get("max_depth") || params.get("maxDepth") || "5", 10);
    const maxNodes = parseInt(params.get("max_nodes") || params.get("maxNodes") || "200", 10);

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getCallChain({
        functionName,
        filePath,
        direction,
        maxDepth,
        maxNodes,
        signal,
      });
      return result;
    });
  }

  private async handleGetCallChainPost(body: any): Promise<ApiResponse> {
    const functionName = body.function_name || body.functionName;
    if (!functionName) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "function_name is required", code: "INVALID_PARAMS", retryable: false },
      };
    }

    const direction = body.direction || "both";
    if (!["upstream", "downstream", "both"].includes(direction)) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "direction must be 'upstream', 'downstream', or 'both'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getCallChain({
        functionName,
        filePath: body.file_path || body.filePath,
        direction,
        maxDepth: body.max_depth || body.maxDepth || 5,
        maxNodes: body.max_nodes || body.maxNodes || 200,
        signal,
      });
      return result;
    });
  }

  private async handleGetDeadCode(params: URLSearchParams): Promise<ApiResponse> {
    const filePattern = params.get("file_pattern") || params.get("filePattern") || undefined;
    const language = (params.get("language") || undefined) as "python" | "typescript" | undefined;
    const kind = (params.get("kind") || undefined) as "function" | "class" | undefined;
    const maxResults = parseInt(params.get("max_results") || params.get("maxResults") || "100", 10);

    if (filePattern) {
      try { validateGlob(filePattern); } catch (e) { return toolInputErrorResponse(e as ToolInputError); }
    }

    if (language && language !== "python" && language !== "typescript") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "language must be 'python' or 'typescript'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    if (kind && kind !== "function" && kind !== "class") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "kind must be 'function' or 'class'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getDeadCode({
        filePattern,
        language,
        kind,
        maxResults,
        signal,
      });
      const body: any = result;
      if (filePattern && result.totalScanned === 0) {
        body.reason = zeroFilesReason(filePattern, "file_pattern");
      }
      return body;
    });
  }

  private async handleGetDeadCodePost(body: any): Promise<ApiResponse> {
    const language = body.language || undefined;
    const kind = body.kind || undefined;
    const filePattern: string | undefined = body.file_pattern || body.filePattern || undefined;

    if (filePattern) {
      try { validateGlob(filePattern); } catch (e) { return toolInputErrorResponse(e as ToolInputError); }
    }

    if (language && language !== "python" && language !== "typescript") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "language must be 'python' or 'typescript'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    if (kind && kind !== "function" && kind !== "class") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "kind must be 'function' or 'class'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getDeadCode({
        filePattern: body.file_pattern || body.filePattern,
        language,
        kind,
        maxResults: body.max_results || body.maxResults || 100,
        signal,
      });
      const resp: any = result;
      if (filePattern && result.totalScanned === 0) {
        resp.reason = zeroFilesReason(filePattern, "file_pattern");
      }
      return resp;
    });
  }

  private async handleGetHotspots(params: URLSearchParams): Promise<ApiResponse> {
    const topN = parseInt(params.get("top_n") || params.get("topN") || "20", 10);
    const kind = (params.get("kind") || undefined) as "function" | "class" | "variable" | undefined;
    const language = (params.get("language") || undefined) as "python" | "typescript" | undefined;
    const filePattern = params.get("file_pattern") || params.get("filePattern") || undefined;

    if (filePattern) {
      try { validateGlob(filePattern); } catch (e) { return toolInputErrorResponse(e as ToolInputError); }
    }

    if (language && language !== "python" && language !== "typescript") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "language must be 'python' or 'typescript'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    if (kind && kind !== "function" && kind !== "class" && kind !== "variable") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "kind must be 'function', 'class', or 'variable'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getHotspots({
        topN,
        kind,
        language,
        filePattern,
        signal,
      });
      return result;
    });
  }

  private async handleGetHotspotsPost(body: any): Promise<ApiResponse> {
    const language = body.language || undefined;
    const kind = body.kind || undefined;
    const filePattern: string | undefined = body.file_pattern || body.filePattern || undefined;

    if (filePattern) {
      try { validateGlob(filePattern); } catch (e) { return toolInputErrorResponse(e as ToolInputError); }
    }

    if (language && language !== "python" && language !== "typescript") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "language must be 'python' or 'typescript'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    if (kind && kind !== "function" && kind !== "class" && kind !== "variable") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "kind must be 'function', 'class', or 'variable'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getHotspots({
        topN: body.top_n || body.topN || 20,
        kind,
        language,
        filePattern: body.file_pattern || body.filePattern,
        includeEdgeTypes: body.include_edge_types || body.includeEdgeTypes,
        signal,
      });
      return result;
    });
  }

  private async handleGetImpactAnalysis(filePath: string, params: URLSearchParams): Promise<ApiResponse> {
    if (!filePath) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "file_path is required", code: "INVALID_PARAMS", retryable: false },
      };
    }

    const maxDepth = parseInt(params.get("max_depth") || params.get("maxDepth") || "3", 10);
    const maxFiles = parseInt(params.get("max_files") || params.get("maxFiles") || "100", 10);

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getImpactAnalysis({
        filePath,
        maxDepth,
        maxFiles,
        signal,
      });
      return result;
    });
  }

  private async handleGetImpactAnalysisPost(body: any): Promise<ApiResponse> {
    const filePath = body.file_path || body.filePath;
    if (!filePath) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "file_path is required", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getImpactAnalysis({
        filePath,
        maxDepth: body.max_depth || body.maxDepth || 3,
        maxFiles: body.max_files || body.maxFiles || 100,
        signal,
      });
      return result;
    });
  }

  private async handleGetModuleCoupling(filePathA: string, filePathB: string, params: URLSearchParams): Promise<ApiResponse> {
    const maxDepth = parseInt(params.get("max_depth") || params.get("maxDepth") || "2", 10);

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getModuleCoupling({
        filePathA,
        filePathB,
        maxDepth,
        signal,
      });
      return result;
    });
  }

  private async handleGetModuleCouplingPost(body: any): Promise<ApiResponse> {
    const filePathA = body.file_path_a || body.filePathA;
    const filePathB = body.file_path_b || body.filePathB;
    if (!filePathA || !filePathB) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "file_path_a and file_path_b are required", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getModuleCoupling({
        filePathA,
        filePathB,
        maxDepth: body.max_depth || body.maxDepth || 2,
        signal,
      });
      return result;
    });
  }

  private async handleGetClassHierarchy(className: string, params: URLSearchParams): Promise<ApiResponse> {
    if (!className) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "class_name is required", code: "INVALID_PARAMS", retryable: false },
      };
    }

    const filePath = params.get("file_path") || params.get("filePath") || undefined;
    const direction = (params.get("direction") || "both") as "ancestors" | "descendants" | "both";
    const maxDepth = parseInt(params.get("max_depth") || params.get("maxDepth") || "5", 10);

    if (direction && !["ancestors", "descendants", "both"].includes(direction)) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "direction must be 'ancestors', 'descendants', or 'both'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getClassHierarchy({
        className,
        filePath,
        direction,
        maxDepth,
        signal,
      });
      return result;
    });
  }

  private async handleGetClassHierarchyPost(body: any): Promise<ApiResponse> {
    const className = body.class_name || body.className;
    if (!className) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "class_name is required", code: "INVALID_PARAMS", retryable: false },
      };
    }

    const direction = body.direction || "both";
    if (!["ancestors", "descendants", "both"].includes(direction)) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "direction must be 'ancestors', 'descendants', or 'both'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getClassHierarchy({
        className,
        filePath: body.file_path || body.filePath,
        direction,
        maxDepth: body.max_depth || body.maxDepth || 5,
        signal,
      });
      return result;
    });
  }

  private async handleSearchSymbols(params: URLSearchParams): Promise<ApiResponse> {
    const query = params.get("query") || "";
    if (!query) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "query is required", code: "INVALID_PARAMS", retryable: false },
      };
    }

    const kind = (params.get("kind") || undefined) as "file" | "module" | "function" | "class" | "variable" | "external" | undefined;
    const language = (params.get("language") || undefined) as "python" | "typescript" | undefined;
    const filePattern = params.get("file_pattern") || params.get("filePattern") || undefined;
    const useRegex = params.get("use_regex") === "true" || params.get("useRegex") === "true";
    const maxResults = parseInt(params.get("max_results") || params.get("maxResults") || "50", 10);

    if (filePattern) {
      try { validateGlob(filePattern); } catch (e) { return toolInputErrorResponse(e as ToolInputError); }
    }
    if (useRegex) {
      try { validateRegex(query); } catch (e) { return toolInputErrorResponse(e as ToolInputError); }
    }

    if (language && language !== "python" && language !== "typescript") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "language must be 'python' or 'typescript'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.searchSymbols({
        query,
        kind,
        language,
        filePattern,
        useRegex,
        maxResults,
        signal,
      });
      return result;
    });
  }

  private async handleSearchSymbolsPost(body: any): Promise<ApiResponse> {
    const query = body.query;
    if (!query) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "query is required", code: "INVALID_PARAMS", retryable: false },
      };
    }

    const language = body.language || undefined;
    const kind = body.kind || undefined;
    const filePattern: string | undefined = body.file_pattern || body.filePattern || undefined;
    const useRegex: boolean = body.use_regex ?? body.useRegex ?? false;

    if (filePattern) {
      try { validateGlob(filePattern); } catch (e) { return toolInputErrorResponse(e as ToolInputError); }
    }
    if (useRegex) {
      try { validateRegex(query); } catch (e) { return toolInputErrorResponse(e as ToolInputError); }
    }

    if (language && language !== "python" && language !== "typescript") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "language must be 'python' or 'typescript'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.searchSymbols({
        query,
        kind,
        language,
        filePattern,
        useRegex,
        maxResults: body.max_results || body.maxResults || 50,
        signal,
      });
      return result;
    });
  }

  private async handleGetCircularDeps(params: URLSearchParams): Promise<ApiResponse> {
    const filePattern = params.get("file_pattern") || params.get("filePattern") || undefined;
    const language = (params.get("language") || undefined) as "python" | "typescript" | undefined;
    const maxCycles = parseInt(params.get("max_cycles") || params.get("maxCycles") || "50", 10);
    const maxDepth = parseInt(params.get("max_depth") || params.get("maxDepth") || "20", 10);

    if (filePattern) {
      try { validateGlob(filePattern); } catch (e) { return toolInputErrorResponse(e as ToolInputError); }
    }

    if (language && language !== "python" && language !== "typescript") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "language must be 'python' or 'typescript'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getCircularDependencies({
        filePattern,
        language,
        maxCycles,
        maxDepth,
        signal,
      });
      const resp: any = result;
      if (filePattern && result.totalFilesScanned === 0) {
        resp.reason = zeroFilesReason(filePattern, "file_pattern");
      }
      return resp;
    });
  }

  private async handleGetCircularDepsPost(body: any): Promise<ApiResponse> {
    const language = body.language || undefined;
    const filePattern: string | undefined = body.file_pattern || body.filePattern || undefined;

    if (filePattern) {
      try { validateGlob(filePattern); } catch (e) { return toolInputErrorResponse(e as ToolInputError); }
    }

    if (language && language !== "python" && language !== "typescript") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "language must be 'python' or 'typescript'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getCircularDependencies({
        filePattern,
        language,
        maxCycles: body.max_cycles || body.maxCycles || 50,
        maxDepth: body.max_depth || body.maxDepth || 20,
        signal,
      });
      return result;
    });
  }

  private async handleGetComplexity(params: URLSearchParams): Promise<ApiResponse> {
    const filePath = params.get("file_path") || params.get("filePath") || undefined;
    const kind = (params.get("kind") || undefined) as "function" | "class" | "file" | undefined;
    const language = (params.get("language") || undefined) as "python" | "typescript" | undefined;
    const sortBy = (params.get("sort_by") || params.get("sortBy") || "total") as "fan_in" | "fan_out" | "depth" | "total";
    const maxResults = parseInt(params.get("max_results") || params.get("maxResults") || "100", 10);

    if (filePath) {
      try { validateGlob(filePath); } catch (e) { return toolInputErrorResponse(e as ToolInputError); }
    }

    if (language && language !== "python" && language !== "typescript") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "language must be 'python' or 'typescript'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    if (kind && kind !== "function" && kind !== "class" && kind !== "file") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "kind must be 'function', 'class', or 'file'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    if (sortBy && !["fan_in", "fan_out", "depth", "total"].includes(sortBy)) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "sort_by must be 'fan_in', 'fan_out', 'depth', or 'total'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getComplexityMetrics({
        filePath,
        kind,
        language,
        sortBy,
        maxResults,
        signal,
      });
      // Apply transformNode to each metric's node for frontend compatibility
      const resp: any = {
        metrics: result.metrics.map((m) => ({
          node: transformNode(m.node),
          fanIn: m.fanIn,
          fanOut: m.fanOut,
          maxDepth: m.maxDepth,
          totalComplexity: m.totalComplexity,
        })),
        totalScanned: result.totalScanned,
        truncated: result.truncated,
      };
      if (filePath && result.totalScanned === 0) {
        resp.reason = zeroFilesReason(filePath, "file_path");
      }
      return resp;
    });
  }

  private async handleGetComplexityPost(body: any): Promise<ApiResponse> {
    const language = body.language || undefined;
    const kind = body.kind || undefined;
    const sortBy = body.sort_by || body.sortBy || "total";
    const filePath: string | undefined = body.file_path || body.filePath || undefined;

    if (language && language !== "python" && language !== "typescript") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "language must be 'python' or 'typescript'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    if (kind && kind !== "function" && kind !== "class" && kind !== "file") {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "kind must be 'function', 'class', or 'file'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    if (sortBy && !["fan_in", "fan_out", "depth", "total"].includes(sortBy)) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "sort_by must be 'fan_in', 'fan_out', 'depth', or 'total'", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getComplexityMetrics({
        filePath,
        kind,
        language,
        sortBy,
        maxResults: body.max_results || body.maxResults || 100,
        signal,
      });
      // Apply transformNode to each metric's node for frontend compatibility
      return {
        metrics: result.metrics.map((m) => ({
          node: transformNode(m.node),
          fanIn: m.fanIn,
          fanOut: m.fanOut,
          maxDepth: m.maxDepth,
          totalComplexity: m.totalComplexity,
        })),
        totalScanned: result.totalScanned,
        truncated: result.truncated,
      };
    });
  }

  private async handleGetChangeRisk(params: URLSearchParams): Promise<ApiResponse> {
    const changedFilesRaw = params.get("changed_files") || params.get("changedFiles") || "";
    if (!changedFilesRaw) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "changed_files is required", code: "INVALID_PARAMS", retryable: false },
      };
    }

    const changedFiles = changedFilesRaw.split(",").map((f) => f.trim()).filter(Boolean);
    if (changedFiles.length === 0) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "changed_files must contain at least one file path", code: "INVALID_PARAMS", retryable: false },
      };
    }

    const maxDepth = parseInt(params.get("max_depth") || params.get("maxDepth") || "3", 10);
    const maxFiles = parseInt(params.get("max_files") || params.get("maxFiles") || "100", 10);

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getChangeRisk({
        changedFiles,
        maxDepth,
        maxFiles,
        signal,
      });
      // Apply transformNode to hotspotOverlap nodes for frontend compatibility
      return {
        ...result,
        hotspotOverlap: result.hotspotOverlap.map((h) => ({
          node: transformNode(h.node),
          fanIn: h.fanIn,
        })),
      };
    });
  }

  private async handleGetChangeRiskPost(body: any): Promise<ApiResponse> {
    const changedFiles = body.changed_files || body.changedFiles;
    if (!changedFiles || !Array.isArray(changedFiles) || changedFiles.length === 0) {
      return {
        statusCode: 400,
        headers: {},
        body: { error: "changed_files must be a non-empty array of file paths", code: "INVALID_PARAMS", retryable: false },
      };
    }

    return this.executeQuery(async (signal) => {
      const result = this.graphStore.getChangeRisk({
        changedFiles,
        maxDepth: body.max_depth || body.maxDepth || 3,
        maxFiles: body.max_files || body.maxFiles || 100,
        signal,
      });
      // Apply transformNode to hotspotOverlap nodes for frontend compatibility
      return {
        ...result,
        hotspotOverlap: result.hotspotOverlap.map((h) => ({
          node: transformNode(h.node),
          fanIn: h.fanIn,
        })),
      };
    });
  }

  private async parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk.toString();
      });
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (error) {
          reject(new Error("Invalid JSON"));
        }
      });
      req.on("error", reject);
    });
  }

  /**
   * Wraps a query handler with timeout + retry logic.
   * On `QueryTimeoutError`, retries up to MAX_RETRIES times with RETRY_BACKOFF_MS backoff.
   * Returns HTTP 504 if all retries fail.
   *
   * This is used by new query endpoints (Tracks 3-6). Existing endpoints are NOT wrapped
   * to maintain backward compatibility.
   */
  async executeQuery<T>(
    handler: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number = HttpApiServer.DEFAULT_TIMEOUT_MS,
  ): Promise<ApiResponse> {
    try {
      const result = await withRetry(
        () => withTimeout(handler, timeoutMs),
        HttpApiServer.MAX_RETRIES,
        HttpApiServer.RETRY_BACKOFF_MS,
      );
      return {
        statusCode: 200,
        headers: {},
        body: result,
      };
    } catch (error) {
      const statusCode = errorStatusCode(error);
      const body = buildErrorResponse(error);
      console.error(`[http-api] query error (${body.code}): ${body.error}`);
      return {
        statusCode,
        headers: {},
        body,
      };
    }
  }

  private handleExportGraph(params: URLSearchParams): ApiResponse {
    const scope = (params.get("scope") || "repo") as "repo" | "file" | "symbol";
    const filePath = params.get("file_path") || params.get("filePath") || undefined;
    const symbolQualifiedName = params.get("symbol_qualified_name") || params.get("symbolQualifiedName") || undefined;
    const maxNodes = parseInt(params.get("max_nodes") || params.get("maxNodes") || "0", 10) || Infinity;
    const maxEdges = parseInt(params.get("max_edges") || params.get("maxEdges") || "0", 10) || Infinity;

    const result = this.graphStore.exportDependencyGraph({
      scope,
      filePath,
      symbolQualifiedName,
      maxNodes,
      maxEdges,
    });

    // Collect all file paths for geographic mapping
    const allFilePaths = result.graph.nodes
      .filter((n) => n.filePath)
      .map((n) => n.filePath!);

    // Transform and augment nodes with geographic data
    const transformedNodes = result.graph.nodes.map((node) => {
      const base = transformNode(node);

      if (node.filePath) {
        const relativePath = toRelativePath(node.filePath);
        const cluster = this.clusterConfig.getClusterForFile(relativePath);
        const coords = mapFileToCoordinates(node.filePath, cluster.path, allFilePaths);
        return {
          ...base,
          lat: coords.lat,
          lng: coords.lng,
          clusterId: cluster.id,
        };
      }

      return base;
    });

    // Build nodeId → clusterId map for cross-cluster edge detection
    const nodeClusterMap = new Map<string, string>();
    for (const node of transformedNodes) {
      if (node.clusterId) nodeClusterMap.set(node.id, node.clusterId);
    }

    // Transform edges with cross-cluster tagging
    const transformedEdges = result.graph.edges.map((edge) => {
      const base = transformEdge(edge);
      const srcCluster = nodeClusterMap.get(base.source);
      const tgtCluster = nodeClusterMap.get(base.target);
      return {
        ...base,
        isCrossCluster: Boolean(srcCluster && tgtCluster && srcCluster !== tgtCluster),
      };
    });

    return {
      statusCode: 200,
      headers: {},
      body: {
        nodes: transformedNodes,
        edges: transformedEdges,
        meta: result.meta,
        clusterMeta: this.clusterConfig.getClusters(),
      },
    };
  }

  private handleFunctionContext(functionName: string, params: URLSearchParams): ApiResponse {
    const result = this.graphStore.getFunctionContext({
      functionName,
      filePath: params.get("file_path") || params.get("filePath") || undefined,
      maxHops: parseInt(params.get("max_hops") || params.get("maxHops") || "2", 10),
      includeEdgeTypes: undefined,
      maxNodes: parseInt(params.get("max_nodes") || params.get("maxNodes") || "150", 10),
    });

    // Transform and return with nodes and edges at the top level
    return {
      statusCode: 200,
      headers: {},
      body: {
        centerNode: result.root ? transformNode(result.root) : null,
        nodes: result.neighborhood.nodes.map(transformNode),
        edges: result.neighborhood.edges.map(transformEdge),
        relatedFiles: result.relatedFiles,
        truncated: result.truncated,
      },
    };
  }

  private handleFunctionContextPost(body: any): ApiResponse {
    const result = this.graphStore.getFunctionContext({
      functionName: body.function_name || body.functionName,
      filePath: body.file_path || body.filePath,
      maxHops: body.max_hops || body.maxHops || 2,
      includeEdgeTypes: body.include_edge_types || body.includeEdgeTypes,
      maxNodes: body.max_nodes || body.maxNodes || 150,
    });

    // Transform and return with nodes and edges at the top level
    return {
      statusCode: 200,
      headers: {},
      body: {
        centerNode: result.root ? transformNode(result.root) : null,
        nodes: result.neighborhood.nodes.map(transformNode),
        edges: result.neighborhood.edges.map(transformEdge),
        relatedFiles: result.relatedFiles,
        truncated: result.truncated,
      },
    };
  }

  private handleFileDependents(filePath: string, params: URLSearchParams): ApiResponse {
    const result = this.graphStore.getFileDependents({
      filePath,
      direction: (params.get("direction") || "incoming") as "incoming" | "outgoing" | "both",
      depth: parseInt(params.get("depth") || "1", 10),
      maxFiles: parseInt(params.get("max_files") || params.get("maxFiles") || "200", 10),
    });

    // Transform to match frontend schema
    return {
      statusCode: 200,
      headers: {},
      body: {
        files: result.dependents.map((d) => d.filePath),
        dependencies: result.dependents.map((d) => ({
          filePath: d.filePath,
          dependencyType: d.relationType,
          metadata: {
            depth: d.depth,
          },
        })),
        summary: result.summary,
      },
    };
  }

  private handleFileDependentsPost(body: any): ApiResponse {
    const result = this.graphStore.getFileDependents({
      filePath: body.file_path || body.filePath,
      direction: body.direction || "incoming",
      depth: body.depth || 1,
      maxFiles: body.max_files || body.maxFiles || 200,
    });

    // Transform to match frontend schema
    return {
      statusCode: 200,
      headers: {},
      body: {
        files: result.dependents.map((d) => d.filePath),
        dependencies: result.dependents.map((d) => ({
          filePath: d.filePath,
          dependencyType: d.relationType,
          metadata: {
            depth: d.depth,
          },
        })),
        summary: result.summary,
      },
    };
  }

  private handleSymbolReferences(symbolName: string, params: URLSearchParams): ApiResponse {
    const result = this.graphStore.getSymbolReferences({
      symbolQualifiedName: symbolName,
      includeReads: params.get("include_reads") !== "false" && params.get("includeReads") !== "false",
      includeWrites: params.get("include_writes") !== "false" && params.get("includeWrites") !== "false",
      includeCalls: params.get("include_calls") !== "false" && params.get("includeCalls") !== "false",
      maxResults: parseInt(params.get("max_results") || params.get("maxResults") || "300", 10),
    });

    // Transform to match frontend schema
    return {
      statusCode: 200,
      headers: {},
      body: {
        symbol: result.symbol ? transformNode(result.symbol) : null,
        references: result.references.map((ref) => {
          const [lineCol, _] = ref.range.split("-");
          const [line, column] = lineCol.split(":").map(Number);
          return {
            filePath: ref.filePath,
            line: line || 1,
            column: column || 1,
            referenceType: ref.edgeType === "calls" ? "call" : ref.edgeType === "writes" ? "write" : "read",
            context: ref.contextSnippet,
          };
        }),
        truncated: result.truncated,
      },
    };
  }

  private handleSymbolReferencesPost(body: any): ApiResponse {
    const result = this.graphStore.getSymbolReferences({
      symbolQualifiedName: body.symbol_qualified_name || body.symbolName,
      includeReads: body.include_reads !== false && body.includeReads !== false,
      includeWrites: body.include_writes !== false && body.includeWrites !== false,
      includeCalls: body.include_calls !== false && body.includeCalls !== false,
      maxResults: body.max_results || body.maxResults || 300,
    });

    // Transform to match frontend schema
    return {
      statusCode: 200,
      headers: {},
      body: {
        symbol: result.symbol ? transformNode(result.symbol) : null,
        references: result.references.map((ref) => {
          const [lineCol, _] = ref.range.split("-");
          const [line, column] = lineCol.split(":").map(Number);
          return {
            filePath: ref.filePath,
            line: line || 1,
            column: column || 1,
            referenceType: ref.edgeType === "calls" ? "call" : ref.edgeType === "writes" ? "write" : "read",
            context: ref.contextSnippet,
          };
        }),
        truncated: result.truncated,
      },
    };
  }
}
