# HTTP API Reference

Complete reference for all REST endpoints exposed by the MCP Context Manager when running in full mode (not `--stdio-only`).

---

## Overview

| Property | Value |
|----------|-------|
| **Base URL** | `http://localhost:3001` (Docker internal: `http://mcp-context-manager:3001`) |
| **API Version** | `/api/v1/` |
| **Content Type** | `application/json` |
| **CORS** | Enabled for all origins (`Access-Control-Allow-Origin: *`) |
| **OpenAPI Spec** | [`openapi.yaml`](../openapi.yaml) (OpenAPI 3.1.0) |

### Versioning

All endpoints are served under the `/api/v1/` prefix. Legacy `/api/mcp/*` paths return **HTTP 301** redirects to `/api/v1/mcp/*` (query strings preserved).

**Exceptions:**
- `GET /api/health` — always returns 200 directly (alias, no redirect).
- `GET /api/mcp/events` — serves SSE directly on both paths (EventSource cannot follow redirects).

---

## Authentication

**None required.** This is an isolated internal developer tool running within the Docker network. It is never exposed to the public internet. No API keys, JWTs, or tokens are needed.

---

## Error Handling

All endpoints use a consistent error response schema:

```json
{
  "error": "Human-readable error message",
  "code": "TIMEOUT",
  "retryable": true
}
```

### Error Codes

| Code | HTTP Status | Retryable | Description |
|------|-------------|-----------|-------------|
| `TIMEOUT` | 504 | `true` | Query exceeded 5s timeout after 2 retries |
| `INVALID_PARAMS` | 400 | `false` | Missing or invalid request parameters |
| `NOT_FOUND` | 404 | `false` | Target symbol or file not found in graph |

---

## Rate Limiting and Timeouts

All analytical query endpoints are wrapped with timeout and retry guards:

| Setting | Value | Description |
|---------|-------|-------------|
| **Query Timeout** | 5000ms | Per-attempt timeout via `AbortController` |
| **Max Retries** | 2 | Retries on `QueryTimeoutError` only |
| **Retry Backoff** | 500ms | Delay between retry attempts |
| **HTTP 504** | — | Returned when all retries are exhausted |

The timeout is enforced using `withTimeout()` which creates an `AbortSignal` passed to graph traversal functions. If the signal fires, the traversal aborts immediately and a `QueryTimeoutError` is thrown.

---

## Endpoints by Category

### Health

#### GET /api/v1/health

Returns service health status.

**Also available at:** `GET /api/health` (alias, no redirect)

```bash
curl http://localhost:3001/api/v1/health
```

**Response (200 — healthy):**

```json
{
  "status": "ok"
}
```

**Response (200 — degraded):**

```json
{
  "status": "degraded",
  "reasons": ["indexed 0 files"]
}
```

Always returns HTTP 200. Inspect the `status` field: `"ok"` means fully healthy; `"degraded"` means the service is running but the initial index is empty (e.g., misconfigured `WORKSPACE_PATH`). Run `./mcp.sh doctor` for a full diagnostics snapshot.

---

### Diagnostics

#### GET /api/v1/diag

Returns a diagnostics snapshot of the running instance: resolved workspace root, glob patterns, ignore patterns, file counts per language, per-cluster hit counts, and degraded state.

```bash
curl http://localhost:3001/api/v1/diag
```

**Response (200):**

```json
{
  "workspaceRoot": "/workspace",
  "resolvedPythonGlobs": ["**/*.py"],
  "resolvedTsGlobs": ["**/*.{ts,tsx,js,jsx}"],
  "resolvedIgnores": ["**/node_modules/**", "**/dist/**", "..."],
  "fileCount": { "total": 42, "python": 10, "ts": 32 },
  "clusterHits": { "frontend": 18, "backend": 24 },
  "degraded": false,
  "reasons": []
}
```

Always returns HTTP 200. Inspect `degraded` for health state. Clusters with 0 hits are omitted from `clusterHits`. Used by `./mcp.sh doctor` and CI health checks.

---

### Graph Export

#### GET /api/v1/mcp/graph

