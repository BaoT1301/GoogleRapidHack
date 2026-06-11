# Cluster Configuration Guide

The MCP Context Manager groups files into **clusters** based on directory prefixes. Each cluster maps to a region on the 3D globe visualization and provides logical grouping for code analysis queries.

> **Quick reference:** See [`../cluster-config.README.md`](../cluster-config.README.md) for the schema summary and minimal starter examples.

---

## JSON Schema

The configuration file lives at `services/mcp-context-manager/cluster-config.json` and is mounted into the container at `/workspace/cluster-config.json`.

```json
{
  "clusters": [
    {
      "id": "string",      // Unique identifier (non-empty)
      "path": "string",    // Relative directory prefix (no leading /)
      "label": "string",   // Human-readable display name (non-empty)
      "color": "#RRGGBB"   // Hex color for visualization
    }
  ]
}
```

### Field Constraints

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | Non-empty, unique across all clusters |
| `path` | string | Must be relative (no leading `/`). Use `""` for root. Trailing `/` recommended. |
| `label` | string | Non-empty. Displayed in the UI. |
| `color` | string | Must match `^#[0-9A-Fa-f]{6}$`. No shorthand (`#FFF`) or alpha (`#RRGGBBAA`). |

### Validation

The file is validated at load time using Zod schemas (`ClusterConfigSchema` in `cluster-config-loader.ts`):
- At least one cluster must be defined
- All fields are required
- Paths must be relative
- Colors must be valid 6-digit hex

If validation fails, the service falls back to a single default cluster:
```json
{ "id": "root", "path": "", "label": "Root", "color": "#4A90E2" }
```

---

## How Clusters Map to Directories

### Longest Prefix Match

Files are assigned to the cluster with the **longest matching `path` prefix**:

```
File: services/mcp-context-ui/src/App.tsx

Clusters:
  { "path": "services/" }              → matches (prefix length 9)
  { "path": "services/mcp-context-ui/" } → matches (prefix length 25) ← WINS
```

### Root Cluster

A cluster with `"path": ""` matches all files. Use it as a catch-all:

```json
{ "id": "root", "path": "", "label": "Everything Else", "color": "#999999" }
```

Files that don't match any cluster prefix are assigned to the built-in default root cluster.

---

## Hot Reload

The `ClusterConfigLoader` watches `cluster-config.json` via Chokidar:

- **Stability threshold:** 300ms (waits for write to complete)
- **Effective reload time:** ~500ms after saving
- **On success:** In-memory cluster list is replaced immediately
- **On failure:** Previous valid config is retained, error logged to stderr

No service restart required. The next graph export or file-change event uses the updated clusters.

---

## Geographic Mapping Algorithm

Each cluster defines a coordinate region on the globe. Files within a cluster are mapped to specific lat/lng coordinates using **deterministic recursive subdivision**:

### How It Works

1. Each cluster starts with a full coordinate region: lat ∈ [-90, 90], lng ∈ [-180, 180]
2. For each directory level in the file path:
   - Resolve all sibling entries at that level (sorted alphabetically for determinism)
   - **Even depth** → subdivide latitude equally among siblings
   - **Odd depth** → subdivide longitude equally among siblings
   - Select the sub-region corresponding to this file's segment
3. Place the file at the **center** of its final sub-region

### Example

Given cluster path `backend/` and file `backend/app/routers/users.py`:

```
Depth 0 (lat split): siblings at backend/ = [app, tests, alembic, ...]
  → "app" gets lat slice [latMin, latMin + sliceSize]

Depth 1 (lng split): siblings at backend/app/ = [main.py, routers, models, ...]
  → "routers" gets lng slice [lngMin, lngMin + sliceSize]

Depth 2 (lat split): siblings at backend/app/routers/ = [users.py, auth.py, ...]
  → "users.py" gets lat slice [subLatMin, subLatMin + sliceSize]

Final: center of the resulting region → { lat: X, lng: Y }
```

### Properties

