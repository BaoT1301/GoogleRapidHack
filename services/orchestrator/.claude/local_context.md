# Local Context: Orchestrator App

## Service Overview

The **Orchestrator** is the current web/runtime app for the AI Workflow
Orchestrator — "ComfyUI for AI software engineering". It is a **Next.js 15
monolith**: UI, tRPC API, SSE endpoints, Mongo models, and the runtime server
modules all live in one app. Electron (`electron/`) loads this app from
`http://localhost:<port>` so Clerk cookie auth and OAuth work like a normal web
app (architecture decision AD-1/AD-2).

**This is the active orchestrator target.** It supersedes the split
`orchestrator-api` (Fastify) + `orchestrator-ui` (Vite) prototype, whose runtime
modules are being ported into `src/server/runtime/`.

---

## Tech Stack

- **Framework**: Next.js ^15.5 (App Router), React 19
- **Language**: TypeScript 5.4, server modules are ESM (`import` only — `require()` is banned)
- **API**: tRPC v11 (`@trpc/server`, `@trpc/client`, `@trpc/tanstack-react-query`)
- **Auth**: Clerk (`@clerk/nextjs`) — cookie-based, same-origin (no `Authorization` header)
- **DB**: MongoDB via Mongoose ^8.4
- **State/data**: TanStack React Query ^5.60, superjson, ulid
- **Validation**: zod ^3.23 (API/tRPC); ajv ^8 (runtime `graph-spec-validator`, v6/v8-tolerant)
- **UI / styling**: Tailwind CSS v4 (`@tailwindcss/postcss`, dark-only `@theme` tokens in `app/globals.css`); Geist display font (`geist/font`, non-Inter); Motion (`motion/react`) with a shared `<MotionConfig reducedMotion="user">`; Phosphor icons (`@phosphor-icons/react`; server components import from `/dist/ssr`).
- **Canvas**: `@xyflow/react` v12 (React 19 / Next 15 ready).
- **Tests**: vitest. Server/DB suites run in the `node` env; React component suites (`*.test.tsx`) run in `jsdom` via `environmentMatchGlobs` + `@vitejs/plugin-react`, with `@testing-library/react` + `jest-dom` (setup in `vitest.setup.ts`).

---

## Module Layout (`src/`)

- `app/` — routes:
  - `sign-in/`, `sign-up/` — Clerk auth pages.
  - `dashboard/` — graph dashboard + React Flow canvas workspace (UI lane).
    - `page.tsx` (graph list), `[graphId]/page.tsx` (canvas workspace), `layout.tsx` (AppShell).
  - `api/trpc/[trpc]/route.ts` — tRPC handler.
  - `api/runs/[runId]/events/route.ts` — SSE stream (`text/event-stream`), cookie-authed.
  - `api/health/route.ts`, `api/ready/route.ts` — liveness/readiness.
  - `layout.tsx` — ClerkProvider + `TRPCReactProvider` (root) + Geist font + `Providers` (Motion + Toast).