Exports the full dependency graph with nodes (files, functions, classes, variables) and edges (imports, calls, reads, writes). Nodes include geographic coordinates and cluster assignments for visualization.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `scope` | string | no | `repo` | Graph scope: `repo`, `file`, or `symbol` |
| `file_path` | string | no | — | Required when scope is `file` |
| `symbol_qualified_name` | string | no | — | Required when scope is `symbol` |
| `max_nodes` | integer | no | 0 (unlimited) | Max nodes to return (0 = full graph) |
| `max_edges` | integer | no | 0 (unlimited) | Max edges to return (0 = full graph) |

```bash
curl "http://localhost:3001/api/v1/mcp/graph?scope=repo&max_nodes=2000"
```

**Response (200):**

```json
{
  "nodes": [
    {
      "id": "file:backend/app/main.py",
      "type": "file",
      "label": "main.py",
      "filePath": "backend/app/main.py",
      "qualifiedName": "backend/app/main.py",
      "metadata": { "language": "python" },
      "lat": 35.6,
      "lng": 139.7,
      "clusterId": "backend"
    }
  ],
  "edges": [
    {
      "source": "file:backend/app/main.py",
      "target": "file:backend/app/database.py",
      "type": "imports",
      "metadata": { "weight": 1, "filePath": "backend/app/main.py" },
      "isCrossCluster": false
    }
  ],
  "meta": {
    "nodeCount": 150,
    "edgeCount": 300
  },
  "clusterMeta": [
    { "id": "backend", "path": "backend/", "label": "Backend Services", "color": "#4A90E2" }
  ]
}
```

#### GET /api/v1/mcp/clusters

Returns the current cluster configuration used for geographic grouping.

```bash
curl http://localhost:3001/api/v1/mcp/clusters
```

**Response (200):**

```json
{
  "clusters": [
    { "id": "backend", "path": "backend/", "label": "Backend Services", "color": "#4A90E2" },
    { "id": "frontend", "path": "frontend/", "label": "Frontend Application", "color": "#E24A4A" },
    { "id": "mcp-services", "path": "services/", "label": "MCP Services", "color": "#4AE290" }
  ]
}
```

---

### Function Context

#### GET /api/v1/mcp/function/:functionName

Returns the neighborhood subgraph around a function (callers, callees, related files).

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `functionName` | path | yes | — | Target function name |
| `file_path` | query | no | — | File path to disambiguate |
| `max_hops` | query (integer) | no | 2 | Max hops from center node |
| `max_nodes` | query (integer) | no | 150 | Max nodes to return |

```bash
curl "http://localhost:3001/api/v1/mcp/function/create_app?file_path=backend/app/main.py&max_hops=2"
```

**Response (200):**

```json
{
  "centerNode": {
    "id": "func:main:create_app",
    "type": "function",
    "label": "create_app",
    "filePath": "backend/app/main.py"
  },
  "nodes": [],
  "edges": [],
  "relatedFiles": ["backend/app/database.py"],
  "truncated": false
}
```

#### POST /api/v1/mcp/function

```bash
curl -X POST http://localhost:3001/api/v1/mcp/function \
  -H "Content-Type: application/json" \
  -d '{"function_name": "create_app", "file_path": "backend/app/main.py", "max_hops": 2, "max_nodes": 150}'
```

---

### File Dependents

#### GET /api/v1/mcp/file/:filePath/dependents

Returns files that depend on or are depended upon by the specified file.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `filePath` | path | yes | — | Target file path (URL-encoded) |
| `direction` | query | no | `incoming` | `incoming`, `outgoing`, or `both` |
| `depth` | query (integer) | no | 1 | Traversal depth |
| `max_files` | query (integer) | no | 200 | Max files to return |

```bash
curl "http://localhost:3001/api/v1/mcp/file/backend%2Fapp%2Fmain.py/dependents?direction=incoming&depth=1"
```

#### POST /api/v1/mcp/dependents

```bash
curl -X POST http://localhost:3001/api/v1/mcp/dependents \
  -H "Content-Type: application/json" \
  -d '{"file_path": "backend/app/main.py", "direction": "incoming", "depth": 1, "max_files": 200}'
```

---

### Symbol References

#### GET /api/v1/mcp/symbol/:symbolName/references

Returns all references to a symbol across the codebase.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `symbolName` | path | yes | — | Symbol qualified name |
| `include_reads` | query (boolean) | no | `true` | Include read references |
| `include_writes` | query (boolean) | no | `true` | Include write references |
| `include_calls` | query (boolean) | no | `true` | Include call references |
| `max_results` | query (integer) | no | 300 | Max results to return |

