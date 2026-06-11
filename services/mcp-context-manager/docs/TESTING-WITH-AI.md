# Testing MCP Context Manager with AI Tools

This guide covers how to configure and test the MCP Context Manager with various AI development tools.

---

## Prerequisites

1. MCP services running (Docker or local dev mode):
   ```bash
   ./mcp.sh up        # Docker
   # or
   ./mcp.sh dev       # Local development
   ```
2. Verify the service is healthy:
   ```bash
   curl http://localhost:3001/api/v1/health
   # → {"status":"ok"}
   ```

---

## Testing with Kiro

### Configuration

Kiro uses `.kiro/settings/mcp.json` in your workspace root. The MCP Context Manager connects via Docker exec with `--stdio-only` mode (no HTTP server needed for AI tool communication):

```json
{
  "mcpServers": {
    "mcp-context-manager": {
      "command": "docker",
      "args": ["exec", "-i", "mcp-context-manager", "node", "dist/server.js", "--stdio-only"],
      "disabled": false,
      "autoApprove": ["*"]
    }
  }
}
```

A template is available at `services/mcp-context-manager/kiro-config.template.json`.

### How `--stdio-only` Works

When the `--stdio-only` flag is passed:
- The MCP server starts in stdio-only mode (no HTTP API, no SSE broadcasting)
- Communication happens entirely over stdin/stdout using the MCP protocol
- This is the correct mode for AI tool integrations that use `docker exec -i`

### Verify Connection

After configuring, open Kiro and check the MCP Server panel. The `mcp-context-manager` server should show as connected with 15 available tools.

---

## Testing with Claude Desktop

### Configuration

