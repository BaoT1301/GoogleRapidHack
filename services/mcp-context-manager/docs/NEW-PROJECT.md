# Adding MCP Context Manager to a New Project

This guide walks through setting up the MCP Context Manager for any project, enabling AI-powered code structure analysis and dependency tracking.

---

## Prerequisites

- **Docker** (v24+) and **Docker Compose** (v2+)
- **Node.js 20+** (only for local development mode)
- **npm** (only for local development mode)
- A project with Python (`.py`) and/or TypeScript/JavaScript (`.ts`, `.tsx`, `.js`, `.jsx`) source files

---

## Step 1: Copy Infrastructure Files

Copy the following files from this repository to your project root:

```bash
# From the MCP Context Manager repository, copy:
cp docker-compose.mcp.yml /path/to/your-project/
cp mcp.sh /path/to/your-project/
cp .env.mcp.example /path/to/your-project/

# Make the CLI executable
chmod +x /path/to/your-project/mcp.sh
```

You also need the MCP Context Manager source. Either:

**Option A:** Copy the service directory:
```bash
cp -r services/mcp-context-manager /path/to/your-project/services/mcp-context-manager
```

**Option B:** Reference it as a Git submodule or publish as a Docker image.

---

## Step 2: Create `cluster-config.json`

Create a `cluster-config.json` at your project root. This file defines how your source code is grouped into logical clusters for analysis and visualization.

```json
{
  "clusters": [
    {
      "id": "your-cluster-id",
      "path": "src/",
      "label": "Source Code",
      "color": "#4A90D9"
    }
  ]
}
```

Each cluster maps a directory prefix to a logical group. The `path` field uses prefix matching — any file whose relative path starts with that prefix belongs to the cluster.

**See also:** [CLUSTER-CONFIG.md](./CLUSTER-CONFIG.md) for the full schema and advanced examples.

---

## Customizing Watch Paths

By default the indexer watches these glob patterns:

| Variable | Default |
|---|---|
| `PYTHON_WATCH_GLOBS` | `backend/**/*.py` |
| `TS_WATCH_GLOBS` | `frontend/src/**/*.{ts,tsx,js,jsx},services/**/*.{ts,tsx,js,jsx}` |

Set either variable in `.env.mcp` to override. Use comma-separated globs for multiple patterns.

**Example `.env.mcp` snippet:**

```bash
# Watch a Django app instead of backend/
PYTHON_WATCH_GLOBS=myapp/**/*.py,tests/**/*.py

# Watch a Next.js app and a shared packages directory
TS_WATCH_GLOBS=src/**/*.{ts,tsx},packages/**/*.{ts,tsx}
```

The file watcher derives its watch directories from the same env vars — it extracts the literal path prefix before the first glob wildcard (e.g., `myapp/**/*.py` → watches `myapp/`).

---

## Step 3: Configure `WORKSPACE_PATH`

Create a `.env.mcp` file (or rename `.env.mcp.example`):

```bash
# Path to the workspace MCP should scan
# Use "." for the current directory, or an absolute/relative path
WORKSPACE_PATH=.
```

Then update `docker-compose.mcp.yml` to load it:

```yaml
services:
  mcp-context-manager:
    env_file:
      - .env.mcp
```

Or simply rely on the default (`WORKSPACE_PATH=.` is the default in the compose file).

---

## Step 4: Update Volume Mounts

Edit `docker-compose.mcp.yml` to mount your project's source directories. The MCP Context Manager needs read-only access to the directories it should analyze:

```yaml
volumes:
  - ${WORKSPACE_PATH:-.}/src:/workspace/src:ro
  - ${WORKSPACE_PATH:-.}/lib:/workspace/lib:ro
  - ./cluster-config.json:/workspace/cluster-config.json:ro
```

**Important:** All source volumes must be mounted under `/workspace/` and use the `:ro` (read-only) flag.

---

## Step 5: Configure Your AI Tool

### Kiro

Create `.kiro/settings/mcp.json` in your project root:

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

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

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

### Cursor

Use stdio transport with the same Docker exec configuration, or connect via HTTP at `http://localhost:3001` if you expose the port.

