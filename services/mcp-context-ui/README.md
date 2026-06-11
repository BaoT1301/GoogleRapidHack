# MCP Context UI

**Internal Developer Tool** — Comprehensive documentation portal and interactive visualization interface for the MCP Context Manager service.

---

## Overview

The MCP Context UI is a standalone React-based web application that serves as the documentation portal for the MCP Context Manager. It provides interactive API exploration, Docker setup wizards, AI agent configuration guides, and dependency graph visualization.

**Key Features:**
- 📖 5-tab documentation portal (Overview, Setup, API Reference, AI Agents, Graph)
- 🎨 Interactive dependency graph visualization using React Flow (2D)
- 🌍 3D Globe visualization using @react-three/fiber with 2D/3D toggle
- 🔌 Interactive API playground with code generation (curl, TypeScript, Python)
- 🐳 Docker setup wizard generating `docker-compose.yml` + `.env`
- 🤖 AI agent configuration guides (Claude Desktop, Cursor, Kiro)
- 🔍 Full-text documentation search powered by Fuse.js
- 📁 File tree navigation with dependency highlighting
- 🔧 Edge type filter panel for selective arc display
- 📊 Real-time graph statistics and legend
- 🔄 SSE real-time updates with toast notifications via sonner
- 🎚️ Three-tier LOD system (Far/Medium/Close) for performance
- 🔄 Auto-refreshing data (60-second intervals)

---

## Architecture

### Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| **Framework** | React | 19.1.0 |
| **Build Tool** | Vite | 6.3.5 |
| **Language** | TypeScript | 5.8.3 |
| **CSS Framework** | Tailwind CSS | 4.x |
| **Routing** | React Router DOM | 7.x |
| **Search** | Fuse.js | latest |
| **UI Primitives** | Radix UI (shadcn/ui) | latest |
| **2D Visualization** | React Flow | 11.11.4 |
| **3D Visualization** | @react-three/fiber + drei | 9.x |
| **3D Engine** | three | latest |
| **State Management** | Zustand + React Query | 5.100.5 |
| **HTTP Client** | Axios | 1.13.5 |
| **Schema Validation** | Zod | 4.3.6 |
| **Toast Notifications** | sonner | latest |
| **Web Server** | Nginx (Alpine) | Latest |

### Service Isolation

**CRITICAL:** This UI is **completely isolated** from the main production frontend:
- ✅ Separate Docker container
- ✅ Separate port (8080)
- ✅ Separate codebase (`services/mcp-context-ui/`)
- ✅ Zero authentication (internal tooling only)
- ✅ No shared dependencies with production frontend
- ✅ Independent build and deployment pipeline

**Do NOT:**
- ❌ Import code from `/frontend`
- ❌ Share components with production frontend
- ❌ Implement Clerk authentication wrappers
- ❌ Proxy to production backend (port 8000)

### Data Flow

```
Browser (localhost:8080)
    ↓ HTTP GET /api/v1/mcp/graph
Nginx (port 80 in container)
    ↓ Proxy to mcp-context-manager:3001
MCP Context Manager (Node.js service)
    ↓ Returns { nodes: [], edges: [] }
React App (Zod validation)
    ↓ Transform to React Flow format
React Flow Canvas (visualization)
```

---

## Getting Started

### Prerequisites

- Docker and Docker Compose installed
- MCP Context Manager service running (dependency)
- Port 8080 available on host machine

### Quick Start

**Using the root `run.sh` script (recommended):**

```bash
# Start the MCP UI service
./run.sh mcp-ui

# View logs
./run.sh logs mcp-ui

# Restart the service
./run.sh restart mcp-ui

# Stop the service
./run.sh stop mcp-ui
```

**Using Docker Compose directly:**

```bash
# Start the service
docker compose -f docker-compose.mcp.yml up -d mcp-ui

# View logs
docker compose -f docker-compose.mcp.yml logs -f mcp-ui

# Restart the service
docker compose -f docker-compose.mcp.yml restart mcp-ui

# Stop the service
docker compose -f docker-compose.mcp.yml stop mcp-ui
```

### Access the UI

Once the service is running:

1. Open your browser to: **http://localhost:8080**
2. The UI will automatically fetch and display the dependency graph
3. Use the sidebar to search symbols or navigate the file tree
4. Click nodes to highlight them and view details

---

## Development

### Local Development (Outside Docker)

```bash
cd services/mcp-context-ui

# Install dependencies
npm install

# Start development server (port 8080)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

**Note:** When running locally, ensure the MCP Context Manager is accessible at `http://localhost:3001` or update the proxy configuration in `vite.config.ts`.

### Project Structure

