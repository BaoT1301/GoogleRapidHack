# Orchestrator App

This is the current web/runtime app for the AI Workflow Orchestrator. It is a
Next.js 15 monolith: UI, tRPC API, SSE endpoints, Mongo models, and runtime
server modules all live here. Electron loads this app from `electron/`.

For the full teammate handoff, read:

- `../../TEAMMATE-SETUP.md`
- `../../.claude/docs/core/orchestrator-architecture-decision.md`
- `../../.claude/docs/tasks/orchestrator-build-progress.md`

## Run Locally

Create/fill the repo-root env file first:

```bash
cp ../../.env.orchestrator.example ../../.env.orchestrator
```

Then start the app:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

With `MONGODB_URI` pointed at Atlas, Docker is not required for the app. Make
sure your current IP is allowed in MongoDB Atlas Network Access.

## Frontend / Canvas

Dark-only design system: Tailwind v4 tokens (`src/app/globals.css`), Geist font,
Motion (reduced-motion safe), Phosphor icons, reusable primitives in
`src/components/ui/`. `TRPCReactProvider` is mounted in the root layout.

The canvas workspace lives at `/dashboard/[graphId]` (`@xyflow/react` v12):
custom node per kind, cycle-rejecting connections (the `loop` edge kind is
exempt — `loop` back-edges are allowed), debounced `graphs.update` save, a
right-hand inspector, a run viewer backed by `runs.create` → `runs.start` and
`GET /api/runs/:runId/events`, and an AI plan panel.

The AI plan panel (`PlanPanel`) is a two-step Socratic flow: the first call
(`plan.generate`, `approved:false`) surfaces the Architect's approaches +
clarifying questions; answering them and confirming (`approved:true` + the
accumulated `messages`) returns a `GraphSpec`, which `lib/plan-map.ts` maps onto
the canvas (`track`→execute node, `dependsOn`→flow edge, parallel→`gate`,
iterate→`loop` back-edge). Applying is **additive** — it never clobbers the
existing canvas. The forwarder returns the Architect's **top-level** body
(`ContextRequest | GraphSpec`) as-is; see
`../../.claude/docs/core/api-contracts/architect-plan-api.md`.

A persistent **Settings** panel (gear icon in the app shell) shows the Architect
config (`LLM_API_URL`, model, service-token present/absent — never the value)
and a live health badge driven by the `plan.health` query. It also hosts the
**planner provider toggle** — **Cloud (Gemini)** (default) or **Local (kiro-cli)** —
with each provider's readiness (`plan.providerStatus`), a live **CLI status** list
(auth badges from `system.capabilities`), and an **allowed-tools editor**
(`system.kiroTools` + `settings`) that maps to kiro `--trust-tools` for execute
nodes (read-only default, writes opt-in; the planner is always read-only).

Set `ORCH_PLAN_PROVIDER=local` (or flip the toggle) to plan with `kiro-cli`
instead of the Cloud Architect — this requires `kiro-cli login` (or `KIRO_API_KEY`)
and writes a `.kiro/settings/mcp.json` into the planned repo so the local planner
is codebase-aware. The response contract is identical, so the canvas is unchanged.

## Canvas Asset Storage (Theme Packs)

User-imported theme-pack sprites/backgrounds (Settings → Appearance) are stored
in a **private Google Cloud Storage bucket**; Mongo keeps **metadata only**
(`CanvasAsset`: id, owner, contentType, size, dims, `storageKey`). The bytes are
**proxy-streamed** by `GET /api/assets/[id]` — an unguessable capability URL
(the bucket is never public), preserving the SVG CSP sandbox. Upload/list/delete
stay authed + owner-scoped via the tRPC `assets` router.

- Object key scheme: `assets/{ownerId}/{ulid}`.
- Storage abstraction: `src/server/assets/storage.ts` (GCS impl + in-memory
  `FakeAssetStorage` for tests).
- Credentials use **Application Default Credentials (ADC)** — service-account
  JSON keys may be disabled by org policy. One-time local setup:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project "$GCP_PROJECT_ID"
```

Set `GCP_PROJECT_ID` and `GCS_ASSETS_BUCKET` in `.env.orchestrator` (see
`.env.orchestrator.example`).

## Verify

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
npm run typecheck
```

