# MCP Context Manager — Internals (Layer 3, on-demand)

> Mechanism-level reference extracted from the old 800-line steering file. Load a
> section only when your task touches it. Much detail already lives in the
> sibling docs below — this file is the index + the architecture/schema spec.

## Existing reference docs (load the one you need)
- **API.md** — HTTP endpoint reference (32+ endpoints, versioning, error schema).
- **TOOLS.md** / **TOOLS-CHEATSHEET.md** — the 15 MCP tools + signatures.
- **OPERATIONS.md** — env vars, Docker config, performance characteristics, health checks.
- **TROUBLESHOOTING.md** — service-not-starting, 0 files, 504 timeouts, change-detection.
- **SSE.md** — SSE event flow + fields.
- **SETUP.md** / **NEW-PROJECT.md** — adoption.
- **CLUSTER-CONFIG.md** — cluster config schema.
- `../openapi.yaml` — OpenAPI 3.1 spec.

## Component Hierarchy (server.ts bootstrap)
- **ClusterConfigLoader** — `getClusters()`, `getClusterForFile()` (longest-prefix), hot-reloads `cluster-config.json` (≤500ms).
- **GeographicMapper** — `mapFileToCoordinates()` deterministic recursive subdivision.
- **GraphPersistence** — `saveSnapshot()` (atomic temp+rename), `loadSnapshot()` (graceful fallback), `resolveSnapshotPath()` (honors `GRAPH_SNAPSHOT_DIR`), `createDebouncedSave()`.
- **IncrementalIndexer** — `parsePythonFile()`, `parseTypeScriptFile()`, `resolveImports()`, `processChanges()`, `buildInitialGraph()`, `buildDeltaGraph()`.
- **GraphStore** — upsert + all query methods (function context, dependents, references, callers, call-chain, dead-code, impact, coupling, hotspots, class-hierarchy, search, circular-deps, complexity, change-risk, export/import snapshot).
- **LiveFileWatcher** — `start()/schedule()/stop()`, `onDelete` callback (debounced).
- **HttpApiServer** (`api.ts`, port 3001) — `handleRequest()`, `executeQuery()` (timeout+retry+error format), `broadcastSSE()`, clusters/events endpoints.
- **QueryGuards** (`utils/query-guards.ts`) — `withTimeout()` (AbortController, 5000ms), `withRetry()` (2 retries, 500ms backoff), `paginate()`, error classes, `buildErrorResponse()`.
- **MCP Tools** (`tools/`) — the 15 registered tools (see TOOLS.md).

## Data Flow
```
File change (chokidar) → LiveFileWatcher.schedule() →(200ms)→ scheduleFlush() →(500ms batch)→
IncrementalIndexer.processChanges() → parse{Python,TypeScript}File() → FileParseResult →
GraphStore.upsertFileResult() → graphology graph → MCP tools / HTTP API / SSE broadcast → UI
```
SSE: file change → `onUpdate/onDelete` → `broadcastSSE("file-change", {...clusterIds})` → nginx (buffering off, read_timeout 3600s) → browser EventSource (exp. backoff).

## Graph Schema
**Node kinds:** `file | module | function | class | variable | external`.
**Edge types:** `imports | defines | calls | instantiates | reads | writes | references | exports | inherits`.
```typescript
interface GraphNode { id; label; kind: SymbolKind; language: "python"|"typescript";
  filePath?; qualifiedName?; rangeStart?: {line,column}; rangeEnd?: {line,column}; }
interface GraphEdge { id; source; target; type: EdgeType; weight: number /*0-1 confidence*/; filePath; }
```
`inherits`: source=child, target=parent; emitted by both parsers (confidence 0.9). TS emits `exports` too.

## Import Resolution
- **Python:** `app.main` → `{root}/app/main.py` or `{root}/app/main/__init__.py`.
- **TypeScript:** relative → `.ts/.tsx/.js/.jsx/index.*`; alias via nearest `tsconfig*.json` `paths`; legacy `@/*→frontend/src/*` only when `TS_LEGACY_FRONTEND_ALIAS=1`.

## Testing Inventory
~438 vitest tests across ~45 files under `src/__tests__/` (parsers, query-guards, each query tool, properties/, graph-persistence, api-versioning). Run `npm test`. Add parser/graph/indexer/API/watcher tests for new features.

## Key constraints recap (authoritative list in steering local_context.md)
Zero-auth · native HTTP · `:ro` file access · absolute isolation · incremental-only · in-memory+snapshot · no outbound network · stderr logging only.

---
**Maintained by:** Knowledge Manager. Update this file (via a State Sync Draft) whenever the service's internals change — keep the steering `.claude/local_context.md` prescriptive and push mechanism detail here.