- `components/` — `providers.tsx`; `shell/AppShell` (mounts `settings/SettingsPanel`); `ui/*` primitives (Button — with a reduced-motion-safe `loading` state, Bezel, Field, StatusBadge, Dialog, Toast, EmptyState); `dashboard/*` (DashboardView, GraphCard, CreateGraphDialog); `settings/SettingsPanel` (persistent Architect config + live `plan.health` badge; token shown present/absent only; **+ Sprint 2:** planner provider toggle (Cloud default / Local — Local card marked **experimental** with a "Cloud is the reliable default" note), dual provider readiness via `plan.providerStatus`, live `CliCapabilities` list, and an `AllowedToolsEditor`, **and a merge-strategy toggle (Fan-in to base default / Lineage stacked branches)**); `setup/*` (SetupWizard — first-run); `canvas/*` (Workspace, WorkspaceEditor, Canvas, Inspector, ContextMenu, SpawnFixerModal (Sprint 4 WOW-4 — now **"Spawn & run"**: `autoStart` + `runs.fixerContext` prompt pre-fill, opens the `ChildRunPanel` side-panel mounted by `WorkspaceEditor`; keeps the "Open child graph" link), PlanPanel — Socratic two-step (questions→answers→graph) with additive non-clobbering apply, serialize, selection, nodes/GraphNode; **+ Sprint 5 (PLAN-3):** when a `graph_spec` carries `backlog.sprints`, PlanPanel shows the exported `PlanBacklog` multi-sprint roadmap review (current sprint highlighted, `aria-current`, absent-safe) before applying the current sprint's tracks; PlanPanel surfaces the **real** failure reason — a Local-planner failure shows the truthful local message, a Cloud failure keeps the `LLM_API_URL` hint — never a misleading "Architect API" message for Local); **+ Sprint 7:** PlanPanel offers **"Create all N sprint graphs"** (PLAN-4, `graphs.createPlanGraphs`); `Inspector` has a read-only **"Preview prompt"** dry-run dialog (PLAN-7, `graphs.previewNodePrompt`); new **`PlanLedger`** second-brain live-progress panel (PLAN-5, polls `graphs.planProgress`, mounted as a WorkspaceEditor overlay when the graph has a `planId`); new **`RepoBadge`** watched-repo header badge (VIS-2, `graphs.repoInfo`); `run/*` (RunViewer, RunTerminal, run-stream, StatusLegend, **ChildRunPanel** (Sprint 4 WOW-4 — live child-run side-panel reusing `subscribeToRun`/`runReducer`/`RunTerminal`), **WorktreeMap** (Sprint 4 VIS-3 — live node→branch/worktree map) — RunViewer streams live per-node status to the canvas so `GraphNode` re-colours in real time; **+ Sprint 4:** a Terminals/Worktrees view toggle, and RunTerminal autoscroll-with-pause + a "+N dropped" indicator (VIS-1 backpressure); the **Stop** action is gated behind a confirmation `Dialog` — RUN-9 — and only calls `runs.cancel` on confirm); `settings/CliAuthBadge` (auth-state UX — "signed in (host login) / using API key (fallback) / not signed in + fix"; **now fed live by `system.capabilities`** via `CliCapabilities` — RUN-8 carry-over closed).
- `lib/` — client-safe helpers: `cn`, `status`, `graph-constants` (node + edge kinds incl. `loop`), `graph-validation` (cycle rejection scoped to `flow` only → `loop` back-edges allowed), `graph-io`, `run-events` (+`nodeStatusMap` selector for live canvas status; **+ Sprint 4:** `worktreeMap` selector for the live worktree map (VIS-3), and a bounded terminal ring buffer — `MAX_TERMINAL_LINES`=500 + `droppedLines` counter (VIS-1)), `cli-auth` (client-safe `authMode` mirror + `describeCliAuth` label/hint), `plan-map` (maps `GraphSpec.tracks` → execute/gate/loop canvas topology; **+ Sprint 7 (PLAN-4):** `sprintTasksToGraphSpec` maps a sprint's task-name list → a chained `execute`-node graph), `canvas-shortcuts` (pure keyboard-shortcut resolver), `first-run` (SSR-guarded first-run flag + default repo path; never stores secret values — AD-8).
- `trpc/` — `client.tsx` (wiring), `types.ts` (RouterInputs/Outputs).
- `server/`
  - `init.ts` — tRPC context (`currentUser()`) + `authedProcedure`.
  - `routers/` — `graphs` (CRUD + additive owner-scoped `spawnChild` → child sub-graph linked via `parentGraphId`/`parentNodeId`, delegating to the shared `server/graphs/spawn-child.ts` `createChildGraph` — also reused by the runtime's auto-spawned merge-conflict reviewer, GIT-3; **+ Sprint 4 WOW-1/WOW-3:** additive `autoStart?` → spawn-and-run via `server/runs/start-run.ts` `startRunForGraph` (returns `childRunId`), and additive `context?` → seeds the fixer node `data.context` (additive, non-clobbering); **+ Sprint 7:** additive owner-scoped `createPlanGraphs` (PLAN-4 — one linked graph per `backlog.sprints[]`, shared `planId`, via `server/graphs/create-plan-graphs.ts`), and three read-only queries — `previewNodePrompt` (PLAN-7 — dry-run assembled prompt + cli/agent/trust-tools via `server/graphs/preview-node-prompt.ts`, reuses `assembleNodePrompt`, never spawns), `planProgress` (PLAN-5 — per-sprint/per-node rollup via `server/graphs/plan-progress.ts`), `repoInfo` (VIS-2 — timeout-bounded, secret-redacting git probe via `server/graphs/repo-info.ts`); MODEL-1 typed `NodeSpecZ`/`EdgeSpecZ` now validate `update`/`createPlanGraphs` node/edge arrays), `runs` (`create`/`getById`/`listForGraph` + Stephen's `updateStatus`/`updateNodeRun`/`appendEventsBatch` + **`start`** (fire-and-forget → `run-executor.executeRun`) + additive owner-scoped **`cancel`** (Stop → `ProcessManager.cancelRun`)), **+ Sprint 4 WOW-3:** read-only owner-scoped **`fixerContext`** (`{runId,nodeIds}` → per-node `{label,diffPreview (1000-char cap),lastError}` from persisted run state via `server/runs/fixer-context.ts`)), `templates`, `secrets`, `plan` (`generate` — Socratic-aware: forwards `prompt`/`messages`/`approved`/`persona` and
    returns the Architect's **top-level** `ContextRequest | GraphSpec` body as-is; selects a **`PlanProvider`**
    via optional `provider` input → `ORCH_PLAN_PROVIDER` env → **Cloud** default; `health` — Cloud Architect
    liveness probe, never echoes the service token; `providerStatus` — dual Cloud+Local readiness),
    **`system`** (`capabilities` — read-only CLI capability/`authMode` snapshot, never key values;
    `kiroTools` — canonical kiro tool list for the allowed-tools editor), **`settings`** (`get`/`update` —
    persisted `allowedTools` + `plannerProvider` + `mergeStrategy`, owner-scoped). Contracts:
    `.claude/docs/core/api-contracts/architect-plan-api.md` + `cli-capabilities-api.md`.
  - `sse/hub.ts` — SSE hub (`globalThis` singleton, survives HMR).
  - `secrets/vault.ts` — AES-256-GCM encrypt + **internal** `getSecretValue` (plain module, NOT a tRPC procedure). **+ Sprint 8 (SEC-1):** the key is now derived via a **salted, versioned scrypt KDF** (`VaultKdf`, `SCRYPT_PARAMS`); `encryptSecret`→`{ciphertext,nonce,salt,kdf:"scrypt"}`, `decryptSecret({ciphertext,nonce,salt?,kdf?})` (scrypt when `kdf==="scrypt"`, else the legacy unsalted-`sha256` back-compat path); `getSecretValue` transparently re-encrypts a legacy secret under scrypt on read (idempotent migration, best-effort). Passphrase never logged.
  - `plan/` — **`PlanProvider` seam** (PLAN-8): `CloudArchitectProvider` (the `services/llm` Gemini fetch,
    behavior unchanged, body returned as-is) + `LocalCliArchitectProvider` (**experimental**; spawns
    `kiro-cli chat --agent orch-planner` **read-only** via the kiro adapter + `ProcessManager`; the persona +
    output contract live in the agent's trusted system prompt — `runtime/planner-agent.ts` — so the user
    message carries the feature request only, which defeats kiro's prompt-injection refusal; **lenient parse**
    via `extractPlanJson` (sentinel → fenced ```json → bare top-level object); **zod-validates** against the
    canonical contract in `schemas.ts`; **one auto-retry**; on failure throws a clear LOCAL error naming the
    local planner — never the Cloud "Architect API"; MCP-aware via `materializePlannerMcpConfig`).
    `selectPlanProvider`/`resolvePlanProviderName` (**Cloud default = the reliable path**).
    **+ Sprint 5 (PLAN-1/PLAN-2):** `codebase-context.ts` — server-resolved, bounded, **secret-free**
    `codebaseContext` baked into the plan request (`sanitizeCodebaseContext` + `resolveCodebaseContext`
    seam; never trusts a raw client blob — `architect-plan-api.md` §2/§8a). Forwarded additively by both
    providers and folded into the Local `buildPlannerPrompt` (+ Cloud `buildSystemPrompt`) as UNTRUSTED
    repo data.
  - `settings/allowed-tools.ts` — owner-scoped `resolveAllowedTools` (normalized, read-only default) used by
    the run path to map UI-configured tools onto kiro `--trust-tools` for execute nodes.
  - `runtime/` — **ported CLI-agent runtime (Task 4.9, runs on the host)**: `execute-runner`, `worktree-manager` (now with a one-time `.gitignore` backup + a safe, `.orchestrator/`-scoped, best-effort `removeWorktree`), `simple-scheduler` (+ exported `flowEdges`/`topologicalOrder`/`flowDescendants`; optional `getFanInMode` for gate `any-of`, default `all-of`), `gate-runner` (RUN-3 pure fan-in verdict), `lineage-coordinator` (stacked-branch merge model: parent-branch seeding, multi-parent integration branches, terminal-only base merge + pruning), `process-manager` (spawns CLIs; SIGTERM→SIGKILL `cancelProcess`/`cancelRun`), `output-parser`, `cli-capabilities`/`codex-probe`, `graph-spec-validator` (ajv), `git-merge-coordinator` + `merge-back-coordinator` (topological auto-merge over the coordinator + **base promotion** via fast-forward `update-ref`), `cli-adapters/` (`fake`+`codex` stable; `kiro` **verified + auth-agnostic** (Sprint 1); `gemini`/`claude` adapter-ready), `mcp-config-builder` (sponsor hub), `runtime-mcp-config` (materializes the **real** per-run MCP config into the worktree — Kiro auto-discovers it at `.kiro/settings/mcp.json`; no `--mcp-config` flag), `planner-agent` (materializes the read-only `orch-planner` kiro agent config at `<cwd>/.kiro/agents/orch-planner.json` so the Local planner runs `kiro-cli chat --agent orch-planner`; agent-config tool names `read`/`grep`/`glob`/`thinking`/`@mcp-context-manager` — distinct from `--trust-tools` `fs_read`; idempotent + non-destructive), `secret-redaction` (key-injection decision + event scrubbing). Seams: `mongo-run-repository` (Mongo `RunRepository`), `sse-event-hub` (forwards to `sseHub`, **redacts every streamed event**), `run-executor` (`executeRun()` invoked by `runs.start`; holds a **shared `ProcessManager` singleton** via `globalThis` so `runs.cancel` can reach live processes). **Run-executor drives `runSimpleScheduler`** so flow edges gate order and failed-upstream descendants are `skipped`; it **walks all node kinds** — `execute` runs the CLI, **`gate` resolves its fan-in (`all-of` default / `any-of` via incoming edge) → `success`/`blocked` (RUN-3)**, and the remaining kinds are `skipped` with a reason. **+ Sprint 6 (Workflow completeness):** `review` runs a read-only audit under a persona-locked `integration_reviewer` `orch-reviewer` agent (RUN-4 — `runtime/reviewer-agent.ts`); `doc` runs a `knowledge_manager`-locked `orch-doc` agent (`fs_read,fs_write`) + a post-run scope guard that fails writes outside `.claude/**`/`*.md` (RUN-5 — `runtime/doc-agent.ts` + `runtime/doc-scope-guard.ts`); `loop` re-runs an attached child sub-graph via the shared `startRunForGraph` until pass / hard-capped `maxIterations`, emitting append-only `node.loop.iteration` (RUN-6 — `runtime/loop-runner.ts`); a `context` node's text payload is folded into its attached `execute` node's prompt as a bounded, absent-safe UNTRUSTED block (RUN-7 — `runtime/context-materialize.ts`, complementing MCP-2); only `plan`/unknown stay `skipped`. **+ Sprint 7 (MODEL-2):** node-prompt composition is centralized in `prompt-assembly` (`assembleNodePrompt` = base → sandboxed `{{upstream.<id>.<dotpath>}}` data bindings via `data-bindings.ts` → attached context; reused by execute/review/doc + PLAN-7 preview); `data` edges still do NOT gate scheduling. `ExecuteRunner` gained optional `agent`/`materializeAgent` hooks (persona-locked runners spawn under their trusted kiro agent); `worktree-manager` gained `listChangedPaths` (clean git-sourced paths for the doc scope guard). **Graph-level CLI (CLI-2):** the node CLI resolves node `data.cli` → graph-level `cli` → `fake`. **After the DAG settles it auto-merges every successful execute branch back into base in topological order (GIT-1/GIT-2), promotes base (backup-ref + fast-forward, never force/reset), removes the merged worktrees on success (kept on conflict), auto-spawns an `integration_reviewer` child on conflict (GIT-3), and finalizes the run `success`/`failed`/`cancelled` honestly.** Auto-merge is ON by default (`ORCH_AUTO_MERGE=false` disables). **Merge model is a per-owner setting `mergeStrategy` (`base-fanin` default | `lineage`), resolved by `resolveMergeStrategy(ownerId)` — `ORCH_MERGE_STRATEGY` env > owner setting > default. In `lineage` mode each node's worktree forks from its parent branch(es) (convergence nodes seed from an `integration/<run>/<node>` branch that merges parents; an integration conflict blocks the node + spawns the reviewer), agent edits are checkpointed to the node branch so children inherit them, and only terminal/leaf execute nodes merge to base — intermediate + integration branches are pruned.** Canonical per-node status enum: `NODE_RUN_STATUSES` in `runtime/types.ts`. Kiro auth: `authMode` (`host-login` preferred / `api-key` fallback / `unauthenticated`); the fallback key is injected into the **subprocess env only**, never logged or streamed. **Allowed-tools (CLI-4):** kiro `--trust-tools` is web-configurable via the persisted `allowedTools` setting (canonical set in `runtime/kiro-tools.ts`: `fs_read`/`fs_write`/`execute_bash`; normalized, never trust-all) — applied to **execute** nodes (writes opt-in); the **planner is always read-only** (`fs_read`). **Planner env knobs:** `ORCH_PLAN_PROVIDER` (`cloud`|`local`, default `cloud`), `ORCH_PLAN_LOCAL_CWD` (planner cwd), `ORCH_PLAN_READONLY_TOOLS` (default `fs_read`). **MCP env knobs (Sprint 5, MCP-3):** `MCP_CONTEXT_MANAGER_MODE` (`docker` default | `node` packaged) and `MCP_CONTEXT_MANAGER_PATH` (packaged bundled `dist/server.js`; required in `node` mode until PKG-3) — read by `mcp-config-builder` and the new `runtime/mcp-context-reachability.ts` probe (`probeMcpContextManager`: docker → container-running gate; node → bundled-server-exists gate; never throws, actionable `suggestedFix`). **Per-node MCP (Sprint 5, MCP-2):** `runtime/context-mcp-overrides.ts` resolves `context` nodes attached via `attaches-to` edges into `McpServerRef[]` `overrides` (no new node/edge kind); `execute-runner`/`run-executor` thread these as `mcpOverrides` into `materializeMcpConfig` (last-write-wins; `.kiro/` stays excluded from the captured patch). **Merge-back env knob:** `ORCH_AUTO_MERGE` (`true`/`false`, default ON). **+ Sprint 4 (WOW-1/WOW-2):** `run-executor` emits a run-level `node.child_run.started` linkage event for child sub-graph runs and a run-level `merge.promoted_to_parent` "fixer landed" signal on child-success promotion; `runtime/sync-main-checkout.ts` `syncMainCheckout` does a non-destructive **fast-forward-only** sync of the base working tree after promotion (gated by `ORCH_AUTO_MERGE`; never `reset --hard`/force; reuses `runMergeBack`/`promoteBase` untouched). `RUNTIME_EVENT_TYPES` is append-only (`+node.child_run.started`, `+merge.promoted_to_parent`). **+ Sprint 8 (Security & runtime hardening):** new pure helpers `circuit-breaker.ts` (run-level breaker — halt after 3 identical consecutive `{nodeKind,error}` failures; `run-executor` skips remaining unstarted nodes + finalizes `run.failed{reason}`), `write-scope-guard.ts` (generalized fail-closed `enforceWriteScope`/`checkWriteScope` — `doc-scope-guard` is now a thin preset; `run-executor` doc branch is fail-closed and `review` nodes assert read-only via `REVIEW_READONLY_SCOPE`), and `git-guard.ts` (`assertSafeGitArgs` rejects destructive git — wired into `worktree-manager`/`merge-back-coordinator`/`sync-main-checkout`/`lineage-coordinator`). `process-manager` gained a per-node timeout (`ORCH_NODE_TIMEOUT_MS`, `0`/unset = disabled; SIGTERM→SIGKILL; `timedOut`→`node.failed{reason:"timeout"}`). `secret-redaction` now scrubs the **persistence** seam (`mongo-run-repository`/`runs.appendEventsBatch`) + injected vault keys with a bounded pattern backstop. `worktree-manager.listChangedPaths` now surfaces git errors (fail-closed). **No new event type / no enum change.** Contract: `.claude/docs/core/api-contracts/runtime-run-sse-api.md`.
- `db/` — `client.ts` + Mongoose models (`graph` — **+ Sprint 6 (CLI-2):** additive optional graph-level `cli?: SupportedCli` (enum, no default; resolved node→graph→`fake` by `run-executor`); **+ Sprint 7 (PLAN-4):** additive optional `planId`/`sprintNumber`/`sprintName` (multi-sprint plan linkage; index `{ownerId, planId, sprintNumber}`); `run`, `secret`, `template`, `userSettings` — per-owner
  `allowedTools` + `plannerProvider` + `mergeStrategy`). **+ Sprint 7 (MODEL-1):** `graph-spec.zod` (`NodeSpecZ`/`EdgeSpecZ`, derived from the model enums — single source of truth) validates node/edge arrays on `graphs.update`/`createPlanGraphs`. **+ Sprint 8 (SEC-1):** `secret` gained additive optional `salt` + `kdf` (`"scrypt"`|`"sha256-legacy"`) for the salted/versioned vault KDF. **+ Sprint 9 (SKILL-1):** `graph-spec.zod` `NodeSpecZ` gained an additive, tolerant optional `data.skills?: string[]` (absent/string[] pass; a malformed present value is rejected; existing graphs unaffected).
- `middleware.ts` — Clerk middleware.

**+ Sprint 9 (Personas / rules / skills management):**
- **Templates (TPL-1/2):** `server/templates/seed.ts` now seeds personas **and** rules
  (`seedRules`/`ensureTemplatesSeeded`, `RULES_DIR` env); `server/routers/templates.ts` adds owner-scoped
  `create` (blank), `duplicate`, `delete` (workspace-only) alongside `list`/`getById`/`fork`/`update`.
  UI: `components/settings/TemplateManager.tsx` (persona/rule CRUD, Default/Workspace-fork badges,
  confirm-gated delete), mounted in `SettingsPanel` ("Personas & rules").
- **Export (TPL-3):** `server/templates/export-to-disk.ts` (`resolveExportPath`/`writeTemplateToDisk`,
  SEC-3-style containment refusing the orchestrator's own `.claude/`/traversal; `ORCH_SELF_REPO` env) +
  owner-scoped `templates.exportToDisk` mutation.
- **Fork resolution (TPL-4):** `server/templates/resolve-template.ts` (`resolvePersona`/`resolveRule`,
  fork-wins-else-default, owner-scoped). Execution: `runtime/prompt-assembly.ts` `applyPersonaBlock`
  (+ optional `personaContent`, `personaBlockPresent`); `run-executor` resolves a pinned `data.persona`
  for execute nodes. Planning: `plan` router attaches an additive `resolvedPersona` (workspace-only,
  best-effort); `plan/types.ts` + `plan/planner-prompt.ts` (`formatResolvedPersona`) forward it. Contract
  `architect-plan-api.md` §2 + §8c (additive; response contract unchanged).
- **Skills (SKILL-1/2):** `runtime/skill-materializer.ts` (`resolveSkillPaths`/`materializeSkills` →
  `<worktree>/.kiro/skills/<id>/`, patch-neutral; `SKILLS_ROOT` env) via the new
  `ExecuteRunner.materializeSkills` hook (execute/review/doc). Read-only `skills.list` router +
  `server/skills/skills-registry.ts` (`parseSkillsLock`, `SKILLS_LOCK_PATH` env). UI:
  `components/settings/SkillRegistry.tsx` + `components/canvas/SkillAttach.tsx` (Inspector multiselect →
  `data.skills` via `graphs.update`).
- New env knobs: `RULES_DIR`, `ORCH_SELF_REPO`, `SKILLS_ROOT`, `SKILLS_LOCK_PATH`.

---

## Run Locally

```bash
cp ../../.env.orchestrator.example ../../.env.orchestrator   # fill it in
npm install
npm run dev      # http://localhost:3000
```

With `MONGODB_URI` pointed at Atlas, Docker is not required for the app (allow
your IP in Atlas Network Access).

## Verify

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
npm run typecheck
```

---

## Test Runner

```bash
docker compose -f ../../docker-compose.orchestrator.yml up -d mongo   # local test DB
npm test        # vitest run
```

Tests intentionally do **not** use the shared Atlas DB by default (they delete
collections). Use a local Mongo, or set `MONGODB_TEST_URI` only if it points at
a disposable DB.

---

## Architectural Constraints

1. **Cookie auth only**: tRPC context reads the Clerk session cookie via
   `currentUser()`. The client sends no Bearer token; the `verifyToken()` path
   is not used for web/desktop (AD-3).
2. **Runtime runs on the host**: `execute-runner`/`worktree-manager`/`scheduler`
   run natively in the Next server (Electron main) so they can spawn CLIs and
   create git worktrees. Containers cannot (AD-4).
3. **Zero secret leakage**: `getSecretValue` is server-internal only — never
   expose it as a tRPC procedure. The vault key is derived via a salted,
   versioned **scrypt** KDF (SEC-1); the passphrase comes from Electron
   `safeStorage` (SEC-5 — generated + persisted in the OS keychain on first run),
   never logged (AD-8). Secrets are redacted on BOTH the SSE stream and the
   persistence seam, with a pattern backstop (SEC-2).
4. **Singletons via `globalThis`**: SSE hub, scheduler, the runtime `ProcessManager`
   (shared so `runs.cancel` reaches live processes), and Mongo connection use
   `globalThis.__x ??= new X()` to survive HMR and stay single-instance.
5. **ESM only**: top-level `import`, no `require()`.

---

**Maintained By**: Knowledge Manager · **Related**: `services/orchestrator/README.md`,
`TEAMMATE-SETUP.md`, `.claude/docs/core/orchestrator-architecture-decision.md`,
`.claude/docs/tasks/orchestrator-build-progress.md`