```bash
curl "http://localhost:3001/api/v1/mcp/symbol/database.get_db/references?include_calls=true&max_results=100"
```

#### POST /api/v1/mcp/references

```bash
curl -X POST http://localhost:3001/api/v1/mcp/references \
  -H "Content-Type: application/json" \
  -d '{"symbol_qualified_name": "database.get_db", "include_reads": true, "include_writes": true, "include_calls": true, "max_results": 300}'
```

---

### Callers

#### GET /api/v1/mcp/callers/:functionName

Returns all functions that call the specified function, traversing up to `max_depth` levels (reverse call graph).

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `functionName` | path | yes | — | Target function name |
| `file_path` | query | no | — | File path to disambiguate |
| `max_depth` | query (integer) | no | 3 | Transitive depth (1–10) |
| `max_results` | query (integer) | no | 100 | Max callers returned (1–500) |

```bash
curl "http://localhost:3001/api/v1/mcp/callers/create_app?file_path=backend/app/main.py&max_depth=3"
```

**Response (200):**

```json
{
  "target": {
    "id": "func:main:create_app",
    "type": "function",
    "label": "create_app",
    "filePath": "backend/app/main.py"
  },
  "callers": [
    {
      "node": { "id": "func:test_main:test_app", "type": "function", "label": "test_app", "filePath": "backend/tests/test_main.py" },
      "depth": 1,
      "callEdge": { "source": "func:test_main:test_app", "target": "func:main:create_app", "type": "calls" }
    }
  ],
  "truncated": false
}
```

#### POST /api/v1/mcp/callers

```bash
curl -X POST http://localhost:3001/api/v1/mcp/callers \
  -H "Content-Type: application/json" \
  -d '{"function_name": "create_app", "file_path": "backend/app/main.py", "max_depth": 3, "max_results": 100}'
```

---

### Call Chain

#### GET /api/v1/mcp/call-chain/:functionName

Returns the upstream and/or downstream call chain for a function (directed subgraph).

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `functionName` | path | yes | — | Root function name |
| `file_path` | query | no | — | File path to disambiguate |
| `direction` | query | no | `both` | `upstream`, `downstream`, or `both` |
| `max_depth` | query (integer) | no | 5 | Traversal depth (1–10) |
| `max_nodes` | query (integer) | no | 200 | Max nodes in subgraph (1–500) |

```bash
curl "http://localhost:3001/api/v1/mcp/call-chain/create_app?direction=downstream&max_depth=5"
```

**Response (200):**

```json
{
  "root": {
    "id": "func:main:create_app",
    "type": "function",
    "label": "create_app",
    "filePath": "backend/app/main.py"
  },
  "chain": {
    "nodes": [],
    "edges": []
  },
  "truncated": false
}
```

#### POST /api/v1/mcp/call-chain

```bash
curl -X POST http://localhost:3001/api/v1/mcp/call-chain \
  -H "Content-Type: application/json" \
  -d '{"function_name": "create_app", "direction": "both", "max_depth": 5, "max_nodes": 200}'
```

---

### Dead Code

#### GET /api/v1/mcp/dead-code

Detects unreferenced symbols (functions/classes with zero inbound edges). Entry points (`main`, `bootstrap`, `__init__`) and test files are excluded heuristically.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `file_pattern` | query | no | — | Glob pattern (e.g., `backend/**`) |
| `language` | query | no | — | `python` or `typescript` |
| `kind` | query | no | — | `function` or `class` |
| `max_results` | query (integer) | no | 100 | Max results (1–500) |

```bash
curl "http://localhost:3001/api/v1/mcp/dead-code?file_pattern=backend/**&language=python&kind=function&max_results=50"
```

**Response (200):**

```json
{
  "deadSymbols": [
    {
      "node": { "id": "func:utils:unused_helper", "type": "function", "label": "unused_helper", "filePath": "backend/app/utils.py" },
      "definedIn": "backend/app/utils.py"
    }
  ],
  "totalScanned": 42,
  "truncated": false
}
```

#### POST /api/v1/mcp/dead-code