---

## Step 6: Start Services and Verify

```bash
# Build and start
./mcp.sh build
./mcp.sh up

# Check status (wait for "healthy")
./mcp.sh status

# Verify indexing completed
./mcp.sh logs
# Look for: [live-context-manager] indexed N files

# Test the health endpoint
curl http://localhost:3001/api/v1/health
# → {"status":"ok"}
```

---

## Example: Adding MCP to a Next.js Project

### Project structure

```
my-nextjs-app/
├── src/
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── utils/
├── package.json
└── tsconfig.json
```

### `cluster-config.json`

```json
{
  "clusters": [
    {
      "id": "app",
      "path": "src/app/",
      "label": "App Router",
      "color": "#4A90D9"
    },
    {
      "id": "components",
      "path": "src/components/",
      "label": "Components",
      "color": "#7B68EE"
    },
    {
      "id": "lib",
      "path": "src/lib/",
      "label": "Libraries",
      "color": "#50C878"
    },
    {
      "id": "utils",
      "path": "src/utils/",
      "label": "Utilities",
      "color": "#FFB347"
    }
  ]
}
```

### `docker-compose.mcp.yml` volumes

```yaml
volumes:
  - ${WORKSPACE_PATH:-.}/src:/workspace/src:ro
  - ./cluster-config.json:/workspace/cluster-config.json:ro
```

### File patterns

The TypeScript parser watches `services/**/*.{ts,tsx,js,jsx}` and `frontend/src/**/*.{ts,tsx,js,jsx}` by default. For a Next.js project where source lives in `src/`, you may need to adjust the `WORKSPACE_ROOT` so that the indexer finds your files under the expected paths.

Set `WORKSPACE_ROOT=/workspace` in the container environment and mount `src/` to `/workspace/src/`. The indexer will pick up `.ts` and `.tsx` files automatically.

---

## Example: Adding MCP to a Python Django Project

### Project structure

```
my-django-app/
├── myapp/
│   ├── models.py
│   ├── views.py
│   ├── urls.py
│   └── services/
├── manage.py
├── requirements.txt
└── pyproject.toml
```

### `cluster-config.json`

```json
{
  "clusters": [
    {
      "id": "django-app",
      "path": "myapp/",
      "label": "Django App",
      "color": "#2E8B57"
    },
    {
      "id": "tests",
      "path": "tests/",
      "label": "Tests",
      "color": "#CD853F"
    }
  ]
}
```

### `docker-compose.mcp.yml` volumes

```yaml
volumes:
  - ${WORKSPACE_PATH:-.}/myapp:/workspace/myapp:ro
  - ${WORKSPACE_PATH:-.}/tests:/workspace/tests:ro
  - ./cluster-config.json:/workspace/cluster-config.json:ro
```

### File patterns

The Python parser watches `backend/**/*.py` by default. For a Django project, mount your Python source directories under `/workspace/` and they will be indexed. If your source is not under a `backend/` prefix, the indexer's glob patterns may need adjustment in the source code or via environment configuration.

---

## Customization Checklist

After copying the infrastructure files, review and adjust:

- [ ] **`cluster-config.json`** — Define clusters matching your project structure
- [ ] **`docker-compose.mcp.yml` volumes** — Mount all source directories you want analyzed
- [ ] **AI tool config** — Point to the correct container name
- [ ] **`.gitignore`** — Add `.mcp-cache/` to ignore the graph snapshot directory
- [ ] **Port conflicts** — If port 3001 or 8080 is in use, update the compose file

---

## Verifying Everything Works

After setup, run these checks:

```bash
# 1. Services are healthy
./mcp.sh status

# 2. Files were indexed
./mcp.sh logs | grep "indexed"

# 3. API responds
curl http://localhost:3001/api/v1/health

# 4. Graph has data
curl http://localhost:3001/api/v1/mcp/hotspots?top_n=5

# 5. SSE stream works
curl -N http://localhost:8080/api/v1/mcp/events
# Should see: event: connected
```

Once all checks pass, open your AI tool and try a test query like "search for all functions in the project" to confirm end-to-end connectivity.