## Runtime Status

The monolith includes Stephen's runtime path under `src/server/runtime/`.
`runs.create` snapshots an owned graph into `RunModel`, and `runs.start`
fire-and-forgets `executeRun(runId, ownerId)`. Execute nodes run in isolated Git
worktrees, stream SSE immediately, and persist bounded Mongo node events,
patch metadata, and parsed `<!-- orch:output -->` summaries.

Runtime CLI diagnostics are available through `trpc.runtime.cliCapabilities`.
Those checks are passive and do not run AI prompts. `trpc.runtime.probeCodex` is
an explicit opt-in Codex probe for local authentication/model diagnostics and
may consume quota.

For the Phase 7.3 multi-CLI demo path, use
`docs/multi-cli-verification.md`. Codex remains the stable real CLI path;
Gemini is the recommended second CLI, but it must stay unverified until
`gemini --version` and non-interactive prompt mode are tested locally.

Reusable local demo graphs are available through dev-only procedures:

```ts
await trpc.runtime.listDemoGraphs.query();
await trpc.runtime.seedDemoGraph.mutate({
  demoGraphId: "four_fake_parallel", // "fake_dependency_chain" | "one_codex_smoke" | "plan_proposal_demo" | "gate_fan_in_demo" | "loop_child_graph_demo"
  rootRepoPath: "/Users/macbook/Hack/ai-workflow-template",
  baseBranch: "stephen-develop",
});
```

These seed helpers create graphs for the current owner and are disabled in
production. Fake demos do not require any AI CLI; the Codex smoke graph requires
local Codex authentication before running. For Plan/Gate/Loop demo steps, use
`docs/demo/plan-gate-loop-demo-checklist.md`; `loop_child_graph_demo` creates a
linked child fake graph automatically during seeding.

Merge review is exposed through owner-scoped runtime procedures:

```ts
await trpc.runtime.mergePreview.mutate({
  runId,
  nodeId,
  targetBranch: "main",
});

await trpc.runtime.mergeApply.mutate({
  runId,
  nodeId,
  targetBranch: "main",
  strategy: "squash", // or "no-ff"
  commitMessage: `Merge ${nodeId} agent changes`,
});

await trpc.runtime.mergeAbort.mutate({
  runId,
  nodeId,
  targetBranch: "main",
  mergeWorktreePath,
});
```

The server verifies `{ _id: runId, ownerId }`, derives `rootRepoPath`,
`worktreePath`, and source branch from the owned run where possible, emits
`merge.*` events on the run SSE stream, and persists merge results under
`nodeRuns.<nodeId>.outputs.merge`. Merges run only in temporary merge worktrees;
the main checkout is not merged directly, nothing is pushed, and worktrees are
not deleted automatically.

Runtime storage inspection and cleanup are exposed through owner-scoped runtime
procedures:

```ts
await trpc.runtime.storageInspect.query({ runId });

await trpc.runtime.cleanup.mutate({
  scope: "node", // or "run"
  runId,
  nodeId, // required for node cleanup
  confirm: true,
  discardAgentChanges: true, // required when agent worktrees are dirty
  discardMergeResults: true, // required when isolated merge results exist
});
```

The server verifies `{ _id: runId, ownerId }`, derives the repository path from
the owned run snapshot, rejects cleanup for active subprocesses, and deletes only
derived `.orchestrator/worktrees`, `.orchestrator/merge-worktrees`, and
`.orchestrator/tmp` artifacts plus matching `agent/<runId>/<nodeId>` and
`merge/<runId>/<nodeId>/*` branches. Cleanup never deletes arbitrary paths and
does not modify the main checkout.

Current stable runtime path is the deterministic fake adapter. Codex support is
adapter-ready and locally diagnosable; Kiro/Gemini/Claude remain adapter-ready
but unverified unless the corresponding CLI is installed and tested locally.

### Manual Codex Smoke

Codex is never invoked by passive capability checks or automated tests. To
smoke-test the monolith ExecuteRunner path with a temp git repo:

```bash
cd services/orchestrator
npm run smoke:runtime:codex
```