Add to your `claude_desktop_config.json` (typically at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "mcp-context-manager": {
      "command": "docker",
      "args": ["exec", "-i", "mcp-context-manager", "node", "dist/server.js", "--stdio-only"],
      "disabled": false
    }
  }
}
```

### Verify Connection

1. Restart Claude Desktop after saving the config.
2. Open a new conversation.
3. Look for the MCP tools icon (hammer) in the input area.
4. Click it to see the 15 available tools listed.

---

## Testing with Cursor

### Configuration

Cursor supports MCP servers via HTTP transport. Since the MCP Context Manager exposes an HTTP API on port 3001 (in full mode), you can configure Cursor to connect directly:

**Option A: HTTP transport (full mode)**

Ensure MCP services are running in full mode (default `./mcp.sh up`), then configure Cursor's MCP settings to point to:

```
http://localhost:3001
```

> Note: This requires the HTTP API to be accessible from the host. If using Docker, ensure port 3001 is exposed (add `ports: ["3001:3001"]` to `docker-compose.mcp.yml` for the `mcp-context-manager` service).

**Option B: Docker exec (stdio mode)**

If Cursor supports stdio-based MCP servers, use the same configuration as Kiro/Claude:

```json
{
  "mcpServers": {
    "mcp-context-manager": {
      "command": "docker",
      "args": ["exec", "-i", "mcp-context-manager", "node", "dist/server.js", "--stdio-only"]
    }
  }
}
```

---

## Step-by-Step Testing Workflow

1. **Start MCP services:**
   ```bash
   ./mcp.sh up
   ```

2. **Wait for healthy status:**
   ```bash
   ./mcp.sh status
   # Both containers should show "healthy"
   ```

3. **Configure your AI tool** (see sections above).

4. **Run test queries** (see examples below).

5. **Verify results** match expected output for your codebase.

---

## Example Test Queries for Each MCP Tool

### 1. `search_symbols`

> "Search for all functions containing 'create' in the backend"

Expected: Returns matching function symbols with file paths and qualified names.

```json
{
  "query": "create",
  "kind": "function",
  "language": "python",
  "file_pattern": "backend/**",
  "max_results": 10
}
```

### 2. `get_function_context`

> "Show me the context around the `bootstrap` function in server.ts"

```json
{
  "function_name": "bootstrap",
  "file_path": "services/mcp-context-manager/src/server.ts",
  "max_hops": 2
}
```

### 3. `get_file_dependents`

> "What files depend on backend/app/main.py?"

```json
{
  "file_path": "backend/app/main.py",
  "direction": "incoming",
  "depth": 1
}
```

### 4. `get_symbol_references`

> "Find all references to the UserService class"

```json
{
  "symbol_qualified_name": "UserService",
  "include_calls": true,
  "include_reads": true
}
```

### 5. `export_dependency_graph`

> "Export the full dependency graph for the backend"

```json
{
  "scope": "file",
  "file_path": "backend/",
  "max_nodes": 500,
  "max_edges": 1000
}
```

### 6. `get_callers`

> "Who calls the `send_email` function?"

```json
{
  "function_name": "send_email",
  "max_depth": 3,
  "max_results": 50
}
```

### 7. `get_call_chain`

> "Show the full call chain for `create_app`"

```json
{
  "function_name": "create_app",
  "direction": "downstream",
  "max_depth": 5,
  "max_nodes": 100
}
```

### 8. `get_dead_code`

> "Find unused functions in the backend"

```json
{
  "language": "python",
  "kind": "function",
  "file_pattern": "backend/**",
  "max_results": 50
}
```

### 9. `get_impact_analysis`

> "What would be affected if I change backend/app/models.py?"

```json
{
  "file_path": "backend/app/models.py",
  "max_depth": 3,
  "max_files": 50
}
```

### 10. `get_module_coupling`

> "How coupled are the email sender and the job scheduler?"

```json
{
  "file_path_a": "backend/app/email_sender.py",
  "file_path_b": "backend/app/scheduler.py",
  "max_depth": 2
}
```

### 11. `get_hotspots`

> "What are the most connected symbols in the codebase?"

```json
{
  "top_n": 10,
  "kind": "function"
}
```

### 12. `get_class_hierarchy`

> "Show the inheritance tree for BaseModel"

```json
{
  "class_name": "BaseModel",
  "direction": "descendants",
  "max_depth": 5
}
```

### 13. `get_circular_dependencies`

> "Are there any circular imports in the backend?"

```json
{
  "language": "python",
  "file_pattern": "backend/**",
  "max_cycles": 20
}
```

### 14. `get_complexity_metrics`

> "What are the most complex functions in the project?"

```json
{
  "sort_by": "total",
  "max_results": 20,
  "kind": "function"
}
```

### 15. `get_change_risk`

> "If I modify these files, what's the risk?"

```json
{
  "changed_files": ["backend/app/main.py", "backend/app/models.py"],
  "max_depth": 3,
  "max_files": 50
}
```

---

## Troubleshooting

### "Connection closed" or "Server disconnected"

**Cause:** The MCP container is not running or crashed during startup.

**Fix:**
1. Check container status: `./mcp.sh status`
2. Check logs: `./mcp.sh logs`
3. Rebuild if needed: `./mcp.sh build && ./mcp.sh up`

### "EADDRINUSE: address already in use :::3001"

**Cause:** Another process is already using port 3001, or a previous instance didn't shut down cleanly.

**Fix:**
1. Stop existing services: `./mcp.sh down`
2. Check for orphan processes: `lsof -i :3001`
3. Kill if needed: `kill -9 <PID>`
4. Restart: `./mcp.sh up`

### "indexed 0 files"

**Cause:** The `WORKSPACE_PATH` is misconfigured or the mounted volumes don't contain the expected directory structure (`backend/`, `frontend/`, `services/`).

**Fix:**
1. Verify your workspace path: `echo $WORKSPACE_PATH`
2. Check that the path contains `backend/` and `frontend/` directories
3. If using a custom path, set it in `.env.mcp`:
   ```bash
   WORKSPACE_PATH=/path/to/your/project
   ```
4. Restart: `./mcp.sh down && ./mcp.sh up`

### "Tool not found" or "No tools available"

**Cause:** The MCP server connected but tools weren't registered (possible build issue).

**Fix:**
1. Rebuild the container: `./mcp.sh build`
2. Verify the build succeeded: `./mcp.sh shell` then `ls dist/`
3. Check that `dist/server.js` exists and is recent
4. Restart your AI tool after rebuilding

### Slow initial response

**Cause:** The service is still indexing files on first startup.

**Fix:** Wait for indexing to complete. Check logs:
```bash
./mcp.sh logs
# Look for: [live-context-manager] indexed 215 files
```

Subsequent startups are faster due to graph snapshot persistence.

### Docker exec hangs

**Cause:** The container is in an unhealthy state or the entrypoint crashed.

**Fix:**
1. Check health: `docker inspect mcp-context-manager --format='{{.State.Health.Status}}'`
2. If unhealthy, restart: `./mcp.sh restart`
3. If the container keeps crashing, check logs for the root cause: `./mcp.sh logs`