```bash
curl -X POST http://localhost:3001/api/v1/mcp/dead-code \
  -H "Content-Type: application/json" \
  -d '{"file_pattern": "backend/**", "language": "python", "kind": "function", "max_results": 50}'
```

---

### Hotspots

#### GET /api/v1/mcp/hotspots

Returns the top-N most-referenced symbols (highest fan-in).

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `top_n` | query (integer) | no | 20 | Number of top hotspots to return |
| `kind` | query | no | — | `function`, `class`, or `variable` |
| `language` | query | no | — | `python` or `typescript` |
| `file_pattern` | query | no | — | Glob pattern to filter files |

```bash
curl "http://localhost:3001/api/v1/mcp/hotspots?top_n=10&kind=function&language=python"
```

**Response (200):**

```json
{
  "hotspots": [
    {
      "node": { "id": "func:database:get_db", "type": "function", "label": "get_db", "filePath": "backend/app/database.py" },
      "fanIn": 12,
      "edgeTypes": { "calls": 10, "references": 2 }
    }
  ],
  "totalSymbolsScanned": 150,
  "truncated": false
}
```

#### POST /api/v1/mcp/hotspots

```bash
curl -X POST http://localhost:3001/api/v1/mcp/hotspots \
  -H "Content-Type: application/json" \
  -d '{"top_n": 20, "kind": "function", "language": "python", "file_pattern": "backend/**", "include_edge_types": ["calls", "reads"]}'
```

---

### Impact Analysis

#### GET /api/v1/mcp/impact/:filePath

Analyzes the blast radius of changes to a file — which files and symbols are affected.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `filePath` | path | yes | — | Source file path (URL-encoded) |
| `max_depth` | query (integer) | no | 3 | Import chain depth (1–5) |
| `max_files` | query (integer) | no | 100 | Max affected files (1–500) |

```bash
curl "http://localhost:3001/api/v1/mcp/impact/backend%2Fapp%2Fdatabase.py?max_depth=3&max_files=100"
```

**Response (200):**

```json
{
  "sourceFile": "backend/app/database.py",
  "affectedFiles": [
    { "filePath": "backend/app/main.py", "depth": 1, "impactType": "direct" },
    { "filePath": "backend/app/routers/users.py", "depth": 2, "impactType": "transitive" }
  ],
  "affectedSymbols": [
    { "id": "func:main:create_app", "type": "function", "label": "create_app", "filePath": "backend/app/main.py" }
  ],
  "riskScore": 0.65,
  "suggestedTestFiles": ["backend/tests/test_database.py"],
  "truncated": false
}
```

**Risk Score Formula:** `min(1.0, affectedFiles.length * 0.3 + affectedSymbols.length * 0.1)`

#### POST /api/v1/mcp/impact

```bash
curl -X POST http://localhost:3001/api/v1/mcp/impact \
  -H "Content-Type: application/json" \
  -d '{"file_path": "backend/app/database.py", "max_depth": 3, "max_files": 100}'
```

---

### Module Coupling

#### GET /api/v1/mcp/coupling/:filePathA/:filePathB

Computes coupling metrics between two files (shared imports, shared symbols, direct/transitive edges).

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `filePathA` | path | yes | — | First file path |
| `filePathB` | path | yes | — | Second file path |
| `max_depth` | query (integer) | no | 2 | Transitive edge traversal depth |

```bash
curl "http://localhost:3001/api/v1/mcp/coupling/backend%2Fapp%2Fmain.py/backend%2Fapp%2Fdatabase.py"
```

**Response (200):**

```json
{
  "filePathA": "backend/app/main.py",
  "filePathB": "backend/app/database.py",
  "sharedImports": ["backend/app/config.py"],
  "sharedSymbols": ["get_settings"],
  "directEdges": 2,
  "transitiveEdges": 5,
  "couplingScore": 0.45,
  "truncated": false
}
```

#### POST /api/v1/mcp/coupling

```bash
curl -X POST http://localhost:3001/api/v1/mcp/coupling \
  -H "Content-Type: application/json" \
  -d '{"file_path_a": "backend/app/main.py", "file_path_b": "backend/app/database.py", "max_depth": 2}'
```

---

### Class Hierarchy

#### GET /api/v1/mcp/class-hierarchy/:className

