# Troubleshooting Guide

A focused troubleshooting reference for common issues when running the MCP Context Manager service — covering Docker, port conflicts, indexing failures, AI tool connectivity, and performance.

---

## Quick Diagnostics

Use this decision tree to find the right section:

```
Service won't start?
  → See: Port Conflicts, Docker Issues

Can't connect from AI tool?
  → See: AI Tool Connectivity

Indexing stuck or 0 files?
  → See: Indexing Failures, WORKSPACE_PATH Issues

SSE not working?
  → See: SSE Connection Issues

Slow queries or OOM?
  → See: Performance Issues
```

**First step for any issue:**

```bash
# Check container health
./mcp.sh status

# View recent logs
./mcp.sh logs | tail -50
```

---

## Port Conflicts

### Symptom: `EADDRINUSE: address already in use :::3001`

The HTTP API server cannot bind to port 3001 because another process is already using it.

### Diagnosis

```bash
# Find what's using port 3001
lsof -i :3001
```

### Fixes

**Option A: Stop the conflicting process**

```bash
# Kill the process using port 3001
kill -9 $(lsof -ti :3001)
```

**Option B: Change the HTTP port**

Set the `HTTP_PORT` environment variable in `docker-compose.mcp.yml`:

```yaml
environment:
  - WORKSPACE_ROOT=/workspace
  - HTTP_PORT=3002  # Use a different port
```

Then update the health check to match:

```yaml
healthcheck:
  test: ["CMD", "wget", "-qO", "/dev/null", "http://localhost:3002/api/health"]
```

Restart after changes:

```bash
./mcp.sh down
./mcp.sh up
```

**Option C: Docker port mapping conflict (MCP UI)**

If port 8080 (MCP Context UI) is in use:

```bash
lsof -i :8080
```

Edit `docker-compose.mcp.yml` to change the host port:

```yaml
mcp-context-ui:
  ports:
    - "9090:80"  # Map to 9090 instead of 8080
```

---

## Docker Issues

### Container won't start

**Check logs for the root cause:**

```bash
./mcp.sh logs mcp-context-manager
```

**Common causes:**

| Log Message | Cause | Fix |
|-------------|-------|-----|
| `Cannot find module 'tree-sitter'` | Native module build failed | `./mcp.sh build --no-cache` |
| `Error: Cannot find module '/app/dist/server.js'` | TypeScript compilation failed | Check build logs: `./mcp.sh build` |
| `exec /usr/local/bin/docker-entrypoint.sh: exec format error` | Wrong platform image | Rebuild: `docker compose -f docker-compose.mcp.yml build --no-cache` |

### `mcp-network` doesn't exist

If you see `network mcp-network declared as external, but could not be found`:

```bash
docker network create mcp-network
```