```
services/mcp-context-ui/
├── src/
│   ├── api/              # API client layer
│   │   ├── clusters.ts   # Cluster API client (Phase 1)
│   │   ├── instance.ts   # Axios instance configuration
│   │   ├── mcp.ts        # MCP API endpoints with Zod validation
│   │   └── sse.ts        # SSE client with exponential backoff (Phase 1)
│   ├── components/       # React components
│   │   └── mcp/
│   │       ├── DependencyGraph.tsx   # React Flow 2D visualization
│   │       ├── EdgeFilterPanel.tsx   # Edge type filter sidebar (Phase 1)
│   │       ├── FileTree.tsx          # File navigation sidebar
│   │       ├── Globe3DPhase1.tsx     # react-globe.gl 3D visualization (Phase 1)
│   │       ├── GlobeLoadingScreen.tsx # Loading screen with progress (Phase 1)
│   │       └── SymbolSearch.tsx      # Symbol search component
│   ├── hooks/            # Custom React hooks
│   │   ├── use-cluster-config.ts  # React Query hook for clusters (Phase 1)
│   │   ├── use-lod.ts            # Level of Detail hook (Phase 1)
│   │   ├── use-mcp-graph.ts      # React Query hooks for data fetching
│   │   └── use-sse-events.ts     # SSE connection management (Phase 1)
│   ├── pages/            # Page components
│   │   └── MCPPage.tsx   # Main application page (2D/3D toggle)
│   ├── types/            # TypeScript type definitions
│   │   ├── globe.ts      # Globe-specific Zod schemas (Phase 1)
│   │   └── mcp.ts        # Zod schemas and inferred types
│   ├── App.tsx           # Root application component
│   ├── main.tsx          # Application entry point
│   └── index.css         # Global styles
├── public/               # Static assets
├── Dockerfile            # Multi-stage build (Node + Nginx)
├── nginx.conf            # Nginx configuration with API proxy and SSE support
├── vite.config.ts        # Vite build configuration
├── tsconfig.json         # TypeScript configuration
└── package.json          # Dependencies and scripts
```

### Key Files

#### `src/types/mcp.ts` - Schema Definitions

Defines Zod schemas for runtime validation of API responses:

```typescript
export const NodeSchema = z.object({
  id: z.string(),
  type: z.enum(["file", "function", "class", "variable", "module", "external"]),
  label: z.string(),
  filePath: z.string().optional(),
  qualifiedName: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const EdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum([
    "imports", "defines", "calls", "instantiates",
    "reads", "writes", "references", "exports"
  ]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const GraphSchema = z.object({
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});
```

**CRITICAL:** The node type enum **MUST** match the backend's `SymbolKind` type exactly. See [SCHEMA-FIX.md](./SCHEMA-FIX.md) for details on a previous schema mismatch incident.

#### `src/api/mcp.ts` - API Client

Type-safe API client with Zod validation:

```typescript
export async function exportGraph(params: {
  scope: "repo" | "file" | "symbol";
  filePath?: string;
  symbolQualifiedName?: string;
  maxNodes?: number;
  maxEdges?: number;
}): Promise<Graph> {
  const { data } = await api.get("/api/mcp/graph", { params });
  return GraphSchema.parse(data); // Runtime validation
}
```

All API responses are validated at runtime to catch schema mismatches early.

#### `nginx.conf` - Reverse Proxy Configuration