This opt-in smoke creates a temporary git repo, runs one `cli: "codex"` Execute
node, verifies the isolated worktree and patch metadata, checks the main temp
repo stays clean, and cleans up after itself. Local Codex auth/model/config
failures are reported as actionable diagnostics instead of breaking unrelated
tests.

Basic local checks:

```bash
which codex
codex --version
```

Then create a graph with one Execute node using `cli: "codex"` and a prompt
that writes a small file in the isolated worktree and prints:

```text
<!-- orch:output -->
{"summary":"Codex smoke complete","filesChanged":["CODEX_SMOKE.md"],"status":"ready_for_review"}
```

The runtime launches Codex as:

```bash
codex exec --sandbox workspace-write --cd <worktreePath> <wrappedPrompt>
```

The subprocess `cwd` is also set to `<worktreePath>`. Do not use `--yolo`,
`danger-full-access`, or sandbox-bypass flags.

Codex troubleshooting:

- Missing CLI: install Codex CLI and confirm `which codex` and `codex --version` work from the same shell that starts `services/orchestrator`.
- Auth issue: run the appropriate local Codex login/auth flow, then retry `npm run smoke:runtime:codex`.
- Model requires newer CLI: upgrade Codex CLI. This appears as errors like “model requires a newer version of Codex”.
- Sandbox read-only issue: ensure runtime Codex command uses `--sandbox workspace-write`; read-only sandbox prevents file creation.
- Plugin-cache warnings: missing plugin cache files can print warnings before Codex runs. They are usually not fatal unless Codex exits nonzero.

Each node also materializes an MCP config file at:

```text
<rootRepoPath>/.orchestrator/tmp/<runId>/<nodeId>/mcp-config.json
```

The file is written with private permissions and is passed to adapters as
`mcpConfigPath`. Codex currently continues to use the local global
`~/.codex/config.toml` MCP setup until per-run Codex config injection is
verified. The config content is never emitted over SSE or logged.

## Tests

Tests intentionally do **not** use the shared Atlas DB by default because they
delete test collections. Use a local Mongo or a dedicated test database:

```bash
docker compose -f ../../docker-compose.orchestrator.yml up -d mongo
npm test
```

Override with `MONGODB_TEST_URI` only if it points at a disposable test DB.

## Electron

From the repo root:

```bash
cd electron
npm install
npm start
```

Runtime packaging notes:

- `services/orchestrator/scripts/fake-agent.js` is copied into `.next/standalone/scripts/fake-agent.js` during `npm run build`.
- The fake adapter runs that script with the same Node-compatible executable that launched the server, so packaged Electron does not require a separate user-installed `node` binary for fake nodes.
- Runtime artifacts are still created under the selected workspace repo path: `<rootRepoPath>/.orchestrator/...`. They are not created inside the Electron app bundle.
- Codex, Gemini, Kiro, and Claude are external user-machine CLIs. The packaged app does not bundle them.
- GUI-launched apps may not inherit the same shell `PATH` as Terminal. If a CLI is installed but capabilities show it as missing, set `ORCH_CLI_PATH_EXTRA` in `.env.orchestrator` to the directories that contain those commands, for example:

```bash
ORCH_CLI_PATH_EXTRA=/opt/homebrew/bin:/usr/local/bin
```

`.env.orchestrator` is loaded for local dev and Electron server startup, but it is not bundled into Electron resources by default. To create a private local smoke build that includes your local env file, opt in explicitly:

```bash
ORCH_BUNDLE_ENV=1 npm run pack
```

Do not distribute builds created with `ORCH_BUNDLE_ENV=1` because they may contain secrets.

For an unpacked desktop build, first run `npm run build` in this app, then:

```bash
cd ../../electron
npm run pack
```

Packaged runtime smoke:

1. Launch Electron with `cd electron && npm start` for dev or open the unpacked app after `npm run pack`.
2. Sign in or use dev auth as configured.
3. Seed or create the `four_fake_parallel` graph.
4. Start a run.
5. Verify terminal SSE logs stream for all fake nodes.
6. Verify each node creates a distinct worktree under `<rootRepoPath>/.orchestrator/worktrees`.
7. Verify patch/output summaries appear and the main checkout remains unchanged.