However, the default `docker-compose.mcp.yml` creates the network automatically (it's not declared as external). If you see this error, ensure you're using the correct compose file:

```bash
docker compose -f docker-compose.mcp.yml up -d
```

### Volume mount permissions

**Symptom:** Container starts but logs show permission errors reading workspace files.

**Diagnosis:**

```bash
docker exec mcp-context-manager ls -la /workspace/
```

**Fix:** All volumes are mounted read-only (`:ro`). Ensure the host files are readable by the Docker daemon. On macOS with Docker Desktop, this is typically automatic. On Linux:

```bash
# Ensure files are world-readable
chmod -R a+r ./backend ./frontend ./services
```

### OOM kills (Out of Memory)

**Symptom:** Container exits with code 137, or `docker inspect` shows `OOMKilled: true`.

**Diagnosis:**

```bash
docker inspect mcp-context-manager --format='{{.State.OOMKilled}}'
docker stats mcp-context-manager --no-stream
```

**Fix:** Increase the memory limit in `docker-compose.mcp.yml`:

```yaml
deploy:
  resources:
    limits:
      memory: 1024M  # Increase from default 512M
```

Then restart:

```bash
./mcp.sh down
./mcp.sh up
```

### Container keeps restarting

**Symptom:** `./mcp.sh status` shows the container restarting repeatedly.

**Diagnosis:**

```bash
# View exit code and restart count
docker inspect mcp-context-manager --format='{{.RestartCount}} restarts, exit code: {{.State.ExitCode}}'

# View last crash logs
docker logs mcp-context-manager --tail 50
```

**Common causes:**
- Fatal error during bootstrap (check logs for `[live-context-manager] fatal error`)
- Native module incompatibility (rebuild with `--no-cache`)
- Corrupt snapshot file (see Indexing Failures below)

---

## WORKSPACE_PATH / WORKSPACE_ROOT Issues

### How workspace resolution works

1. **Docker mode:** `WORKSPACE_ROOT=/workspace` is set explicitly in `docker-compose.mcp.yml`. Host directories are mounted into `/workspace/` via volume mounts.
2. **Local mode:** If `WORKSPACE_ROOT` is not set, the server walks up from `cwd` (up to 6 levels) looking for a directory containing both `backend/` and `frontend/` subdirectories. Falls back to `cwd` if not found.

### Symptom: `indexed 0 files`

The service started but found no files to index.

**Diagnosis:**

```bash
# Check what WORKSPACE_ROOT is set to
docker exec mcp-context-manager env | grep WORKSPACE_ROOT

# Verify workspace directories exist inside the container
docker exec mcp-context-manager ls -la /workspace/

# Expected output should show: backend/, frontend/, services/
```

**Fixes:**

1. **Missing volume mounts:** Ensure `docker-compose.mcp.yml` has the correct volume mappings:
   ```yaml
   volumes:
     - ${WORKSPACE_PATH:-.}/backend:/workspace/backend:ro
     - ${WORKSPACE_PATH:-.}/frontend:/workspace/frontend:ro
     - ${WORKSPACE_PATH:-.}/services:/workspace/services:ro
   ```

2. **Wrong WORKSPACE_PATH:** If your project is in a different directory, set `WORKSPACE_PATH` in `.env.mcp`:
   ```bash
   WORKSPACE_PATH=/path/to/your/project
   ```

3. **Relative vs absolute paths:** `WORKSPACE_PATH` supports both relative (to the compose file location) and absolute paths. When in doubt, use an absolute path.

4. **Default globs are workspace-wide** (`**/*.py`, `**/*.{ts,tsx,js,jsx}`) and should match any layout. If you still see 0 files, verify `WORKSPACE_PATH` points to your project root. To narrow the scope, set `PYTHON_WATCH_GLOBS` and `TS_WATCH_GLOBS` in `.env.mcp`.

5. **Nested-template layout** (e.g., `.tools/mcp-context-manager/` inside workspace): confirm `WORKSPACE_PATH` points to the project root (not the template directory). The built-in excludes prevent template self-indexing automatically.

6. **Debug which files are being picked up:**
   ```bash
   docker exec mcp-context-manager find /workspace -name "*.ts" | grep -v node_modules | head -20
   ```

7. **Run `./mcp.sh doctor`** for a full diagnostics snapshot including resolved globs, ignore patterns, and per-cluster file counts.

### Symptom: Files indexed but paths are wrong

**Cause:** `WORKSPACE_ROOT` doesn't match the mount point.

**Fix:** Ensure `WORKSPACE_ROOT=/workspace` in the container environment matches where volumes are mounted (`/workspace/backend`, `/workspace/frontend`, etc.).

---

## WORKSPACE_PATH Validation Errors

### Symptom: `mcp.sh up` exits with "WORKSPACE_PATH does not resolve to an existing directory"

`validate_workspace()` in `mcp.sh` reads `WORKSPACE_PATH` from `.env.mcp`, resolves it relative to the repo root, and exits before starting containers if the path doesn't exist.

**Fix:** Edit `.env.mcp` and set `WORKSPACE_PATH` to your project root. The path can be relative (resolved from the repo root) or absolute. Default is `.` (the repo root itself).

```bash
# Example: absolute path
WORKSPACE_PATH=/Users/dev/projects/my-app

# Example: relative path (from repo root)
WORKSPACE_PATH=../my-other-project
```

---

## Indexing Failures

### Large repos timing out

**Symptom:** Service takes too long to start, or health check fails before indexing completes.

**Diagnosis:**

```bash
# Watch indexing progress in real-time
./mcp.sh logs -f | grep "indexing"
# Expected: [live-context-manager] indexing 42/215
```

**Fixes:**

1. **Increase health check start period** in `docker-compose.mcp.yml`:
   ```yaml
   healthcheck:
     start_period: 60s  # Increase from default 10s for large repos
   ```

2. **Use graph snapshots:** After the first successful indexing, a snapshot is saved to disk. Subsequent startups load from the snapshot and only re-parse changed files (delta indexing). This reduces startup from ~10s to <1s.

3. **Reduce scope:** If you only need to analyze part of the codebase, adjust the volume mounts to include only relevant directories.

### Unsupported file types silently skipped

The indexer only processes:
- `backend/**/*.py` (Python)
- `frontend/src/**/*.{ts,tsx,js,jsx}` (TypeScript/JavaScript)
- `services/**/*.{ts,tsx,js,jsx}` (TypeScript/JavaScript)

Files outside these patterns (e.g., `.json`, `.md`, `.css`, `.html`) are not indexed. This is by design — the service focuses on code structure analysis.

### Snapshot corruption

**Symptom:** Service crashes on startup with a JSON parse error, or logs show `failed to load snapshot`.

**Fix:** Delete the snapshot file to force a full re-index:

```bash
# Docker mode
docker exec mcp-context-manager rm -f /tmp/.mcp-cache/graph-snapshot.json

# Local mode
rm -f .mcp-cache/graph-snapshot.json
```

Then restart:

```bash
./mcp.sh restart
```

The service gracefully falls back to a full `buildInitialGraph()` when the snapshot is missing or corrupt.

### Snapshot location

| Mode | Default Path |
|------|-------------|
| Docker (`WORKSPACE_ROOT=/workspace`) | `/tmp/.mcp-cache/graph-snapshot.json` |
| Local development | `{WORKSPACE_ROOT}/.mcp-cache/graph-snapshot.json` |
| Custom | Set `GRAPH_SNAPSHOT_DIR` environment variable |

---

## AI Tool Connectivity

### Kiro can't connect

**Configuration file:** `.kiro/settings/mcp.json` in your workspace root.

**Required config:**

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

**Checklist:**
1. Container is running: `./mcp.sh status` → shows "healthy"
2. Container name matches config: must be `mcp-context-manager`
3. The `--stdio-only` flag is present in args
4. The path is `dist/server.js` (not `src/server.ts`)
5. Kiro MCP Server panel shows the server as connected

### Claude Desktop can't connect

**Configuration file:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)

