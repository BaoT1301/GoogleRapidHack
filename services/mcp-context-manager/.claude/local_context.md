# Local Context: MCP Context Manager (Layer 2 steering)

> Internal developer tool: a live AST dependency-graph service (Node.js) for the
> host repo. Isolated, read-only, never public. Deep internals are on-demand in
> `services/mcp-context-manager/docs/internals.md` — read only what your task needs.

## Tech Stack
- **Runtime:** Node.js 20 (Alpine), TypeScript 5.9 (ESM / NodeNext).
- **Graph:** graphology. **Parsing:** tree-sitter (Python) + TypeScript Compiler API.
- **Watch:** chokidar (200ms debounce / 500ms batch). **Glob:** fast-glob.
- **MCP:** `@modelcontextprotocol/sdk` (stdio, 15 tools). **Validation:** zod.
- **HTTP:** native Node `http` (NO Express). **Tests:** vitest.
- Full dependency rationale → `docs/internals.md#dependencies-rationale`.

## Build & Test Commands
```bash
cd services/mcp-context-manager
npm install
npm run dev          # local dev (tsx)
npm run build        # tsc → dist/
npm test             # vitest run (REQUIRED before + after changes)
npm run lint         # eslint
```
Docker: `./mcp.sh build && ./mcp.sh up`; health `./mcp.sh doctor`.

## Architectural Constraints (hard rules — do not violate)
1. **Zero authentication.** NEVER add Clerk/JWT/API keys/auth middleware. Internal Docker-network only.
2. **Native HTTP only.** Use `http.createServer()` with manual routing in `api.ts`. NO Express.
3. **Schema compatibility.** HTTP responses MUST match the frontend Zod schemas exactly (backend `kind` → frontend `type`; `{ nodes, edges }` at top level). This is a cross-service contract — apply the Blast-Radius rule before changing it.
4. **Read-only file access.** All source volumes mounted `:ro`. No file writes/modifications — only read + parse.
5. **Absolute isolation.** NEVER import from `backend/`, `frontend/`, or other services. All code under `src/`.
6. **Incremental updates only.** On change, re-parse only changed files + direct dependents. No full re-index.
7. **Graceful shutdown.** Handle `SIGINT`/`SIGTERM` to stop watcher + HTTP server.
8. **In-memory + snapshot.** No DB. Graph rebuilds from snapshot + delta on restart; atomic temp-file+rename writes.
9. **No outbound network.** Service makes no external HTTP requests. Logs to stderr only.

## Cross-Service Contract
This service's HTTP API is consumed by `mcp-context-ui` (Zod-validated) and by AI
tools over MCP stdio. Any change to node/edge shape, endpoint paths, or the 15 MCP
tool signatures is a contract change → update
`.claude/docs/core/api-contracts/mcp-query-api.md` FIRST and assign the UI in `issues.md`.

## Related Docs (Layer 3 — on-demand, load only when relevant)
- `services/mcp-context-manager/docs/internals.md` — component hierarchy, data flow, graph schema, env vars, Docker, perf, troubleshooting, testing inventory.
- `services/mcp-context-manager/openapi.yaml` — full endpoint spec (32+ endpoints).
- `.claude/docs/core/api-contracts/mcp-query-api.md` — query API contract (split sub-docs).
- `services/mcp-context-manager/README.md` — user-facing docs.

---
**Maintained by:** Knowledge Manager · **Stack version:** see `package.json`.