- **Deterministic:** Same file path + same sibling set = same coordinates (always)
- **Hierarchical:** Files in the same directory are spatially close
- **Bounded:** All coordinates stay within [-90, 90] × [-180, 180]
- **Stable:** Adding a file to a different directory doesn't move existing files in other directories

---

## Examples

### Python Monolith

Single backend directory with standard Django/FastAPI layout:

```json
{
  "clusters": [
    { "id": "app", "path": "src/", "label": "Application", "color": "#4A90E2" },
    { "id": "tests", "path": "tests/", "label": "Tests", "color": "#50C878" },
    { "id": "config", "path": "config/", "label": "Configuration", "color": "#F5A623" }
  ]
}
```

### TypeScript Monorepo

Turborepo/Nx-style monorepo with `packages/`, `apps/`, `libs/`:

```json
{
  "clusters": [
    { "id": "web-app", "path": "apps/web/", "label": "Web App", "color": "#E24A4A" },
    { "id": "api", "path": "apps/api/", "label": "API Server", "color": "#4A90E2" },
    { "id": "ui-lib", "path": "packages/ui/", "label": "UI Library", "color": "#9013FE" },
    { "id": "shared", "path": "packages/shared/", "label": "Shared Utils", "color": "#F5A623" },
    { "id": "infra", "path": "infrastructure/", "label": "Infrastructure", "color": "#7B68EE" }
  ]
}
```

### Mixed-Language Project

Python backend + TypeScript frontend + Go microservices:

```json
{
  "clusters": [
    { "id": "python-api", "path": "backend/", "label": "Python API", "color": "#4A90E2" },
    { "id": "react-app", "path": "frontend/", "label": "React Frontend", "color": "#E24A4A" },
    { "id": "go-services", "path": "services/gateway/", "label": "Go Gateway", "color": "#00ADD8" },
    { "id": "go-worker", "path": "services/worker/", "label": "Go Worker", "color": "#00897B" },
    { "id": "proto", "path": "proto/", "label": "Protobuf Schemas", "color": "#F5A623" }
  ]
}
```

### Fine-Grained Splitting

When you want specific subdirectories to have their own cluster:

```json
{
  "clusters": [
    { "id": "api-routes", "path": "backend/app/routers/", "label": "API Routes", "color": "#4A90E2" },
    { "id": "api-models", "path": "backend/app/models/", "label": "Data Models", "color": "#7B68EE" },
    { "id": "api-services", "path": "backend/app/services/", "label": "Business Logic", "color": "#50C878" },
    { "id": "api-other", "path": "backend/", "label": "Backend (Other)", "color": "#999999" },
    { "id": "frontend", "path": "frontend/", "label": "Frontend", "color": "#E24A4A" }
  ]
}
```

Note: More specific paths (`backend/app/routers/`) take priority over less specific ones (`backend/`) due to longest-prefix matching.

---

## Common Mistakes

| Mistake | Example | Fix |
|---------|---------|-----|
| Absolute path | `"/backend/"` | Use relative: `"backend/"` |
| Invalid hex color | `"#FFF"`, `"blue"` | Use 6-digit hex: `"#4A90E2"` |
| Empty `id` or `label` | `""` | Provide a meaningful value |
| Empty clusters array | `[]` | Include at least one cluster |
| Trailing comma | `{ "id": "x", }` | Remove (invalid JSON) |
| Missing trailing slash | `"backend"` | Works, but `"backend/"` is clearer |

---

## API Integration

Cluster data is available via the HTTP API:

```bash
# Get all clusters
curl http://localhost:3001/api/v1/mcp/clusters
# → { "clusters": [{ "id": "backend", "path": "backend/", "label": "Backend Services", "color": "#4A90E2" }, ...] }

# Graph export includes cluster assignments
curl "http://localhost:3001/api/v1/mcp/graph?scope=repo&max_nodes=100"
# → nodes include: { ..., "lat": 12.5, "lng": -45.3, "clusterId": "backend" }
```

The SSE event stream also includes `clusterIds` in file-change events:

```json
{ "type": "file-updated", "filePaths": ["backend/app/main.py"], "clusterIds": ["backend"], "timestamp": 1715000000 }
```
