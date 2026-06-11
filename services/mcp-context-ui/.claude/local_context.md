# Local Context: MCP Context UI (Layer 2 steering)

> Internal developer tool: standalone React app visualizing the MCP dependency
> graph. Port 8080→80, zero auth, isolated from production `/frontend`. Deep
> detail (component map, hooks, pitfalls, nginx) is on-demand in
> `services/mcp-context-ui/docs/internals.md` — read only what your task needs.

## Tech Stack
- **Framework:** React 19 + Vite 6 + TypeScript 5.8. **Styling:** Tailwind 4.
- **Routing:** React Router 7 (HashRouter, nginx SPA compat).
- **Data:** React Query 5 + Axios. **Validation:** Zod 4.
- **Graph:** React Flow 11 (2D) + @react-three/fiber/drei + three (3D); react-globe.gl (fallback).
- **UI:** Radix primitives + shadcn/ui, lucide-react, sonner, Fuse.js search.
- **Server:** Nginx (Alpine) static serve + reverse proxy.
- Full component/hook/API inventory → `docs/internals.md`.

## Build & Test Commands
```bash
cd services/mcp-context-ui
npm install
npm run dev          # vite dev (port 8080)
npm run build        # tsc + vite build (REQUIRED — catches type/Zod errors)
npm run preview      # preview production build
```
Docker: `docker-compose build --no-cache mcp-ui && docker-compose up -d mcp-ui`. Hard-refresh (Ctrl+Shift+R) after rebuild.

## Architectural Constraints (hard rules — do not violate)
1. **Service isolation (CRITICAL).** NEVER import from `/frontend` or `/backend`; no shared components/types; never proxy to production backend. All code under `services/mcp-context-ui/`.
2. **Zero authentication (CRITICAL).** NEVER add Clerk/JWT/API keys/login. Localhost-only, read-only viewer.
3. **Schema sync (CRITICAL).** API responses are validated with `GraphSchema.parse()`. When the MCP Context Manager backend schema changes, update `src/types/mcp.ts` Zod schemas to match — a mismatch caused ~2000 prod Zod errors (Apr 2026). This is a cross-service contract → apply the Blast-Radius rule.
4. **API via nginx proxy.** Use relative paths; axios `baseURL: /api/v1`. NEVER hardcode `localhost:3001` or use absolute URLs. Legacy `/api/mcp/*` returns 301 — use `/api/v1/*` in new code.
5. **React Flow state.** Never mutate node/edge arrays; use `useNodesState`/`useEdgesState`. Memoize transformations with `useMemo`. Store original node in `data.mcpNode`.
6. **Performance/caching.** Keep React Query `staleTime: 30s`, limited retries; never disable caching or set `refetchInterval` < 30s. Handle up to 2000 nodes / 4000 edges.
7. **Strict typing.** Define Zod schema first, infer the TS type (`z.infer`). No `any`.

## Cross-Service Contract
This UI consumes the MCP Context Manager HTTP API. The Zod schemas in
`src/types/mcp.ts` are the frontend half of that contract. Keep them in lockstep
with `.claude/docs/core/api-contracts/mcp-query-api.md` and the manager's steering.

## Related Docs (Layer 3 — on-demand, load only when relevant)
- `services/mcp-context-ui/docs/internals.md` — component/page/api/hook inventory, react-flow patterns, common pitfalls, debugging, nginx/CSP, 2D/3D + LOD + SSE detail.
- `services/mcp-context-ui/README.md` — user-facing docs.
- `.claude/docs/core/api-contracts/mcp-query-api.md` — backend query API contract.

---
**Maintained by:** Knowledge Manager · **Stack version:** see `package.json`.
