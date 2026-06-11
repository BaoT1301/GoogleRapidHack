# Setup Guide

Complete instructions for running the MCP Context Manager with Docker or locally.

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Docker | 24+ | With Docker Compose v2 |
| Node.js | 20+ | Only needed for local dev |
| npm | 9+ | Only needed for local dev |
| Python 3 | 3.10+ | Required for tree-sitter native builds |
| make, g++ | — | Required for native module compilation |

---

## Docker Setup (Recommended)

The MCP services run in an isolated Docker Compose stack, separate from the main application.

### 1. Configure Workspace Path

The `WORKSPACE_PATH` variable tells MCP which directory to scan. By default it uses the current directory (`.`).

`./mcp.sh up` automatically copies `.env.mcp.example` → `.env.mcp` on first run, so manual copying is optional. Only copy manually if you want to customize values before the first `up`.

```bash
# Optional: copy manually to customize before first run
cp .env.mcp.example .env.mcp

# Edit if your workspace is elsewhere
# WORKSPACE_PATH=/path/to/your/project
```

> **Validation:** If `WORKSPACE_PATH` doesn't resolve to an existing directory, `mcp.sh` exits before starting containers with a clear error. Edit `.env.mcp` and correct the path.

**Examples:**

| Scenario | Value |
|----------|-------|
| MCP lives inside the project (default) | `WORKSPACE_PATH=.` |
| MCP scans a sibling directory | `WORKSPACE_PATH=../my-other-project` |
| Absolute path | `WORKSPACE_PATH=/Users/dev/projects/my-app` |

### 2. Configure Cluster Mapping

Create or edit `services/mcp-context-manager/cluster-config.json` to define how your project directories map to clusters:

```json
{
  "clusters": [
    { "id": "backend", "path": "backend/", "label": "Backend Services", "color": "#4A90E2" },
    { "id": "frontend", "path": "frontend/", "label": "Frontend Application", "color": "#E24A4A" },
    { "id": "services", "path": "services/", "label": "Services", "color": "#4AE290" }
  ]
}
```

See [`CLUSTER-CONFIG.md`](CLUSTER-CONFIG.md) for the full schema and advanced examples.

### 3. Start Services

```bash
# Build and start
./mcp.sh build
./mcp.sh up

# Check status
./mcp.sh status
```

### 4. Verify

```bash
# Health check
curl http://localhost:3001/api/health
# → {"status":"ok"}

# Check indexed file count (from logs)
./mcp.sh logs | grep "indexed"
# → [live-context-manager] indexed 203 files

# Query the graph
curl "http://localhost:3001/api/v1/mcp/graph?scope=repo&max_nodes=50"
```

---

## Port Architecture

| Port | Protocol | Purpose | Exposed To |
|------|----------|---------|------------|
| 3001 | HTTP | API server for MCP UI and direct queries | Docker network only (via `expose`) |
| 8080 | HTTP | MCP Context UI (Nginx → React SPA) | Host machine (via `ports`) |
| stdio | MCP | AI tool communication (`--stdio-only` mode) | `docker exec` only |

**How AI tools connect:**

AI tools (Kiro, Claude Desktop, Cursor) invoke the MCP server via `docker exec` with the `--stdio-only` flag. This skips the HTTP server entirely and communicates over stdin/stdout using the MCP protocol:

```
AI Tool → docker exec -i mcp-context-manager node dist/server.js --stdio-only → MCP stdio
```

