# MCP Tools Reference

The MCP Context Manager exposes **15 tools** via the [Model Context Protocol](https://modelcontextprotocol.io/) stdio transport. These tools are invoked by AI coding assistants (Kiro, Claude Desktop, Cursor) to perform real-time code structure analysis.

---

## Overview

**Transport:** MCP stdio (stdin/stdout JSON-RPC)

**Invocation:** AI tools connect via `docker exec`:

```bash
docker exec -i mcp-context-manager node dist/server.js --stdio-only
```

When `--stdio-only` is passed, the server skips HTTP server startup and operates as a pure MCP tool provider. The HTTP API continues running independently in the main container process.

**Response Format:** All tools return:

```json
{
  "content": [{ "type": "text", "text": "<JSON-stringified result>" }]
}
```

**HTTP Equivalents:** Each MCP tool has a corresponding HTTP endpoint on port 3001 for programmatic access. See [`./API.md`](./API.md) for the full HTTP API reference.

#### `GET /api/v1/diag`
Returns resolved workspace root, glob patterns, ignore patterns, file counts per language, cluster hit counts, and degraded state. Used by `./mcp.sh doctor` and CI health checks. Always returns HTTP 200; inspect the `degraded` field for health state.

---

## Tool Inventory

| # | Tool | Description | Primary Use Case |
|---|------|-------------|-----------------|
| 1 | `get_function_context` | Graph neighborhood around a function | Understand a function's callers, callees, and related files |
| 2 | `get_file_dependents` | Files that import or are imported by a file | Trace import chains before refactoring |
| 3 | `get_symbol_references` | All references (reads, writes, calls) to a symbol | Find all usages of a variable or function |
| 4 | `get_callers` | Reverse call graph for a function | Identify who calls a function before changing its signature |
| 5 | `get_call_chain` | Full upstream/downstream call chain | Trace execution flow through the codebase |
| 6 | `get_dead_code` | Functions/classes with zero inbound edges | Identify unused code for cleanup |
| 7 | `get_hotspots` | Top-N most-referenced symbols (highest fan-in) | Find critical code paths and high-risk symbols |
| 8 | `get_impact_analysis` | Transitive closure of affected files/symbols | Assess blast radius before modifying a file |
| 9 | `export_dependency_graph` | Export graph slice for visualization | Feed data to D3.js, React Flow, or the Globe UI |
| 10 | `get_module_coupling` | Coupling score between two files | Evaluate whether two modules should be merged or decoupled |
| 11 | `search_symbols` | Fuzzy/regex search across all symbols | Locate symbols by partial name |
| 12 | `get_complexity_metrics` | Fan-in, fan-out, and depth per symbol | Prioritize refactoring targets |
| 13 | `get_circular_dependencies` | Detect import cycles | Break circular imports that cause runtime issues |
| 14 | `get_change_risk` | Risk assessment for changed files | Predict test coverage needs from a git diff |
| 15 | `get_class_hierarchy` | Inheritance tree (ancestors + descendants) | Understand class relationships before modifying a base class |

---

## Detailed Tool Reference

### 1. `get_function_context`

**Description:** Get graph neighborhood around a function symbol. Returns the function node, its immediate neighborhood (callers, callees, related symbols), and the files involved.

**Parameters:**

| Name | Type | Required | Default | Constraints | Description |
|------|------|----------|---------|-------------|-------------|
| `function_name` | `string` | yes | — | min length: 1 | Target function name |
| `file_path` | `string` | no | — | — | File path to disambiguate if multiple functions share the same name |
| `max_hops` | `integer` | no | `2` | 1–4 | Number of graph hops to traverse from the target |
| `include_edge_types` | `string[]` | no | all types | values from `edgeTypeEnum` | Filter edges by type (e.g., only `calls` and `imports`) |
| `max_nodes` | `integer` | no | `150` | 1–500 | Maximum nodes to return in the neighborhood |

**Example Invocation:**

```json
{
  "tool": "get_function_context",
  "arguments": {
    "function_name": "create_app",
    "file_path": "backend/app/main.py",
    "max_hops": 2,
    "max_nodes": 150
  }
}
```

**Example Response:**

```json
{
  "root": { "id": "func:main:create_app", "type": "function", "label": "create_app", "filePath": "backend/app/main.py" },
  "neighborhood": {
    "nodes": [
      { "id": "func:main:create_app", "type": "function", "label": "create_app", "filePath": "backend/app/main.py" },
      { "id": "func:database:get_db", "type": "function", "label": "get_db", "filePath": "backend/app/database.py" }
    ],
    "edges": [
      { "source": "func:main:create_app", "target": "func:database:get_db", "type": "calls", "weight": 0.9 }
    ]
  },
  "relatedFiles": ["backend/app/main.py", "backend/app/database.py"]
}
```

**Usage Tips:**
- Use `max_hops: 1` for a focused view of direct relationships only.
- Combine with `include_edge_types: ["calls"]` to see only the call graph without import noise.
- If the function name is ambiguous, always provide `file_path` to get the correct symbol.

---

### 2. `get_file_dependents`

**Description:** Find direct or transitive dependents/dependencies for a file. Returns files that import the target (incoming) or files the target imports (outgoing).

**Parameters:**

| Name | Type | Required | Default | Constraints | Description |
|------|------|----------|---------|-------------|-------------|
| `file_path` | `string` | yes | — | min length: 1 | Target file path relative to workspace root |
| `direction` | `string` | no | `"incoming"` | `incoming`, `outgoing`, `both` | Direction of dependency traversal |
| `depth` | `integer` | no | `1` | 1–3 | Transitive depth (1 = direct only) |
| `max_files` | `integer` | no | `200` | 1–1000 | Maximum files to return |

**Example Invocation:**

```json
{
  "tool": "get_file_dependents",
  "arguments": {
    "file_path": "backend/app/database.py",
    "direction": "incoming",
    "depth": 2
  }
}
```

**Example Response:**

```json
{
  "file": "backend/app/database.py",
  "dependents": [
    { "filePath": "backend/app/main.py", "depth": 1 },
    { "filePath": "backend/app/routers/users.py", "depth": 1 },
    { "filePath": "backend/tests/test_main.py", "depth": 2 }
  ],
  "summary": { "totalDependents": 3, "maxDepthReached": 2 }
}
```

**Usage Tips:**
- Use `direction: "outgoing"` to see what a file depends on (its imports).
- Depth 1 is usually sufficient for understanding direct coupling.
- Combine with `get_impact_analysis` for a more comprehensive blast radius assessment.

---

### 3. `get_symbol_references`

**Description:** Resolve all references to a qualified symbol across the codebase. Returns reads, writes, and calls separately.

**Parameters:**

| Name | Type | Required | Default | Constraints | Description |
|------|------|----------|---------|-------------|-------------|
| `symbol_qualified_name` | `string` | yes | — | min length: 1 | Fully qualified symbol name (e.g., `main.create_app`) |
| `include_reads` | `boolean` | no | `true` | — | Include read references |
| `include_writes` | `boolean` | no | `true` | — | Include write references |
| `include_calls` | `boolean` | no | `true` | — | Include call references |
| `max_results` | `integer` | no | `300` | 1–2000 | Maximum references to return |

**Example Invocation:**

```json
{
  "tool": "get_symbol_references",
  "arguments": {
    "symbol_qualified_name": "database.get_db",
    "include_reads": true,
    "include_writes": false,
    "include_calls": true
  }
}
```

**Example Response:**

```json
{
  "symbol": { "id": "func:database:get_db", "type": "function", "label": "get_db", "filePath": "backend/app/database.py" },
  "references": [
    { "node": { "id": "func:main:create_app", "type": "function", "label": "create_app" }, "edgeType": "calls", "filePath": "backend/app/main.py" }
  ]
}
```

**Usage Tips:**
- Use the fully qualified name (module.symbol) for accurate results.
- Set `include_writes: false` to focus on consumers rather than producers.
- Useful before renaming a symbol to understand the full blast radius.

### 4. `get_callers`

**Description:** Given a function name, return all functions that call it (reverse call graph). Supports depth parameter for transitive callers.

**Parameters:**

| Name | Type | Required | Default | Constraints | Description |
|------|------|----------|---------|-------------|-------------|
| `function_name` | `string` | yes | — | min length: 1 | Target function name |
| `file_path` | `string` | no | — | — | File path to disambiguate |
| `max_depth` | `integer` | no | `3` | 1–10 | Transitive caller depth |
| `max_results` | `integer` | no | `100` | 1–500 | Maximum callers to return |

**Example Invocation:**

```json
{
  "tool": "get_callers",
  "arguments": {
    "function_name": "get_db",
    "file_path": "backend/app/database.py",
    "max_depth": 3
  }
}
```

**Example Response:**

```json
{
  "target": { "id": "func:database:get_db", "type": "function", "label": "get_db", "filePath": "backend/app/database.py" },
  "callers": [
    { "node": { "id": "func:main:create_app", "type": "function", "label": "create_app", "filePath": "backend/app/main.py" }, "depth": 1, "callEdge": { "source": "func:main:create_app", "target": "func:database:get_db", "type": "calls" } },
    { "node": { "id": "func:routers:get_users", "type": "function", "label": "get_users", "filePath": "backend/app/routers/users.py" }, "depth": 1, "callEdge": { "source": "func:routers:get_users", "target": "func:database:get_db", "type": "calls" } }
  ],
  "truncated": false
}
```

**Usage Tips:**
- Use `max_depth: 1` to see only direct callers.
- Higher depths reveal the full call tree but may return many results for popular functions.
- Always check `truncated` — if `true`, increase `max_results` for a complete picture.

---

### 5. `get_call_chain`

**Description:** Given a function name and direction, return the full call chain as a directed subgraph of nodes and edges. Useful for tracing execution flow.

**Parameters:**

| Name | Type | Required | Default | Constraints | Description |
|------|------|----------|---------|-------------|-------------|
| `function_name` | `string` | yes | — | min length: 1 | Root function name |
| `file_path` | `string` | no | — | — | File path to disambiguate |
| `direction` | `string` | no | `"both"` | `upstream`, `downstream`, `both` | Traversal direction |
| `max_depth` | `integer` | no | `5` | 1–10 | Maximum traversal depth |
| `max_nodes` | `integer` | no | `200` | 1–500 | Maximum nodes in the subgraph |

**Example Invocation:**

```json
{
  "tool": "get_call_chain",
  "arguments": {
    "function_name": "create_app",
    "direction": "downstream",
    "max_depth": 3
  }
}
```

**Example Response:**

```json
{
  "root": { "id": "func:main:create_app", "type": "function", "label": "create_app", "filePath": "backend/app/main.py" },
  "chain": {
    "nodes": [
      { "id": "func:main:create_app", "type": "function", "label": "create_app", "filePath": "backend/app/main.py" },
      { "id": "func:database:get_db", "type": "function", "label": "get_db", "filePath": "backend/app/database.py" }
    ],
    "edges": [
      { "source": "func:main:create_app", "target": "func:database:get_db", "type": "calls", "weight": 0.9 }
    ]
  },
  "truncated": false
}
```

**Usage Tips:**
- `upstream` shows what calls this function (callers of callers).
- `downstream` shows what this function calls (callees of callees).
- `both` gives the complete picture but may be large for central functions.

---

### 6. `get_dead_code`

**Description:** Find functions and classes with zero inbound calls/instantiations (potential dead code). Supports filtering by file pattern, language, and symbol kind. Entry points and test files are excluded heuristically.

**Parameters:**

| Name | Type | Required | Default | Constraints | Description |
|------|------|----------|---------|-------------|-------------|
| `file_pattern` | `string` | no | — | glob pattern | Filter by file path (e.g., `backend/**`) |
| `language` | `string` | no | — | `python`, `typescript` | Filter by language |
| `kind` | `string` | no | — | `function`, `class` | Filter by symbol kind |
| `max_results` | `integer` | no | `100` | 1–500 | Maximum results to return |

**Example Invocation:**

```json
{
  "tool": "get_dead_code",
  "arguments": {
    "file_pattern": "backend/**",
    "language": "python",
    "kind": "function",
    "max_results": 50
  }
}
```

**Example Response:**

```json
{
  "deadSymbols": [
    { "node": { "id": "func:utils:unused_helper", "label": "unused_helper", "kind": "function", "filePath": "backend/app/utils.py" }, "definedIn": "backend/app/utils.py" }
  ],
  "totalScanned": 42,
  "truncated": false
}
```

**Usage Tips:**
- Entry points (`main`, `bootstrap`, `__init__`) are automatically excluded.
- Test files (paths containing `test` or `spec` patterns) are excluded.
- Run periodically to keep the codebase clean of unused code.

---

### 7. `get_hotspots`

**Description:** Return the top-N most-referenced symbols in the codebase (highest fan-in). Useful for identifying critical code paths and high-risk symbols that many other parts of the code depend on.

**Parameters:**

| Name | Type | Required | Default | Constraints | Description |
|------|------|----------|---------|-------------|-------------|
| `top_n` | `integer` | no | `20` | 1–100 | Number of top symbols to return |
| `kind` | `string` | no | — | `function`, `class`, `variable` | Filter by symbol kind |
| `language` | `string` | no | — | `python`, `typescript` | Filter by language |
| `file_pattern` | `string` | no | — | glob pattern | Filter by file path |
| `include_edge_types` | `string[]` | no | all types | values from `edgeTypeEnum` | Count only specific edge types |

**Example Invocation:**

```json
{
  "tool": "get_hotspots",
  "arguments": {
    "top_n": 10,
    "kind": "function",
    "language": "python",
    "file_pattern": "backend/**"
  }
}
```

**Example Response:**

```json
{
  "hotspots": [
    { "node": { "id": "func:database:get_db", "type": "function", "label": "get_db", "filePath": "backend/app/database.py" }, "fanIn": 12, "edgeBreakdown": { "calls": 10, "reads": 2 } }
  ],
  "totalSymbolsScanned": 150,
  "truncated": false
}
```

**Usage Tips:**
- Hotspots are the riskiest symbols to modify — many dependents will break.
- Use `include_edge_types: ["calls"]` to focus on call-based coupling only.
- Combine with `get_change_risk` to assess the impact of modifying a hotspot.

---

### 8. `get_impact_analysis`

**Description:** Given a file path, compute the transitive closure of all files and symbols that would be affected by a change to that file. Returns affected files, affected symbols, a risk score, and suggested test files.

**Parameters:**

| Name | Type | Required | Default | Constraints | Description |
|------|------|----------|---------|-------------|-------------|
| `file_path` | `string` | yes | — | min length: 1 | Source file path to analyze |
| `max_depth` | `integer` | no | `3` | 1–5 | Import chain depth |
| `max_files` | `integer` | no | `100` | 1–500 | Maximum affected files to return |

**Example Invocation:**

```json
{
  "tool": "get_impact_analysis",
  "arguments": {
    "file_path": "backend/app/database.py",
    "max_depth": 3,
    "max_files": 100
  }
}
```

**Example Response:**

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

**Usage Tips:**
- Risk score formula: `min(1.0, affectedFiles.length * 0.3 + affectedSymbols.length * 0.1)`.
- A risk score > 0.7 suggests the change needs careful review and comprehensive testing.
- `suggestedTestFiles` are test/spec files found in the blast radius — run these after your change.

### 9. `export_dependency_graph`

**Description:** Export a graph slice for visualization libraries such as D3.js or React Flow. Supports scoping to the full repo, a single file, or a single symbol.

**Parameters:**

| Name | Type | Required | Default | Constraints | Description |
|------|------|----------|---------|-------------|-------------|
| `scope` | `string` | yes | — | `repo`, `file`, `symbol` | Scope of the export |
| `file_path` | `string` | no | — | — | Required when `scope` is `file` |
| `symbol_qualified_name` | `string` | no | — | — | Required when `scope` is `symbol` |
| `max_nodes` | `integer` | no | `2000` | 1–10000 | Maximum nodes in the export |
| `max_edges` | `integer` | no | `4000` | 1–20000 | Maximum edges in the export |

**Example Invocation:**

```json
{
  "tool": "export_dependency_graph",
  "arguments": {
    "scope": "file",
    "file_path": "backend/app/main.py",
    "max_nodes": 500,
    "max_edges": 1000
  }
}
```

**Example Response:**

```json
{
  "graph": {
    "nodes": [
      { "id": "file:backend/app/main.py", "type": "file", "label": "main.py", "filePath": "backend/app/main.py" }
    ],
    "edges": [
      { "source": "file:backend/app/main.py", "target": "file:backend/app/database.py", "type": "imports", "weight": 1.0 }
    ]
  },
  "meta": { "nodeCount": 1, "edgeCount": 1, "scope": "file" }
}
```

**Usage Tips:**
- Use `scope: "repo"` for a full codebase overview (may be large).
- Use `scope: "symbol"` to visualize a single function's neighborhood.
- The response is compatible with D3.js force-directed graph layouts.

---

### 10. `get_module_coupling`

**Description:** Compute coupling metrics between two file paths. Returns shared imports, shared symbols, direct edges, transitive edges, and a normalized coupling score (0.0–1.0).

**Parameters:**

| Name | Type | Required | Default | Constraints | Description |
|------|------|----------|---------|-------------|-------------|
| `file_path_a` | `string` | yes | — | min length: 1 | First file path |
| `file_path_b` | `string` | yes | — | min length: 1 | Second file path |
| `max_depth` | `integer` | no | `2` | 1–5 | Transitive edge depth |

**Example Invocation:**

```json
{
  "tool": "get_module_coupling",
  "arguments": {
    "file_path_a": "backend/app/main.py",
    "file_path_b": "backend/app/database.py",
    "max_depth": 2
  }
}
```

**Example Response:**

```json
{
  "filePathA": "backend/app/main.py",
  "filePathB": "backend/app/database.py",
  "sharedImports": ["backend/app/config.py"],
  "sharedSymbols": ["get_settings"],
  "directEdges": 3,
  "transitiveEdges": 5,
  "couplingScore": 0.45,
  "truncated": false
}
```

**Usage Tips:**
- A coupling score > 0.7 suggests the modules are tightly coupled and may benefit from refactoring.
- Use this before splitting a module to understand how entangled two files are.
- Compare coupling scores across file pairs to find the most coupled modules.

---

### 11. `search_symbols`

**Description:** Fuzzy search across all symbols in the graph by name, kind, and file path. Returns ranked results with match scores. Supports regex patterns for advanced queries.

**Parameters:**

| Name | Type | Required | Default | Constraints | Description |
|------|------|----------|---------|-------------|-------------|
| `query` | `string` | yes | — | min length: 1 | Search string (fuzzy match by default) |
| `kind` | `string` | no | — | `file`, `module`, `function`, `class`, `variable`, `external` | Filter by symbol kind |
| `language` | `string` | no | — | `python`, `typescript` | Filter by language |
| `file_pattern` | `string` | no | — | glob pattern | Filter by file path |
| `use_regex` | `boolean` | no | `false` | — | Treat query as a regex pattern |
| `max_results` | `integer` | no | `50` | 1–200 | Maximum results to return |

**Example Invocation:**

```json
{
  "tool": "search_symbols",
  "arguments": {
    "query": "create_app",
    "kind": "function",
    "language": "python",
    "max_results": 20
  }
}
```

**Example Response:**

```json
{
  "results": [
    { "node": { "id": "func:main:create_app", "type": "function", "label": "create_app", "filePath": "backend/app/main.py", "qualifiedName": "main.create_app" }, "score": 1.0 },
    { "node": { "id": "func:tests:create_test_app", "type": "function", "label": "create_test_app", "filePath": "backend/tests/conftest.py", "qualifiedName": "conftest.create_test_app" }, "score": 0.75 }
  ],
  "totalMatches": 2,
  "truncated": false
}
```

**Usage Tips:**
- Use `use_regex: true` with patterns like `^get_` to find all getter functions.
- Combine `kind` and `language` filters to narrow results quickly.
- Results are ranked by match score — exact matches appear first.

---

### 12. `get_complexity_metrics`

**Description:** Compute per-symbol complexity metrics: fan-in (inbound edges), fan-out (outbound edges), and max call-chain depth via BFS (capped at 10 levels). Results sorted by total complexity descending.

**Parameters:**

| Name | Type | Required | Default | Constraints | Description |
|------|------|----------|---------|-------------|-------------|
| `file_path` | `string` | no | — | glob pattern | Filter by file path |
| `kind` | `string` | no | — | `function`, `class`, `file` | Filter by symbol kind |
| `language` | `string` | no | — | `python`, `typescript` | Filter by language |
| `sort_by` | `string` | no | `"total"` | `fan_in`, `fan_out`, `depth`, `total` | Sort field |
| `max_results` | `integer` | no | `100` | 1–500 | Maximum results to return |

**Example Invocation:**

```json
{
  "tool": "get_complexity_metrics",
  "arguments": {
    "file_path": "backend/**",
    "kind": "function",
    "sort_by": "fan_out",
    "max_results": 20
  }
}
```

**Example Response:**

```json
{
  "metrics": [
    {
      "node": { "id": "func:main:create_app", "type": "function", "label": "create_app", "filePath": "backend/app/main.py", "qualifiedName": "main.create_app" },
      "fanIn": 5,
      "fanOut": 8,
      "maxDepth": 3,
      "totalComplexity": 16
    }
  ],
  "totalScanned": 42,
  "truncated": false
}
```

**Usage Tips:**
- Complexity formula: `totalComplexity = fanIn + fanOut + maxDepth`.
- High `fanOut` symbols are doing too much — consider splitting them.
- High `fanIn` symbols are critical dependencies — modify with care.
- Use `sort_by: "depth"` to find deeply nested call chains.

### 13. `get_circular_dependencies`

**Description:** Detect circular import chains in the codebase. Uses iterative DFS-based cycle detection on the file-level import graph. Supports filtering by file pattern and language.

**Parameters:**

| Name | Type | Required | Default | Constraints | Description |
|------|------|----------|---------|-------------|-------------|
| `file_pattern` | `string` | no | — | glob pattern | Filter by file path |
| `language` | `string` | no | — | `python`, `typescript` | Filter by language |
| `max_cycles` | `integer` | no | `50` | 1–200 | Maximum cycles to return |
| `max_depth` | `integer` | no | `20` | 1–50 | Maximum DFS traversal depth |

**Example Invocation:**

```json
{
  "tool": "get_circular_dependencies",
  "arguments": {
    "file_pattern": "backend/**",
    "language": "python",
    "max_cycles": 20
  }
}
```

**Example Response:**

```json
{
  "cycles": [
    { "chain": ["backend/app/a.py", "backend/app/b.py", "backend/app/a.py"], "length": 2 },
    { "chain": ["backend/app/x.py", "backend/app/y.py", "backend/app/z.py", "backend/app/x.py"], "length": 3 }
  ],
  "totalFilesScanned": 42,
  "truncated": false
}
```

**Usage Tips:**
- `chain` is an ordered array where the first element repeats at the end to show the cycle.
- `length` is the number of unique files in the cycle.
- Shorter cycles (length 2) are usually easier to break than longer ones.
- Use `max_depth` to limit DFS depth in very large codebases.

---

### 14. `get_change_risk`

**Description:** Given a set of changed file paths (e.g., from a git diff), predict which tests should run and which areas of the codebase are highest risk. Aggregates impact analysis across multiple files and cross-references with the top-20 hotspots.

**Parameters:**

| Name | Type | Required | Default | Constraints | Description |
|------|------|----------|---------|-------------|-------------|
| `changed_files` | `string[]` | yes | — | 1–50 items | Array of changed file paths |
| `max_depth` | `integer` | no | `3` | 1–5 | Import chain depth |
| `max_files` | `integer` | no | `100` | 1–500 | Maximum affected files to return |

**Example Invocation:**

```json
{
  "tool": "get_change_risk",
  "arguments": {
    "changed_files": ["backend/app/database.py", "backend/app/models/user.py"],
    "max_depth": 3,
    "max_files": 50
  }
}
```

**Example Response:**

```json
{
  "changedFiles": ["backend/app/database.py", "backend/app/models/user.py"],
  "aggregateRiskScore": 0.72,
  "affectedFiles": [
    { "filePath": "backend/app/main.py", "depth": 1, "impactType": "direct", "riskContribution": 0.5 },
    { "filePath": "backend/app/routers/users.py", "depth": 2, "impactType": "transitive", "riskContribution": 0.5 }
  ],
  "suggestedTestFiles": ["backend/tests/test_database.py", "backend/tests/test_users.py"],
  "hotspotOverlap": [
    { "node": { "id": "func:database:get_db", "type": "function", "label": "get_db", "filePath": "backend/app/database.py" }, "fanIn": 12 }
  ],
  "truncated": false
}
```

**Usage Tips:**
- Feed this tool the output of `git diff --name-only` to assess PR risk.
- `aggregateRiskScore` > 0.7 means the change touches critical paths — review carefully.
- `hotspotOverlap` shows high-fan-in symbols in the blast radius — these are the riskiest.
- `suggestedTestFiles` gives you the minimum test set to run for confidence.

---

### 15. `get_class_hierarchy`

**Description:** Get the class inheritance hierarchy (ancestors and/or descendants) for a given class. Traverses `inherits` edges to build the full hierarchy tree.

**Parameters:**

| Name | Type | Required | Default | Constraints | Description |
|------|------|----------|---------|-------------|-------------|
| `class_name` | `string` | yes | — | min length: 1 | Target class name |
| `file_path` | `string` | no | — | — | File path to disambiguate |
| `direction` | `string` | no | `"both"` | `ancestors`, `descendants`, `both` | Traversal direction |
| `max_depth` | `integer` | no | `5` | 1–10 | Maximum hierarchy depth |

**Example Invocation:**

```json
{
  "tool": "get_class_hierarchy",
  "arguments": {
    "class_name": "BaseModel",
    "direction": "descendants",
    "max_depth": 3
  }
}
```

**Example Response:**

```json
{
  "root": { "id": "class:models:BaseModel", "type": "class", "label": "BaseModel", "filePath": "backend/app/models/base.py" },
  "ancestors": [],
  "descendants": [
    { "node": { "id": "class:models:User", "type": "class", "label": "User", "filePath": "backend/app/models/user.py" }, "depth": 1 },
    { "node": { "id": "class:models:AdminUser", "type": "class", "label": "AdminUser", "filePath": "backend/app/models/admin.py" }, "depth": 2 }
  ],
  "hierarchy": {
    "nodes": [
      { "id": "class:models:BaseModel", "type": "class", "label": "BaseModel" },
      { "id": "class:models:User", "type": "class", "label": "User" },
      { "id": "class:models:AdminUser", "type": "class", "label": "AdminUser" }
    ],
    "edges": [
      { "source": "class:models:User", "target": "class:models:BaseModel", "type": "inherits" },
      { "source": "class:models:AdminUser", "target": "class:models:User", "type": "inherits" }
    ]
  },
  "truncated": false
}
```

**Usage Tips:**
- Use `direction: "ancestors"` to see what a class inherits from (parent chain).
- Use `direction: "descendants"` before modifying a base class to see all affected subclasses.
- The `hierarchy` field provides a graph representation suitable for tree visualization.

---

## Edge Types Reference

All graph edges use one of the following types (defined by `edgeTypeEnum`):

| Edge Type | Description | Example |
|-----------|-------------|---------|
| `imports` | File imports another file or module | `main.py` imports `database.py` |
| `defines` | File defines a symbol (function, class, variable) | `main.py` defines `create_app` |
| `calls` | Function calls another function | `create_app` calls `get_db` |
| `instantiates` | Code instantiates a class | `main.py` instantiates `FastAPI` |
| `reads` | Code reads a variable | `handler` reads `DATABASE_URL` |
| `writes` | Code writes to a variable | `init` writes `app_instance` |
| `references` | Generic reference (fallback when specific type cannot be determined) | `config.py` references `Settings` |
| `exports` | Module exports a symbol | `index.ts` exports `UserService` |
| `inherits` | Class inherits from another class (source = child, target = parent) | `User` inherits `BaseModel` |

**Filtering:** Many tools accept an `include_edge_types` parameter to filter which edge types are considered during traversal. This is useful for focusing on specific relationship types (e.g., only `calls` edges for call graph analysis).

---

## Common Patterns

### Pattern 1: Pre-Refactoring Safety Check

Before refactoring a function, assess the full blast radius:

```
1. get_impact_analysis(file_path: "src/database.py")
   → See all affected files and risk score

2. get_callers(function_name: "get_db", max_depth: 3)
   → Identify all direct and transitive callers

3. get_change_risk(changed_files: ["src/database.py"])
   → Get suggested test files and hotspot overlap
```

### Pattern 2: Dead Code Cleanup Sprint

Systematically identify and remove unused code:

```
1. get_dead_code(language: "python", kind: "function")
   → Get list of unreferenced functions

2. For each candidate, verify with:
   get_symbol_references(symbol_qualified_name: "module.function_name")
   → Confirm zero references (dead code detection may miss dynamic calls)

3. get_file_dependents(file_path: "src/utils.py", direction: "incoming")
   → Check if the file itself is still imported anywhere
```

### Pattern 3: Understanding a New Codebase

When onboarding to an unfamiliar codebase:

```
1. get_hotspots(top_n: 20, kind: "function")
   → Identify the most critical functions (highest fan-in)

2. get_function_context(function_name: "main_entry_point", max_hops: 2)
   → Explore the neighborhood of key entry points

3. get_circular_dependencies(max_cycles: 10)
   → Identify architectural issues early

4. get_complexity_metrics(sort_by: "total", max_results: 10)
   → Find the most complex symbols that may need documentation
```

### Pattern 4: PR Risk Assessment

Before merging a pull request, assess its risk:

```
1. get_change_risk(changed_files: ["file1.py", "file2.py", "file3.ts"])
   → Feed the PR's changed files to get aggregate risk

2. If aggregateRiskScore > 0.7:
   get_module_coupling(file_path_a: "file1.py", file_path_b: "file2.py")
   → Check if changed files are tightly coupled (amplified risk)

3. Review hotspotOverlap from step 1:
   get_callers(function_name: "<hotspot_function>", max_depth: 2)
   → Understand who depends on the hotspot being modified
```