**Required config:**

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

**Checklist:**
1. Restart Claude Desktop after saving config changes
2. Container must be running before Claude Desktop starts
3. Look for the hammer (🔨) icon in the chat input area — click to verify 15 tools are listed

### Cursor can't connect

**Option A — stdio mode** (same as Kiro/Claude):

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

**Option B — HTTP mode** (requires port exposure):

Add port mapping to `docker-compose.mcp.yml`:

```yaml
mcp-context-manager:
  ports:
    - "3001:3001"  # Expose to host
```

Then configure Cursor to connect to `http://localhost:3001`.

### Common AI tool issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Connection closed" | Container not running or crashed | `./mcp.sh status` then `./mcp.sh up` |
| "Tool not found" / "No tools available" | Build artifacts missing | `./mcp.sh build && ./mcp.sh restart` |
| `docker exec` hangs | Container unhealthy or entrypoint crashed | `./mcp.sh restart` |
| Slow first response | Service still indexing | Wait for `indexed N files` in logs |
| "Server disconnected" after a while | Container OOM killed or restarted | Check `docker inspect` for OOMKilled, increase memory |

### Testing the stdio connection manually

```bash
# Send an MCP initialize request directly
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | \
  docker exec -i mcp-context-manager node dist/server.js --stdio-only
```

You should receive a JSON response with `serverInfo` and `capabilities`. If you get no output or an error, the service has a startup issue — check `./mcp.sh logs`.

---

## SSE Connection Issues

For detailed SSE architecture, event types, reconnection strategy, and nginx proxy configuration, see the dedicated [SSE documentation](./SSE.md).

### Quick summary

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| No events received | `proxy_buffering` is on in nginx | Add `proxy_buffering off` to the SSE location block |
| Connection drops every 60s | Default `proxy_read_timeout` overriding SSE config | Set `proxy_read_timeout 3600s` in the `/api/v1/mcp/events` location |
| Connection refused | `mcp-context-manager` service is down | `./mcp.sh up` |
| Immediate disconnect loop | Backend crashing on startup | Check `./mcp.sh logs` for fatal errors |
| No `indexing-complete` event | Connected after indexing finished (pre-v1.3) | Upgrade to latest — late-connecting clients now receive `indexing-complete` automatically |

### Testing SSE manually

```bash
# Stream events (Ctrl+C to stop)
curl -N http://localhost:8080/api/v1/mcp/events

# Expected first event:
# event: connected
# data: {"timestamp":1714934400000}
```

If connecting through the MCP UI (port 8080), the nginx proxy handles the connection. If connecting directly to the manager (port 3001, requires port exposure), use:

```bash
curl -N http://localhost:3001/api/v1/mcp/events
```

---

## Performance Issues

### Large repositories (10,000+ files)

**Symptoms:** Slow startup, high memory usage, query timeouts.

**Mitigations:**

1. **Graph snapshots:** After first indexing, the snapshot enables delta-only re-indexing on restart (<1s vs ~10s).

2. **Memory limits:** Increase from 512MB to 1024MB or higher:
   ```yaml
   deploy:
     resources:
       limits:
         memory: 1024M
   ```

3. **Reduce indexed scope:** Only mount the directories you need:
   ```yaml
   volumes:
     - ./backend:/workspace/backend:ro
     # Remove frontend/services if not needed
   ```