The HTTP API (port 3001) is used exclusively by the MCP Context UI for visualization.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKSPACE_ROOT` | `/workspace` (Docker) or auto-detected (local) | Absolute path to the repository root inside the container |
| `HTTP_PORT` | `3001` | Port for the HTTP API server |
| `GRAPH_SNAPSHOT_DIR` | `.mcp-cache/` or `/tmp/.mcp-cache/` (Docker) | Directory for graph snapshot persistence |
| `WORKSPACE_PATH` | `.` (compose variable) | Host path mounted into the container as `/workspace` |
| `PYTHON_WATCH_GLOBS` | `**/*.py` | Comma-separated glob patterns for Python files (workspace-wide, brace-expansion safe) |
| `TS_WATCH_GLOBS` | `**/*.{ts,tsx,js,jsx}` | Comma-separated glob patterns for TypeScript/JavaScript files (workspace-wide, brace-expansion safe) |
| `WATCH_IGNORES` | *(14-entry built-in list)* | Comma-separated glob patterns to exclude from indexing and watching. Defaults cover `node_modules`, `dist`, `build`, `.next`, `.turbo`, `coverage`, `.git`, `.venv`, `venv`, `__pycache__`, `.tools/mcp-context-*`, `services/mcp-context-*`, `.kiro`, `.claude`. |

---

## Docker Compose File Reference

The MCP services are defined in `docker-compose.mcp.yml` at the repository root:

```yaml
services:
  mcp-context-manager:
    container_name: mcp-context-manager
    build:
      context: .
      dockerfile: services/mcp-context-manager/Dockerfile
    environment:
      - WORKSPACE_ROOT=/workspace
      - HTTP_PORT=3001
    volumes:
      - ${WORKSPACE_PATH:-.}/backend:/workspace/backend:ro
      - ${WORKSPACE_PATH:-.}/frontend:/workspace/frontend:ro
      - ${WORKSPACE_PATH:-.}/services:/workspace/services:ro
      - ./services/mcp-context-manager/cluster-config.json:/workspace/cluster-config.json:ro
    expose:
      - "3001"
    networks:
      - mcp-network

  mcp-context-ui:
    container_name: mcp-context-ui
    build:
      context: ./services/mcp-context-ui
    ports:
      - "8080:80"
    depends_on:
      mcp-context-manager:
        condition: service_healthy
    networks:
      - mcp-network

networks:
  mcp-network:
    driver: bridge
```

Key points:
- All source volumes are mounted **read-only** (`:ro`)
- The `mcp-network` bridge is created by this compose file (not external)
- `mcp-context-ui` waits for the manager's health check before starting
- Memory is capped at 512 MB for the manager, 256 MB for the UI

---

## CLI Reference (`mcp.sh`)

```bash
./mcp.sh up          # Start MCP services (docker compose up -d); auto-copies .env.mcp on first run
./mcp.sh down        # Stop MCP services
./mcp.sh build       # Build Docker images
./mcp.sh logs        # Tail logs (Ctrl+C to stop)
./mcp.sh dev         # Run locally without Docker (tsx + vite)
./mcp.sh restart     # Restart containers
./mcp.sh status      # Show container status
./mcp.sh test        # Run vitest test suite
./mcp.sh shell       # Open sh in the manager container
./mcp.sh doctor      # Call /api/v1/diag, pretty-print result; exits 0 (healthy) / 2 (container down) / 3 (curl fail) / 4 (degraded)
```

---

## Local Development (Without Docker)

```bash
cd services/mcp-context-manager

# Install dependencies (includes native tree-sitter build)
npm install

# Start in dev mode (tsx hot-reload)
npm run dev

# In another terminal, start the UI
cd ../mcp-context-ui
npm install
npm run dev
```

When running locally, `WORKSPACE_ROOT` is auto-detected by walking up from `cwd` to find `backend/` and `frontend/` directories.

---

## Verification Steps

After starting the services, verify everything is working:

### 1. Container Health

```bash
./mcp.sh status
# Both containers should show "healthy"
```

### 2. Indexed Files

```bash
./mcp.sh logs | grep "indexed"
# Expected: [live-context-manager] indexed 200+ files
# If you see "indexed 0 files", check WORKSPACE_ROOT and volume mounts
```

### 3. HTTP API

```bash
# Health
curl http://localhost:3001/api/health

# Clusters
curl http://localhost:3001/api/v1/mcp/clusters

# Graph export (small sample)
curl "http://localhost:3001/api/v1/mcp/graph?scope=repo&max_nodes=10"
```

### 4. AI Tool Connection

```bash
# Test stdio mode directly
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | \
  docker exec -i mcp-context-manager node dist/server.js --stdio-only
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `indexed 0 files` | WORKSPACE_ROOT incorrect or volumes not mounted | Check `docker exec mcp-context-manager ls /workspace/` |
| `EADDRINUSE 3001` | Another process on port 3001 | Stop conflicting process or change `HTTP_PORT` |
| Container exits immediately | Native module build failure | Rebuild: `./mcp.sh build --no-cache` |
| `Cannot find module 'tree-sitter'` | npm install failed | `./mcp.sh shell` then `npm rebuild` |
| UI shows empty graph | Manager not healthy yet | Wait for health check, then refresh |
| `Connection refused` from AI tool | Container not running | `./mcp.sh up` and verify with `./mcp.sh status` |

---

## Next Steps

- Configure your AI tool: see [`TESTING-WITH-AI.md`](TESTING-WITH-AI.md)
- Customize clusters: see [`CLUSTER-CONFIG.md`](CLUSTER-CONFIG.md)
- Add MCP to another project: see [`NEW-PROJECT.md`](NEW-PROJECT.md)