Traverses the inheritance tree for a class (ancestors, descendants, or both).

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `className` | path | yes | — | Target class name |
| `file_path` | query | no | — | File path to disambiguate |
| `direction` | query | no | `both` | `ancestors`, `descendants`, or `both` |
| `max_depth` | query (integer) | no | 5 | Traversal depth (1–10) |

```bash
curl "http://localhost:3001/api/v1/mcp/class-hierarchy/BaseModel?direction=descendants&max_depth=5"
```

**Response (200):**

```json
{
  "root": {
    "id": "class:models:BaseModel",
    "type": "class",
    "label": "BaseModel",
    "filePath": "backend/app/models/base.py"
  },
  "ancestors": [],
  "descendants": [
    { "id": "class:models:User", "type": "class", "label": "User", "filePath": "backend/app/models/user.py" }
  ],
  "hierarchy": {
    "nodes": [],
    "edges": []
  },
  "truncated": false
}
```

#### POST /api/v1/mcp/class-hierarchy

```bash
curl -X POST http://localhost:3001/api/v1/mcp/class-hierarchy \
  -H "Content-Type: application/json" \
  -d '{"class_name": "BaseModel", "file_path": "backend/app/models/base.py", "direction": "descendants", "max_depth": 5}'
```

---

### Search

#### GET /api/v1/mcp/search

Fuzzy or regex search for symbols across the codebase.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `query` | query | yes | — | Search string (fuzzy match or regex) |
| `kind` | query | no | — | `file`, `module`, `function`, `class`, `variable`, or `external` |
| `language` | query | no | — | `python` or `typescript` |
| `file_pattern` | query | no | — | Glob pattern to filter files |
| `use_regex` | query (boolean) | no | `false` | Use regex matching instead of fuzzy |
| `max_results` | query (integer) | no | 50 | Max results (1–500) |

```bash
curl "http://localhost:3001/api/v1/mcp/search?query=create_app&kind=function&language=python&max_results=50"
```

**Response (200):**

```json
{
  "results": [
    {
      "id": "func:main:create_app",
      "type": "function",
      "label": "create_app",
      "filePath": "backend/app/main.py",
      "qualifiedName": "main.create_app",
      "metadata": { "language": "python" }
    }
  ],
  "totalMatches": 1,
  "truncated": false
}
```

#### POST /api/v1/mcp/search

```bash
curl -X POST http://localhost:3001/api/v1/mcp/search \
  -H "Content-Type: application/json" \
  -d '{"query": "create_app", "kind": "function", "language": "python", "file_pattern": "backend/**", "use_regex": false, "max_results": 50}'
```

---

### Circular Dependencies

#### GET /api/v1/mcp/circular-deps

Detects circular import chains using iterative DFS on the file-level import graph. Uses file extension inference for language filtering.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `file_pattern` | query | no | — | Glob pattern to filter files |
| `language` | query | no | — | `python` or `typescript` |
| `max_cycles` | query (integer) | no | 50 | Max cycles to return (1–200) |
| `max_depth` | query (integer) | no | 20 | Max DFS depth (1–50) |

```bash
curl "http://localhost:3001/api/v1/mcp/circular-deps?file_pattern=backend/**&language=python&max_cycles=50"
```

**Response (200):**

```json
{
  "cycles": [
    { "chain": ["src/a.py", "src/b.py", "src/a.py"], "length": 2 },
    { "chain": ["src/x.py", "src/y.py", "src/z.py", "src/x.py"], "length": 3 }
  ],
  "totalFilesScanned": 42,
  "truncated": false
}
```

The `chain` array is an ordered list of file paths forming the cycle (first element repeated at end). The `length` is the number of unique files in the cycle.

#### POST /api/v1/mcp/circular-deps

```bash
curl -X POST http://localhost:3001/api/v1/mcp/circular-deps \
  -H "Content-Type: application/json" \
  -d '{"file_pattern": "backend/**", "language": "python", "max_cycles": 50, "max_depth": 20}'
```

---

### Complexity Metrics

#### GET /api/v1/mcp/complexity

Computes per-symbol complexity metrics: fan-in (inbound edges), fan-out (outbound edges), and max call-chain depth via BFS (capped at 10 levels). Skips `module`, `external`, and `variable` node kinds.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `file_path` | query | no | — | Glob pattern to filter by file path |
| `kind` | query | no | — | `function`, `class`, or `file` |
| `language` | query | no | — | `python` or `typescript` |
| `sort_by` | query | no | `total` | `fan_in`, `fan_out`, `depth`, or `total` |
| `max_results` | query (integer) | no | 100 | Max results (1–500) |