4. **Query parameters:** Use `max_results`, `max_nodes`, `max_files` parameters to limit response sizes.

### Query timeouts (HTTP 504)

All query endpoints have a 5-second timeout with 2 retries (500ms backoff between retries).

**Symptom:** API returns `{"error":"...","code":"TIMEOUT","retryable":true}`

**Fixes:**
- Reduce query scope: use `file_pattern` to narrow results
- Reduce depth: lower `max_depth` parameter
- Reduce result count: lower `max_results` or `max_nodes`

### Cluster configuration for faster indexing

The cluster configuration (`cluster-config.json`) affects geographic mapping but not indexing speed. To improve indexing performance:

1. Ensure the snapshot file persists across restarts (use a Docker volume if needed)
2. Keep the workspace scope minimal (only mount directories you need analyzed)
3. The file watcher debounces changes (200ms per file, 500ms batch flush) to avoid excessive re-parsing

See [CLUSTER-CONFIG.md](./CLUSTER-CONFIG.md) for cluster configuration details.

---

## Common Error Messages

| Error Message | Source | Meaning | Fix |
|---------------|--------|---------|-----|
| `[live-context-manager] fatal error` | `server.ts` | Unhandled exception during bootstrap | Check full stack trace in logs |
| `[live-context-manager] indexed 0 files` | `server.ts` | No files matched indexing patterns | Check WORKSPACE_ROOT and volume mounts |
| `[live-context-manager] failed to save snapshot: <msg>` | `graph-persistence.ts` | Snapshot write failed (permissions or disk full) | Check disk space and `/tmp` permissions |
| `[live-context-manager] parse error in <file>` | Indexer | AST parsing failed for a file | File is skipped; fix syntax error in source |
| `[cluster-config] failed to load config: <msg>` | `cluster-config-loader.ts` | Invalid JSON in `cluster-config.json` | Validate JSON syntax in `cluster-config.json` |
| `{"error":"...","code":"TIMEOUT","retryable":true}` | `api.ts` | Query exceeded 5s timeout after retries | Reduce query scope or depth |
| `{"error":"...","code":"INVALID_PARAMS","retryable":false}` | `api.ts` | Missing or invalid request parameters | Check parameter names and types |
| `{"error":"...","code":"NOT_FOUND","retryable":false}` | `api.ts` | Target symbol or file not in graph | Verify the file is indexed and path is correct |
| `EADDRINUSE: address already in use :::3001` | Node.js | Port 3001 already bound | See Port Conflicts section |
| `ENOENT: no such file or directory` | File watcher | Watched file was deleted before read | Transient — file watcher retries on next change |

---

## Diagnostic Commands Reference

```bash
# ─── Service Status ─────────────────────────────────────────────
./mcp.sh status                    # Container status (healthy/unhealthy)
./mcp.sh logs                      # Tail all MCP service logs
./mcp.sh logs mcp-context-manager  # Tail manager logs only

# ─── Container Inspection ───────────────────────────────────────
docker inspect mcp-context-manager --format='{{.State.Health.Status}}'
docker inspect mcp-context-manager --format='{{.State.OOMKilled}}'
docker stats mcp-context-manager --no-stream

# ─── Workspace Verification ─────────────────────────────────────
docker exec mcp-context-manager env | grep WORKSPACE_ROOT
docker exec mcp-context-manager ls -la /workspace/
docker exec mcp-context-manager ls /workspace/backend/ | head -5

# ─── Network & Connectivity ─────────────────────────────────────
docker network ls | grep mcp
docker exec mcp-context-ui wget -qO- http://mcp-context-manager:3001/api/health
curl http://localhost:3001/api/health        # Only if port is exposed
curl http://localhost:8080/api/v1/mcp/graph?scope=repo&max_nodes=5

# ─── Port Conflicts ─────────────────────────────────────────────
lsof -i :3001
lsof -i :8080

# ─── Service Management ─────────────────────────────────────────
./mcp.sh restart                   # Restart all MCP services
./mcp.sh build --no-cache          # Full rebuild (fixes native module issues)
./mcp.sh shell                     # Open shell in manager container

# ─── Testing ────────────────────────────────────────────────────
./mcp.sh test                      # Run vitest test suite
```

---

## Related Documentation

- [Setup Guide](./SETUP.md) — Installation and initial configuration
- [SSE Documentation](./SSE.md) — Detailed SSE architecture, nginx config, and reconnection strategy
- [Cluster Configuration](./CLUSTER-CONFIG.md) — Geographic mapping and cluster setup
- [Testing with AI Tools](./TESTING-WITH-AI.md) — AI tool configuration and example queries