```nginx
# Proxy API requests to MCP Context Manager (versioned)
location /api/v1/ {
    proxy_pass http://mcp-context-manager:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

This configuration ensures all `/api/v1/*` requests are proxied to the MCP Context Manager service. Legacy `/api/mcp/*` paths are also proxied and return 301 redirects from the backend.

---

## Docker Configuration

### Multi-Stage Build

The Dockerfile uses a two-stage build process:

**Stage 1: Build (Node.js)**
- Installs dependencies with `npm ci`
- Compiles TypeScript and bundles with Vite
- Outputs static files to `/app/dist`

**Stage 2: Serve (Nginx)**
- Copies built static files from Stage 1
- Configures Nginx with custom `nginx.conf`
- Exposes port 80 (mapped to 8080 on host)

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk public key (unused, but passed for consistency) | No | - |

**Note:** Although the Clerk key is passed as a build arg, this UI does **NOT** implement authentication. The variable is included for infrastructure consistency only.

### Resource Limits

```yaml
deploy:
  resources:
    limits:
      memory: 256M
```

The service is limited to 256MB of memory, sufficient for serving static files via Nginx.

### Health Check

```yaml
healthcheck:
  test: ["CMD", "wget", "-qO", "/dev/null", "http://127.0.0.1:80/"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 5s
```

The health check verifies that Nginx is serving the application successfully.

---

## API Endpoints (Consumed)

The UI consumes the following endpoints from the MCP Context Manager (all versioned under `/api/v1/`):

### `GET /api/v1/mcp/graph`

Export the full dependency graph.

**Query Parameters:**
- `scope` (required): `"repo"` | `"file"` | `"symbol"`
- `filePath` (optional): File path for `scope=file`
- `symbolQualifiedName` (optional): Symbol name for `scope=symbol`
- `maxNodes` (optional): Maximum nodes to return (default: 2000)
- `maxEdges` (optional): Maximum edges to return (default: 4000)

**Response:**
```json
{
  "nodes": [
    {
      "id": "file:backend/app/main.py",
      "type": "file",
      "label": "main.py",
      "filePath": "backend/app/main.py"
    }
  ],
  "edges": [
    {
      "source": "file:backend/app/main.py",
      "target": "file:backend/app/config.py",
      "type": "imports"
    }
  ]
}
```

### `GET /api/v1/mcp/function/{functionName}`

Get context graph for a specific function.

**Query Parameters:**
- `file_path` (optional): Disambiguate functions with same name
- `max_hops` (optional): Maximum hops from center node (default: 2)
- `max_nodes` (optional): Maximum nodes to return (default: 150)

### `GET /api/v1/mcp/file/{filePath}/dependents`

Get files that depend on or are depended upon by a specific file.

**Query Parameters:**
- `direction` (optional): `"incoming"` | `"outgoing"` | `"both"`
- `depth` (optional): Traversal depth (default: 1)
- `max_files` (optional): Maximum files to return (default: 200)

### `GET /api/v1/mcp/symbol/{symbolName}/references`

Get all references to a specific symbol across the codebase.

**Query Parameters:**
- `include_reads` (optional): Include read references (default: true)
- `include_writes` (optional): Include write references (default: true)
- `include_calls` (optional): Include function calls (default: true)
- `max_results` (optional): Maximum references to return (default: 300)

---

## Troubleshooting

### Issue: Blank Screen or Loading Forever

**Symptoms:**
- Browser shows loading spinner indefinitely
- No graph appears

**Diagnosis:**
```bash
# Check if MCP Context Manager is healthy
docker compose -f docker-compose.mcp.yml ps mcp-context-manager

# Check UI logs
docker compose -f docker-compose.mcp.yml logs mcp-ui

# Test API endpoint directly
curl http://localhost:8080/api/v1/mcp/graph?scope=repo&maxNodes=10
```

**Solutions:**
1. Ensure MCP Context Manager is running and healthy
2. Verify nginx proxy configuration in `nginx.conf`
3. Check browser console for API errors (F12)

### Issue: Zod Validation Errors in Console

**Symptoms:**
- Browser console shows `ZodError` messages
- Errors mention "invalid_enum_value" or "received: external"

**Diagnosis:**
This indicates a schema mismatch between frontend and backend.

**Solution:**
1. Check that `src/types/mcp.ts` includes all node types from backend
2. Rebuild the container with `--no-cache`:
   ```bash
   docker compose -f docker-compose.mcp.yml stop mcp-ui
   docker compose -f docker-compose.mcp.yml rm -f mcp-ui
   docker rmi mcp-context-ui
   docker compose -f docker-compose.mcp.yml build --no-cache --pull mcp-ui
   docker compose -f docker-compose.mcp.yml up -d mcp-ui
   ```
3. Hard refresh browser (Ctrl+Shift+R) to clear cached JavaScript

**Reference:** See [SCHEMA-FIX.md](./SCHEMA-FIX.md) for a detailed case study of a previous schema mismatch.

### Issue: MIME Type Errors

**Symptoms:**
- Browser console shows: `Refused to execute script... MIME type ('text/html')`
- JavaScript files fail to load

**Diagnosis:**
Nginx is not serving JavaScript files with correct MIME type.

**Solution:**
Verify `nginx.conf` includes explicit MIME type configuration:
```nginx
types {
    text/javascript                       js mjs;
    application/javascript                js mjs;
    # ... other types
}
```

### Issue: API 404 Errors

**Symptoms:**
- Browser console shows: `GET http://localhost:8080/api/mcp/graph 404`

**Diagnosis:**
Nginx proxy is not correctly forwarding requests to MCP Context Manager.

**Solution:**
1. Verify MCP Context Manager is running on port 3001
2. Check nginx proxy configuration:
   ```nginx
   location /api/ {
       proxy_pass http://mcp-context-manager:3001;
   }
   ```
3. Ensure both services are on the same Docker network

### Issue: Empty Graph (No Nodes)

**Symptoms:**
- UI loads successfully but shows "No Data Available"
- API returns `{ nodes: [], edges: [] }`

**Diagnosis:**
MCP Context Manager has not indexed the codebase yet.

**Solution:**
1. Check MCP Context Manager logs:
   ```bash
   docker compose -f docker-compose.mcp.yml logs mcp-context-manager
   ```
2. Verify workspace volumes are mounted correctly in `docker-compose.mcp.yml`
3. Restart MCP Context Manager to trigger re-indexing:
   ```bash
   docker compose -f docker-compose.mcp.yml restart mcp-context-manager
   ```

### Verification Script

Run the automated verification script:

```bash
./services/mcp-context-ui/verify-schema-fix.sh
```

This script checks:
- ✅ Container health status
- ✅ API endpoint responsiveness
- ✅ Node types returned by API
- ✅ Frontend schema includes all node types

---

## Security Considerations

### Zero Authentication

**IMPORTANT:** This UI has **NO authentication** by design. It is intended for internal developer use only.

**Security Measures:**
- ✅ Not exposed to public internet (localhost only)
- ✅ Runs on isolated port (8080)
- ✅ No sensitive data displayed (code structure only)
- ✅ Read-only access to codebase metadata

**Do NOT:**
- ❌ Expose port 8080 to public internet
- ❌ Deploy to production environments
- ❌ Display sensitive credentials or secrets
- ❌ Implement write operations

### Content Security Policy

The nginx configuration includes a strict CSP:

```nginx
add_header Content-Security-Policy "
  default-src 'self';
  script-src 'self' https://*.clerk.accounts.dev;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self' http://backend:8000 https://*.clerk.accounts.dev;
  frame-ancestors 'none';
" always;
```

**Note:** Clerk domains are included for infrastructure consistency, but authentication is not implemented.

### Security Headers

```nginx
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

---

## Performance Optimization

### Data Fetching Strategy

- **Stale Time:** 30 seconds (data considered fresh)
- **Refetch Interval:** 60 seconds (auto-refresh)
- **Retry Logic:** 2 attempts on failure
- **Caching:** React Query handles automatic caching

### Graph Rendering Optimization

- **useMemo:** Node and edge transformations are memoized
- **Lazy Loading:** React Flow only renders visible nodes
- **Debouncing:** Search input is debounced to reduce re-renders
- **Pagination:** API supports `maxNodes` and `maxEdges` limits

### Resource Limits

The service is configured with conservative resource limits:
- **Memory:** 256MB (sufficient for static file serving)
- **CPU:** No explicit limit (Nginx is lightweight)

---

## Maintenance

### Updating Dependencies

```bash
cd services/mcp-context-ui

# Check for outdated packages
npm outdated

# Update dependencies
npm update

# Update to latest versions (breaking changes possible)
npm install react@latest react-dom@latest

# Rebuild container
docker compose -f docker-compose.mcp.yml build --no-cache mcp-ui
```

### Schema Synchronization

**CRITICAL:** When the MCP Context Manager updates its schema:

1. Update `src/types/mcp.ts` to match backend types
2. Run TypeScript compiler to catch type errors:
   ```bash
   npm run build
   ```
3. Test locally before deploying:
   ```bash
   npm run dev
   ```
4. Rebuild and restart container:
   ```bash
   docker compose -f docker-compose.mcp.yml build --no-cache mcp-ui
   docker compose -f docker-compose.mcp.yml up -d mcp-ui
   ```

### Monitoring

**Health Check:**
```bash
# Check container health
docker compose -f docker-compose.mcp.yml ps mcp-ui

# View recent logs
docker compose -f docker-compose.mcp.yml logs --tail=50 mcp-ui

# Follow logs in real-time
docker compose -f docker-compose.mcp.yml logs -f mcp-ui
```

**API Health:**
```bash
# Test API endpoint
curl http://localhost:8080/api/mcp/graph?scope=repo&maxNodes=10

# Check response time
time curl -s http://localhost:8080/api/mcp/graph?scope=repo&maxNodes=10 > /dev/null
```

---

## Related Documentation

- [MCP Context Manager README](../mcp-context-manager/README.md) - Backend service documentation
- [SCHEMA-FIX.md](./SCHEMA-FIX.md) - Case study of schema mismatch incident
- [VERIFICATION.md](./VERIFICATION.md) - Track 2 verification report
- [Root Infrastructure Documentation](../../docs/architecture/infrastructure.md)

---

## Support

For issues or questions:

1. Check the [Troubleshooting](#troubleshooting) section above
2. Review logs: `docker compose -f docker-compose.mcp.yml logs mcp-ui`
3. Verify MCP Context Manager is healthy
4. Check browser console for client-side errors (F12)
5. Run verification script: `./services/mcp-context-ui/verify-schema-fix.sh`

---

**Last Updated:** 2026-05-05 (Sprint 4 — Documentation Portal & API Versioning)  
**Service Version:** 3.0.0  
**Maintainer:** Internal Tooling Team
