# MCP Context Manager — Operations Guide

## Memory Sizing

The service uses two memory limits that must be set together:

| Setting | Location | Value | Purpose |
|---------|----------|-------|---------|
| `deploy.resources.limits.memory` | `docker-compose.mcp.yml` | `1536M` | cgroup hard cap |
| `NODE_OPTIONS=--max-old-space-size=1024` | compose `environment` + `Dockerfile` | `1024` MB | V8 old-space heap |

**Sizing rule:** V8 old-space ≈ 2/3 of cgroup limit. The remaining 1/3 covers native (tree-sitter) heap and ephemeral buffers.

| Workspace size | Recommended cgroup | Recommended `max-old-space-size` |
|---|---|---|
| < 500 files | 512 MB | 256 MB |
| 500–2000 files | 1536 MB | 1024 MB |
| 2000–5000 files | 3072 MB | 2048 MB |
| > 5000 files | 4096 MB | 2816 MB |

To override without rebuilding, set `NODE_OPTIONS` in `.env.mcp`:

```bash
NODE_OPTIONS=--max-old-space-size=2048
```

---

## Healthcheck Tuning

The compose healthcheck polls `/api/ready` (not `/api/health`):

```yaml
healthcheck:
  test: ["CMD", "wget", "-qO", "/dev/null", "http://localhost:3001/api/ready"]
  interval: 5s
  timeout: 5s
  retries: 12
  start_period: 60s
```

**Math:** `start_period (60s) + retries × interval (12 × 5s) = 120s total grace window`.

This is sized for a workspace with ~200 files. Scale-up rule:
- Double `start_period` for each additional ~200 files.
- Or switch to warm-snapshot restarts (see below).

**Endpoint semantics:**

| Endpoint | Meaning | Use for |
|---|---|---|
| `GET /api/health` | Always 200 | Liveness (orchestrator ping) |
| `GET /api/ready` | 200 when graph built, 503 while indexing | Readiness (compose `depends_on`) |

---

## Cold Start vs Warm Start

**Cold start** (no snapshot): full AST parse of all workspace files. Duration scales with file count (~1–5 s per 100 files on typical hardware).

**Warm start** (snapshot present and fresh): loads serialized graph, then runs a delta pass for changed files only. Typically 2–5× faster than cold.

Startup log lines:

```
[live-context-manager] loading snapshot (1240 files, 3420 nodes)
[live-context-manager] delta: reused=1230 reparsed=10 deleted=2
[graph-store] loaded snapshot: 3420 nodes, 7800 edges, 68 KB, age 12 min
```

---

## Snapshot Lifecycle

Snapshots are stored at `{workspaceRoot}/.mcp-cache/graph-snapshot.json` (or `$GRAPH_SNAPSHOT_DIR`).

**Staleness guard:** If the snapshot is older than `GRAPH_SNAPSHOT_MAX_AGE` days (default: `7`), it is discarded and a full cold index runs. Override:

```bash
GRAPH_SNAPSHOT_MAX_AGE=14   # in .env.mcp
```

**Temp file cleanup:** On every startup, any `.tmp.*` siblings left over from interrupted atomic writes are deleted before the snapshot is loaded.

**Manual cache reset:**

```bash
rm -f .mcp-cache/graph-snapshot*.json
./mcp.sh restart mcp-context-manager
```

---

## Interpreting `/api/v1/diag` Degradation

```json
{
  "degraded": false,
  "reasons": [],
  "memory": {
    "rssMb": 368,
    "heapUsedMb": 240,
    "heapTotalMb": 290,
    "heapLimitMb": 1024,
    "external": 112,
    "degraded": false
  }
}
```

| `reasons` value | Meaning | Fix |
|---|---|---|
| `indexed 0 files` | No files matched globs | Check `WORKSPACE_PATH` and glob patterns |
| `high-unresolved-import-ratio` | >25% of imports unresolved | Check tsconfig paths, alias config |
| `high-heap-usage` | `heapUsedMb / heapLimitMb > 0.85` | Increase `max-old-space-size` and cgroup limit |

`mcp.sh doctor` exits 4 when `degraded: true`.

---

## CI Smoke Test

A cold-start smoke test is available in `src/__tests__/mcp-sh-smoke.test.ts`. It requires Docker and is opt-in:

```bash
RUN_SLOW_TESTS=1 npx vitest --run src/__tests__/mcp-sh-smoke.test.ts
```

To exclude from unit-only CI runs, filter by pattern:

```bash
npx vitest --run --testPathPattern='(?!mcp-sh-smoke)'
```
