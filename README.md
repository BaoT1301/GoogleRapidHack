# GoogleRapidHack — AI Workflow Orchestrator (local client)

**"ComfyUI for AI software engineering."** A visual node-graph desktop/web app
where each node spawns a real AI coding CLI (Claude Code / Gemini / Codex / Kiro)
in its own isolated git worktree, with live log streaming, gates, loops, and
automatic merge-back.

This repo is the **run-local client**. The cloud backend (Auth/BFF, the LLM
Architect API, and MongoDB) is hosted separately — the client talks to it over
HTTPS and holds **no database or account secrets**.

---

## What's in here

```
packages/data-core/            Shared data layer (Mongo models + gateways). No secrets.
services/orchestrator/         The app: Next.js 15 + tRPC + SSE + the agent runtime.
services/mcp-context-manager/  Local codebase indexer (tree-sitter AST graph).
services/mcp-context-ui/       Visualization UI for the context manager.
```

> The cloud-only services (`auth-bff`, `llm`) and the Electron desktop shell are
> intentionally **not** included — this is the run-local (`npm run dev`) client.

---

## Prerequisites

- **Node.js 20+** and npm
- A reachable deployed **BFF** (`BFF_URL`) and **LLM Architect API** (`LLM_API_URL`)
- (Optional) **Docker** — only if you want the live `mcp-context-manager` graph during runs

---

## Setup

### 1. Configure environment

```bash
cp .env.example .env.orchestrator     # at the repo root
# then edit .env.orchestrator — fill in BFF_URL, LLM_API_URL, the Clerk
# publishable key, and LLM_SERVICE_TOKEN (see judge notes for the demo value).
```

### 2. Build the shared data layer FIRST

The orchestrator imports `@repo/data-core` from its built `dist/`, so build it before installing the app.

```bash
cd packages/data-core
npm install
npm run build
```

### 3. Build the MCP services (proves the native tree-sitter binary compiles here)

```bash
cd ../../services/mcp-context-manager && npm install && npm run build
cd ../mcp-context-ui && npm install && npm run build
```

### 4. Run the orchestrator

```bash
cd ../orchestrator
npm install
npm run dev          # http://localhost:3000
```

### 5. Verify

```bash
curl http://localhost:3000/api/health    # {"status":"ok"}
```

Open http://localhost:3000, sign in, and build a graph on the canvas.

---

## Notes

- **Data flows through the BFF.** With `BFF_URL` set, all graph/run/secret data is
  proxied to the deployed BFF (authenticated by your Clerk login). No DB
  credentials live in this repo.
- **BFF client types are relaxed.** Because the cloud `auth-bff` service is not
  shipped here, the BFF tRPC client (`src/bff/client.ts`) is typed loosely.
  Runtime behavior is unchanged; full end-to-end types are available only in the
  source monorepo.
- **MongoDB MCP is off by default** (`ENABLE_MCP_MONGODB=0`) so no DB credentials
  are needed on the client.

---

## Tests

```bash
cd services/orchestrator && npm test     # vitest
```

Some DB-integration tests expect a local MongoDB and will fail without one — that
is expected for a client-only checkout, not a regression.