```bash
curl "http://localhost:3001/api/v1/mcp/complexity?file_path=backend/**&kind=function&sort_by=fan_out&max_results=50"
```

**Response (200):**

```json
{
  "metrics": [
    {
      "node": {
        "id": "func:main:create_app",
        "type": "function",
        "label": "create_app",
        "filePath": "backend/app/main.py",
        "qualifiedName": "main.create_app",
        "metadata": { "language": "python", "rangeStart": { "line": 10, "column": 1 }, "rangeEnd": { "line": 45, "column": 1 } }
      },
      "fanIn": 5,
      "fanOut": 3,
      "maxDepth": 2,
      "totalComplexity": 10
    }
  ],
  "totalScanned": 42,
  "truncated": false
}
```

**Complexity Formula:** `totalComplexity = fanIn + fanOut + maxDepth`

#### POST /api/v1/mcp/complexity

```bash
curl -X POST http://localhost:3001/api/v1/mcp/complexity \
  -H "Content-Type: application/json" \
  -d '{"file_path": "backend/**", "kind": "function", "language": "python", "sort_by": "total", "max_results": 100}'
```

---

### Change Risk

#### GET /api/v1/mcp/change-risk

Predicts which tests should run and which areas are highest risk given a set of changed files. Aggregates impact analysis across multiple files and cross-references with top-20 hotspots.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `changed_files` | query | yes | — | Comma-separated file paths |
| `max_depth` | query (integer) | no | 3 | Import chain depth (1–5) |
| `max_files` | query (integer) | no | 100 | Max affected files (1–500) |

```bash
curl "http://localhost:3001/api/v1/mcp/change-risk?changed_files=backend/app/database.py,backend/app/models/user.py&max_depth=3"
```

**Response (200):**

```json
{
  "changedFiles": ["backend/app/database.py", "backend/app/models/user.py"],
  "aggregateRiskScore": 0.72,
  "affectedFiles": [
    { "filePath": "backend/app/main.py", "depth": 1, "impactType": "direct", "riskContribution": 0.5 },
    { "filePath": "backend/app/routers/users.py", "depth": 2, "impactType": "transitive", "riskContribution": 0.5 }
  ],
  "suggestedTestFiles": [
    "backend/tests/test_database.py",
    "backend/tests/test_users.py"
  ],
  "hotspotOverlap": [
    {
      "node": { "id": "func:database:get_db", "type": "function", "label": "get_db", "filePath": "backend/app/database.py" },
      "fanIn": 12
    }
  ],
  "truncated": false
}
```

| Field | Description |
|-------|-------------|
| `aggregateRiskScore` | 0.0–1.0, `min(1.0, avg of per-file risk scores)` |
| `affectedFiles[].impactType` | `direct` (imports a changed file) or `transitive` |
| `affectedFiles[].riskContribution` | Fraction of changed files that affect this file (0.0–1.0) |
| `hotspotOverlap` | High-fan-in symbols from top-20 hotspots in the blast radius |

#### POST /api/v1/mcp/change-risk

```bash
curl -X POST http://localhost:3001/api/v1/mcp/change-risk \
  -H "Content-Type: application/json" \
  -d '{"changed_files": ["backend/app/database.py", "backend/app/models/user.py"], "max_depth": 3, "max_files": 100}'
```

**POST body constraints:** `changed_files` array must have 1–50 items.

---

### SSE Events

#### GET /api/v1/mcp/events

Server-Sent Events stream for real-time file change notifications. This is a long-lived connection.

**Also available at:** `GET /api/mcp/events` (legacy path, served directly — no redirect)

**Response Headers:**
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`

```bash
curl -N http://localhost:3001/api/v1/mcp/events
```

**Event Types:**

| Event | Description | Frequency |
|-------|-------------|-----------|
| `connected` | Initial handshake | Once on connection |
| `indexing-progress` | File indexing progress | During startup indexing |
| `indexing-complete` | Indexing finished | Once after startup (or immediately for late clients) |
| `file-change` | File created/updated/deleted | On any watched file change |
| `keepalive` | Heartbeat | Every 30 seconds |

**Example stream output:**

```
event: connected
data: {"timestamp":1714934400000}

