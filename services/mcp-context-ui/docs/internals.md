# MCP Context UI — Internals (Layer 3, on-demand)

> Mechanism-level reference extracted from the old 800-line steering file. Load a
> section only when your task touches it.

## Data Contract (backend → frontend)
Backend `SymbolKind` = `file|module|function|class|variable|external`;
`EdgeType` = `imports|defines|calls|instantiates|reads|writes|references|exports|inherits`.
Frontend Zod (`src/types/mcp.ts`): `NodeSchema { id, type(enum), label, filePath?, qualifiedName?, metadata? }`,
`EdgeSchema { source, target, type(enum), isCrossCluster?, metadata? }`,
`GraphSchema { nodes, edges, clusterMeta? }`. All responses `GraphSchema.parse(data)`.
Health `/api/v1/health` → `{status:"ok"}` or `{status:"degraded", reasons[]}` (degraded = 0 files indexed; yellow badge, Reconfigure hidden).
**Incident (Apr 2026):** backend added `"external"`, frontend schema not updated → ~2000 ZodErrors. Always sync.

## Nginx Routing (versioned)
- `/api/v1/` → `proxy_pass http://mcp-context-manager:3001` (Host/X-Real-IP/X-Forwarded-* headers).
- `/api/v1/mcp/events` and legacy `/api/mcp/events` → SSE: `proxy_buffering off`, `proxy_read_timeout 3600s` (served directly, no redirect — EventSource can't follow 301).
- `/api/` legacy → proxied, backend returns 301 to `/api/v1/`.
- CSP header present (includes Clerk domains for consistency though auth unused; `worker-src 'self' blob:` for three.js workers).

## App Structure (5-tab portal, HashRouter)
Routes: `/#/`→Overview, `/#/setup`→Setup wizard, `/#/api`→API playground, `/#/agents`→Agent guides, `/#/graph`→Graph, `/#/*`→Overview.
Shell `src/components/Layout.tsx`: fixed header (logo, version, Fuse.js search), horizontal tab bar, scrollable content, footer.

### Components (`src/components/`)
- `api/` — `EndpointSidebar.tsx`, `EndpointDetail.tsx` (playground).
- `docs/` — `AgentCard`, `CodeBlock`, `ConfigBlock`, `CopyButton`, `StatusBadge`, `StepWizard`, `ToolList`.
- `mcp/` — `ClusterGlobe` (per-cluster 3D sphere), `DependencyGraph` (2D React Flow main canvas), `EdgeFilterPanel`, `FileTree`, `Globe3DPhase1` (react-globe.gl fallback), `Globe3DPhase2` (R3F multi-globe), `GlobeLoadingScreen`, `SymbolSearch`.
- `ui/` — shadcn primitives (accordion, badge, button, card, dialog, input, label, scroll-area, select, separator, tabs, textarea, tooltip).

### Pages (`src/pages/`)
OverviewPage, SetupPage (Docker wizard + health gate), ApiReferencePage (Swagger-style playground), AgentsPage, GraphPage (2D/3D, migrated from MCPPage), MCPPage (retained, unrouted).

### API client (`src/api/`, baseURL `/api/v1`)
`instance.ts` (axios), `mcp.ts` (endpoints + Zod parse), `clusters.ts`, `sse.ts` (exp backoff, default `/api/v1/mcp/events`).
`mcp.ts` functions: exportGraph, getFunctionContext, getFileDependents, getSymbolReferences, getCallers, getCallChain, getDeadCode, getImpactAnalysis, getModuleCoupling, getHotspots, getClassHierarchy, searchSymbols, getCircularDeps, getComplexityMetrics, getChangeRisk.

### Hooks (`src/hooks/`)
`use-api-playground`, `use-cluster-config`, `use-lod`, `use-mcp-graph`, `use-mcp-queries`, `use-multi-globe-lod`, `use-search`, `use-sse-events`.
React Query hooks: all `staleTime: 30_000`, `retry: 2`, keys prefixed `mcp-`. `useChangeRisk` enabled only when `changedFiles.length > 0`.

### Types / Lib
`src/types/`: `globe.ts`, `globe-r3f.ts` (GlobePosition, CrossGlobeArc, GlobeLayoutState, GlobeLODState), `mcp.ts` (schemas + inferred types; per-tool response schemas).
`src/lib/`: `utils.ts` (`cn()`), `docker-compose-generator.ts`, `openapi-parser.ts`, `code-generator.ts`.
`globe.ts` `ARC_STYLES` includes `inherits: {color:"#F59E0B", dashLength:1.0, dashGap:0}`.

## React Flow Patterns
MCP graph → flow nodes: `{ id, type:"default", data:{label, mcpNode}, position:{x:(i%10)*200, y:floor(i/10)*100}, style:getNodeStyle(type) }`.
Edges: `{ id:`${source}-${target}-${type}`, source, target, label:type, type:SmoothStep, style:getEdgeStyle(type) }`. Use `useMemo`; never mutate; let React Flow own state.

## 2D/3D + LOD + SSE
- `MCPPage`/`GraphPage` renders `DependencyGraph` (2D, default) or `Globe3DPhase2` (R3F multi-globe — each cluster its own sphere, no dropdown). Phase1 globe is fallback.
- `useMultiGlobeLOD`: per-globe LOD by camera distance (>3R far, 1.5R–3R medium, <1.5R close), `useFrame()` throttled every 5 frames, controls label/arc/badge visibility. "Show All Details" toggle bypasses LOD with a perf-warning modal >2000 nodes.
- `useSSEEvents`: EventSource to `/api/v1/mcp/events`, exp backoff (1s→30s), invalidates React Query cache on reconnect, sonner toasts (3s) on file change; events carry `clusterId`/`clusterIds`.

## Common Pitfalls
1. Importing from production `/frontend` — forbidden (isolation).
2. Hardcoding API URLs — use relative `/api/v1`.
3. Forgetting to update Zod schema on backend change — causes runtime ZodErrors.
4. Mutating React Flow state directly — breaks reactivity.
5. Disabling React Query caching — excessive requests.

## Debugging
`[useMcpGraph]` console logs show fetch params + node/edge counts. Common errors: ZodError (`invalid_enum_value` → add missing enum to `mcp.ts`), MIME-type (nginx MIME config), API 404 (nginx proxy / manager down).

## Maintenance Checklist
Verify isolation · sync Zod schemas · `npm run build` (type check) · test with `npm run dev` · rebuild `--no-cache` · hard refresh · check console.

---
**Maintained by:** Knowledge Manager. Update this file (via a State Sync Draft) whenever the service's internals change — keep the steering `.claude/local_context.md` prescriptive and push mechanism detail here.
