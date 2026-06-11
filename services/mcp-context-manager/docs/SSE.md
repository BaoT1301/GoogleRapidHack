# SSE Real-Time Events

The MCP Context Manager exposes a Server-Sent Events (SSE) endpoint for real-time notifications about file changes, indexing progress, and system health.

---

## Endpoint

```
GET /api/v1/mcp/events
```

**Legacy path** (also supported): `GET /api/mcp/events`

> Note: The legacy path serves SSE directly rather than issuing a 301 redirect, because `EventSource` clients cannot follow redirects.

---

## Event Types

| Event | Description | When |
|-------|-------------|------|
| `connected` | Initial handshake confirming the SSE stream is active | Immediately on connection |
| `indexing-progress` | Reports current/total file count during initial indexing | During startup indexing |
| `indexing-complete` | Signals that initial indexing has finished | After startup indexing completes |
| `file-change` | A file was created, updated, or deleted | On any watched file change |
| `keepalive` | Heartbeat to prevent connection timeout | Every 30 seconds |

---

## Event Payloads

### `connected`

```json
{
  "timestamp": 1714934400000
}
```

### `indexing-progress`

```json
{
  "current": 42,
  "total": 215,
  "timestamp": 1714934401000
}
```

### `indexing-complete`

```json
{
  "indexedFiles": 215,
  "timestamp": 1714934405000
}
```

> If a client connects after indexing has already completed, it receives an immediate `indexing-complete` event following the `connected` event.

### `file-change` (created)

```json
{
  "type": "file-created",
  "filePaths": ["backend/app/new_module.py"],
  "clusterIds": ["backend"],
  "timestamp": 1714934500000
}
```

### `file-change` (updated)

```json
{
  "type": "file-updated",
  "filePaths": ["backend/app/main.py", "backend/app/models.py"],
  "clusterIds": ["backend"],
  "timestamp": 1714934501000
}
```

### `file-change` (deleted)

```json
{
  "type": "file-deleted",
  "filePath": "backend/app/old_module.py",
  "clusterId": "backend",
  "timestamp": 1714934502000
}
```

---

## Data Flow

```
File Change (disk)
  ↓
Chokidar (file system watcher)
  ↓ (200ms debounce per file, 500ms batch flush)
LiveFileWatcher.onUpdate / onDelete callback
  ↓
IncrementalIndexer.processChanges()
  ↓
GraphStore.upsertFileResult()
  ↓
HttpApiServer.broadcastSSE(event, data)
  ↓
Nginx reverse proxy (proxy_buffering off, proxy_read_timeout 3600s)
  ↓
Browser EventSource client
```

---

## Nginx Proxy Configuration

The MCP Context UI uses Nginx to proxy SSE connections to the backend. The following directives are required for SSE to work correctly:

```nginx
location /api/v1/mcp/events {
    proxy_pass http://mcp-context-manager:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

**Key settings:**

| Directive | Purpose |
|-----------|---------|
| `proxy_buffering off` | Prevents Nginx from buffering SSE chunks — events stream immediately |
| `proxy_cache off` | Disables response caching for the long-lived connection |
| `proxy_read_timeout 3600s` | Keeps the connection alive for up to 1 hour without data |
| `proxy_send_timeout 3600s` | Allows the server to hold the connection open for sending |
| `Connection ""` | Ensures HTTP/1.1 persistent connection (no `Connection: close`) |

---

## Client Reconnection Strategy

The recommended reconnection strategy uses exponential backoff:

- **Initial delay**: 1 second
- **Backoff multiplier**: 2x
- **Maximum delay cap**: 30 seconds
- **Reset**: On successful `connected` event, reset delay to 1 second

---

## Query Timeout & Retry Infrastructure

All query endpoints (not SSE, but the HTTP API endpoints that power the graph) use a shared timeout/retry infrastructure:

| Utility | Description |
|---------|-------------|
| `QueryTimeoutError` | Custom error thrown when a query exceeds its timeout (default 5000ms) |
| `withTimeout(fn, ms)` | Wraps an async function with an `AbortController`-based timeout guard |
| `withRetry(fn, maxRetries, backoffMs)` | Retries on `QueryTimeoutError` up to `maxRetries` times (default: 2) with backoff (default: 500ms) |
| `paginate(items, limit, offset)` | Applies limit/offset pagination to result arrays (max limit: 1000) |
| `parsePaginationParams(params)` | Parses and clamps `limit`/`offset` from URL params or request body |

**Standard error response schema:**

```json
{
  "error": "Query timed out after 5000ms",
  "code": "TIMEOUT",
  "retryable": true
}
```

Error codes: `TIMEOUT` (504, retryable), `INVALID_PARAMS` (400, not retryable), `NOT_FOUND` (404, not retryable).

---

## Code Examples

### JavaScript EventSource Client

```javascript
const eventSource = new EventSource('http://localhost:8080/api/v1/mcp/events');

let reconnectDelay = 1000;
const MAX_DELAY = 30000;

eventSource.addEventListener('connected', (event) => {
  const data = JSON.parse(event.data);
  console.log('SSE connected at', new Date(data.timestamp));
  reconnectDelay = 1000; // Reset on successful connection
});

eventSource.addEventListener('indexing-progress', (event) => {
  const { current, total } = JSON.parse(event.data);
  console.log(`Indexing: ${current}/${total} files`);
});

eventSource.addEventListener('indexing-complete', (event) => {
  const { indexedFiles } = JSON.parse(event.data);
  console.log(`Indexing complete: ${indexedFiles} files indexed`);
});

eventSource.addEventListener('file-change', (event) => {
  const data = JSON.parse(event.data);
  switch (data.type) {
    case 'file-created':
      console.log('Files created:', data.filePaths);
      break;
    case 'file-updated':
      console.log('Files updated:', data.filePaths);
      break;
    case 'file-deleted':
      console.log('File deleted:', data.filePath);
      break;
  }
});

eventSource.addEventListener('keepalive', (event) => {
  // Optional: log heartbeat for debugging
});

eventSource.onerror = () => {
  console.warn(`SSE connection lost. Reconnecting in ${reconnectDelay}ms...`);
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
  }, reconnectDelay);
};
```

### Testing with curl

```bash
# Connect to SSE endpoint (streams events to terminal)
curl -N http://localhost:8080/api/v1/mcp/events

# Expected output:
# event: connected
# data: {"timestamp":1714934400000}
#
# event: keepalive
# data: {"timestamp":1714934430000}
```

### Testing with httpie

```bash
http --stream GET http://localhost:8080/api/v1/mcp/events
```

---

## Architecture Notes

- The SSE endpoint is served by the `HttpApiServer` class in `src/api.ts`.
- SSE clients are tracked in a `Set<http.ServerResponse>` and cleaned up on connection close.
- The keepalive interval (30s) prevents proxies and load balancers from closing idle connections.
- In `--stdio-only` mode, the HTTP server (and therefore SSE) is not started. SSE is only available in full mode.
- Late-connecting clients receive an immediate `indexing-complete` event if indexing has already finished, ensuring they don't miss the initial state.