event: indexing-progress
data: {"current":42,"total":215,"timestamp":1714934401000}

event: indexing-complete
data: {"indexedFiles":215,"timestamp":1714934405000}

event: file-change
data: {"type":"file-updated","filePaths":["backend/app/main.py"],"clusterIds":["backend"],"timestamp":1714934500000}

event: keepalive
data: {"timestamp":1714934430000}
```

**Late-connecting clients:** If a client connects after indexing has already completed, it receives `connected` followed immediately by `indexing-complete`.

For detailed SSE architecture, Nginx proxy configuration, reconnection strategies, and client code examples, see [SSE.md](./SSE.md).

---

## Endpoint Summary Table

| # | Method | Path | Tag |
|---|--------|------|-----|
| 1 | GET | `/api/v1/health` | Health |
| 2 | GET | `/api/v1/diag` | Diagnostics |
| 3 | GET | `/api/v1/mcp/graph` | Graph Export |
| 4 | GET | `/api/v1/mcp/clusters` | Graph Export |
| 5 | GET | `/api/v1/mcp/function/:functionName` | Function Context |
| 6 | POST | `/api/v1/mcp/function` | Function Context |
| 7 | GET | `/api/v1/mcp/file/:filePath/dependents` | File Dependents |
| 8 | POST | `/api/v1/mcp/dependents` | File Dependents |
| 9 | GET | `/api/v1/mcp/symbol/:symbolName/references` | Symbol References |
| 10 | POST | `/api/v1/mcp/references` | Symbol References |
| 11 | GET | `/api/v1/mcp/callers/:functionName` | Callers |
| 12 | POST | `/api/v1/mcp/callers` | Callers |
| 13 | GET | `/api/v1/mcp/call-chain/:functionName` | Call Chain |
| 14 | POST | `/api/v1/mcp/call-chain` | Call Chain |
| 15 | GET | `/api/v1/mcp/dead-code` | Dead Code |
| 16 | POST | `/api/v1/mcp/dead-code` | Dead Code |
| 17 | GET | `/api/v1/mcp/hotspots` | Hotspots |
| 18 | POST | `/api/v1/mcp/hotspots` | Hotspots |
| 19 | GET | `/api/v1/mcp/impact/:filePath` | Impact Analysis |
| 20 | POST | `/api/v1/mcp/impact` | Impact Analysis |
| 21 | GET | `/api/v1/mcp/coupling/:filePathA/:filePathB` | Module Coupling |
| 22 | POST | `/api/v1/mcp/coupling` | Module Coupling |
| 23 | GET | `/api/v1/mcp/class-hierarchy/:className` | Class Hierarchy |
| 24 | POST | `/api/v1/mcp/class-hierarchy` | Class Hierarchy |
| 25 | GET | `/api/v1/mcp/search` | Search |
| 26 | POST | `/api/v1/mcp/search` | Search |
| 27 | GET | `/api/v1/mcp/circular-deps` | Circular Dependencies |
| 28 | POST | `/api/v1/mcp/circular-deps` | Circular Dependencies |
| 29 | GET | `/api/v1/mcp/complexity` | Complexity Metrics |
| 30 | POST | `/api/v1/mcp/complexity` | Complexity Metrics |
| 31 | GET | `/api/v1/mcp/change-risk` | Change Risk |
| 32 | POST | `/api/v1/mcp/change-risk` | Change Risk |
| 33 | GET | `/api/v1/mcp/events` | SSE Events |

**Legacy aliases:** `GET /api/health`, `GET /api/mcp/events`

---

## Related Documentation

- [TOOLS.md](./TOOLS.md) — MCP tools reference (all 15 tools, parameters, examples)
- [SSE.md](./SSE.md) — Detailed SSE architecture, Nginx proxy config, reconnection strategies
- [SETUP.md](./SETUP.md) — Service setup and Docker configuration
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — Troubleshooting guide for common issues
- [CLUSTER-CONFIG.md](./CLUSTER-CONFIG.md) — Cluster configuration for geographic mapping
- [TESTING-WITH-AI.md](./TESTING-WITH-AI.md) — Using MCP tools with AI assistants
