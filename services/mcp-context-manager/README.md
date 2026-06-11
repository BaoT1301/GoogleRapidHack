# MCP Context Manager

A standalone [Model Context Protocol](https://modelcontextprotocol.io/) server that maintains a live dependency graph of your codebase. It parses Python and TypeScript files using Tree-sitter, tracks imports/calls/reads/writes in a Graphology graph, and exposes 15 MCP tools for AI-powered code analysis.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   MCP Context Manager                        │
│                                                             │
│  server.ts (Bootstrap — supports --stdio-only mode)         │
│    ├── ClusterConfigLoader    (cluster-config.json watcher) │
│    ├── GeographicMapper       (file → lat/lng coordinates)  │
│    ├── GraphPersistence       (snapshot save/load)          │
│    ├── IncrementalIndexer     (AST parsing + graph build)   │
│    │     ├── PythonParser     (tree-sitter)                 │
│    │     └── TypeScriptParser (TS compiler API)             │
│    ├── GraphStore             (Graphology multi-digraph)     │
│    ├── LiveFileWatcher        (Chokidar, debounced)         │
│    ├── HttpApiServer          (native http, port 3001)      │
│    │     └── SSE endpoint     (/api/v1/mcp/events)          │
│    └── MCP Tools (15)         (stdio transport)             │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start

```bash
# 1. Start MCP services (Docker)
./mcp.sh up

# 2. Verify readiness (returns 200 once graph is built)
curl http://localhost:3001/api/ready
# → {"ready":true}

# 3. Configure your AI tool (see docs/SETUP.md for details)
#    Kiro: .kiro/settings/mcp.json already configured
#    Claude Desktop: copy kiro-config.template.json
```

For detailed setup instructions, see [`docs/SETUP.md`](docs/SETUP.md).

---

## MCP Tools

| # | Tool | Description |
|---|------|-------------|
| 1 | `get_function_context` | Graph neighborhood around a function (callers, callees, related files) |
| 2 | `get_file_dependents` | Files that import or are imported by a given file |
| 3 | `get_symbol_references` | All references (reads, writes, calls) to a symbol |
| 4 | `export_dependency_graph` | Export graph slice for visualization (repo/file/symbol scope) |
| 5 | `get_callers` | Reverse call graph — who calls this function? |
| 6 | `get_call_chain` | Full upstream/downstream call chain as a subgraph |
| 7 | `get_dead_code` | Functions/classes with zero inbound edges |
| 8 | `get_impact_analysis` | Transitive closure of files affected by a change |
| 9 | `get_module_coupling` | Coupling score between two files |
| 10 | `get_hotspots` | Top-N most-referenced symbols (highest fan-in) |
| 11 | `get_class_hierarchy` | Inheritance tree (ancestors + descendants) |
| 12 | `search_symbols` | Fuzzy/regex search across all symbols |
| 13 | `get_circular_dependencies` | Detect import cycles |
| 14 | `get_complexity_metrics` | Complexity scoring for functions/classes |
| 15 | `get_change_risk` | Risk assessment for a set of changed files |
| 16 | `get_unresolved_imports` | Files with unresolved import specifiers (via `/api/v1/mcp/unresolved_imports`) |

---

## Documentation

| Guide | Description |
|-------|-------------|
| [`docs/API.md`](docs/API.md) | Complete HTTP API reference (all 32 REST endpoints) |
| [`docs/TOOLS.md`](docs/TOOLS.md) | MCP tools reference (all 15 tools, parameters, examples) |
| [`docs/SETUP.md`](docs/SETUP.md) | Docker setup, WORKSPACE_PATH, environment variables, verification |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Troubleshooting guide (Docker, ports, indexing, AI connectivity) |
| [`docs/CLUSTER-CONFIG.md`](docs/CLUSTER-CONFIG.md) | cluster-config.json schema, examples, geographic mapping algorithm |
| [`docs/SSE.md`](docs/SSE.md) | Real-time SSE events, data flow, client examples |
| [`docs/TESTING-WITH-AI.md`](docs/TESTING-WITH-AI.md) | Configure Kiro, Claude Desktop, Cursor; test queries |
| [`docs/NEW-PROJECT.md`](docs/NEW-PROJECT.md) | Add MCP to a new project (Next.js, Django, etc.) |
| [`openapi.yaml`](openapi.yaml) | OpenAPI 3.1.0 spec for all 32+ HTTP endpoints |

---

## Development

```bash
cd services/mcp-context-manager

# Install dependencies
npm install

# Run in dev mode (hot reload via tsx)
npm run dev

# Build TypeScript
npm run build

# Run tests (438 tests across 45 files)
npm run test

# Lint
npm run lint
```

### Project Structure

```
src/
├── server.ts                 # Bootstrap (--stdio-only flag)
├── api.ts                    # HTTP API (native http module, SSE)
├── geographic-mapper.ts      # File path → lat/lng mapping
├── cluster/                  # Cluster config loader + hot-reload
├── graph/
│   ├── graph-store.ts        # Graphology graph + query methods
│   └── graph-persistence.ts  # Snapshot save/load (atomic writes)
├── indexer/                   # Incremental file indexing
├── parsers/                   # Python (tree-sitter) + TypeScript (compiler API)
├── tools/                     # MCP tool definitions (15 tools)
├── types/                     # TypeScript type definitions
├── utils/                     # Query guards (timeout, retry, pagination)
├── watcher/                   # Chokidar file watcher
└── __tests__/                 # 296 unit tests (Vitest)
```

---

## Key Design Decisions

- **Zero authentication** — internal tool, Docker-network only
- **Native HTTP** — no Express.js; minimal deps, fast startup
- **Read-only volumes** — never writes to source code
- **Incremental updates** — only re-parses changed files + dependents
- **Graph snapshots** — persists to disk for sub-second restarts
- **`--stdio-only` mode** — skips HTTP server when invoked by AI tools via `docker exec`

---

## Import Resolution

### TypeScript Path Aliases

The indexer automatically discovers all `tsconfig*.json` files under the workspace root
(honouring `WATCH_IGNORES`) and resolves `compilerOptions.paths` aliases at index time.

- Nearest-ancestor config wins (deepest directory match).
- `extends` chains are followed with a cycle guard.
- JSONC (comments + trailing commas) is supported without extra dependencies.
- Set `TS_LEGACY_FRONTEND_ALIAS=1` to re-enable the old `@/* → frontend/src/*` hardcode
  for one-release backwards compatibility (default: off).

---

## Input Validation

All tools that accept `file_pattern` (glob) or `pattern` (regex) parameters perform pre-flight validation:

- Comma-separated globs (`*.ts,*.tsx`) are rejected — use brace-expansion: `*.{ts,tsx}`
- Absolute paths are rejected — use workspace-relative paths: `src/**/*.ts`
- Invalid regex patterns return a `400 INVALID_PARAMS` response with an actionable hint
- When a tool returns zero results because no files matched the glob, the response includes a `reason` field

---

## Diagnostics

### `GET /api/ready`

Readiness probe. Returns `200 { "ready": true }` once the initial graph build completes;
`503 { "ready": false, "reason": "indexing" }` while indexing. Use for Docker healthchecks
and `mcp.sh up` polling. `/api/health` remains available as a liveness alias (always 200).

### `GET /api/v1/diag`

Full diagnostics snapshot. Includes `importResolution` and `memory` blocks in addition to
the base fields. `degraded: true` when any of:
- `fileCount.total === 0` → `"indexed 0 files"`
- `unresolvedSpecifiers > 10` AND ratio > 25% → `"high-unresolved-import-ratio"`
- `heapUsedMb / heapLimitMb > 0.85` → `"high-heap-usage"`

### `GET /api/v1/mcp/unresolved_imports`

Returns files with unresolved import specifiers. Optional query params: `file_pattern`, `limit` (default 200), `reason`.
Response: `{ totalFiles, totalSpecifiers, entries, truncated }`.

---

## License

Part of the host repository. See root [LICENSE](../../LICENSE).
