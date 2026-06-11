# Runtime UI Contract

Audience: LA, dashboard / React Flow / node inspector / run viewer / SSE terminal / lasso-spawn-fixer UI owner.

This document describes the current shippable monolith contract in `services/orchestrator`. The prototype service in `services/orchestrator-api` is reference-only and should not be used by the dashboard.

## Graph CRUD

Use the existing graph procedures. All procedures are owner-scoped by the server through Clerk/dev auth; do not pass `ownerId` from the client.

```ts
const graph = await trpc.graphs.create.mutate({
  name: "Runtime demo",
  description: "Four fake execute nodes",
  rootRepoPath: "/Users/macbook/Hack/ai-workflow-template",
  baseBranch: "stephen-develop",
});

const updated = await trpc.graphs.update.mutate({
  id: graph._id,
  name: graph.name,
  rootRepoPath: graph.rootRepoPath,
  nodes,
  edges,
  status: "draft",
});

const saved = await trpc.graphs.getById.query({ id: graph._id });
const graphs = await trpc.graphs.list.query();
await trpc.graphs.delete.mutate({ id: graph._id });
```

`graphs.update` currently accepts `nodes` and `edges` as flexible arrays. The UI should still save the stricter shapes below so Stephen's runtime can read them consistently.

## Runtime Demo Graphs

For local dashboard testing, LA can seed reusable demo graphs through dev-only runtime procedures. These helpers are disabled when `NODE_ENV === "production"` and create graphs for the current authenticated/dev user.

```ts
const demos = await trpc.runtime.listDemoGraphs.query();

const graph = await trpc.runtime.seedDemoGraph.mutate({
  demoGraphId: "four_fake_parallel",
  rootRepoPath: "/Users/macbook/Hack/ai-workflow-template",
  baseBranch: "stephen-develop",
});
```

Available `demoGraphId` values:

| ID | Purpose | Requires Real CLI |
| --- | --- | --- |
| `four_fake_parallel` | Four independent fake execute nodes for terminal/SSE/worktree testing. | No |
| `fake_dependency_chain` | `A -> B -> C` fake execute graph for dependency UI testing. The active run path enforces flow-edge ordering. | No |
| `one_codex_smoke` | One Codex execute node that creates `CODEX_RUNTIME_TEST.md`. | Codex |
| `multi_cli_codex_gemini` | Phase 7.3 graph with Codex, Gemini, and fake fallback nodes. Codex and Gemini write separate files in separate worktrees. | Codex + Gemini |
| `plan_proposal_demo` | Plan node generates a proposal/context result, blocks downstream by default, and can be explicitly applied to the graph for the next run. | Planner config if using real planner |
| `gate_fan_in_demo` | Two fake execute nodes feed all-of and any-of Gates, then downstream fake nodes show pass/block behavior. | No |
| `loop_child_graph_demo` | Loop node linked to an automatically seeded child fake graph; shows iteration events and max-iteration summary. | No |
| `mixed_plan_gate_loop_demo` | Optional mixed topology: Plan -> fake branches -> Gate -> Loop -> Execute. Plan blocks by default unless explicitly configured otherwise. | Planner config if running through Plan |

For `multi_cli_codex_gemini`, the dashboard should disable or hide the Gemini node/run action unless `trpc.runtime.cliCapabilities.query()` reports both `capabilities.codex.available === true` and `capabilities.gemini.available === true && capabilities.gemini.verified === true`.

For the Plan/Gate/Loop demo flow, use `docs/demo/plan-gate-loop-demo-checklist.md`.

## AI Improve Selected Nodes Contract

This is the backend contract for the same-canvas “AI improve selected nodes” flow. It is separate from `graphs.spawnChild`: spawn-fixer creates a linked child graph, while this contract proposes a patch for the currently selected subgraph and only mutates the graph after explicit Apply.

### Demo UI Flow

The dashboard flow is intentionally same-canvas and preview-first:

1. Hover a node to show the subtle node halo. Hover does not select.
2. Lasso or multi-select nodes using the existing React Flow selection behavior.
3. Click **Improve selected with AI** or use the context menu action.
4. Enter a prompt, choose a mode, then either choose **Auto-select best model** or manually choose a provider and exact backend-allowed model name.
5. Generate a proposal. Selected nodes should pulse while generation is in flight.
6. Review the patch preview before mutation. The preview should distinguish updated nodes, added nodes, removed nodes, changed edges, warnings, and rationale.
7. Click **Apply to canvas**. Apply calls the backend with `confirm: true`, then updates the current canvas and highlights changed nodes/edges.
8. Click **Undo AI change** to restore the exact local `{ nodes, edges }` snapshot from before Apply and persist that restored graph through the normal graph save path.

Unsupported or unconfigured providers/models should be visible as disabled options with a reason, or hidden if the UI design requires a shorter list. **Auto-select best model** is resolved server-side through the backend model router and returns the chosen provider/model plus a short reason. The UI must never expose API keys, vault values, or raw provider configuration.

Current provider status is intentionally conservative: the backend model catalog and patch contract are implemented, and selected-subgraph generation uses the locally installed/authenticated Codex CLI with backend-allowlisted GPT model IDs. No app API key is required for this path. The test-only mock path requires `ORCH_AI_PATCH_MOCK=1` while `NODE_ENV=test`; normal local/browser usage should run through Codex CLI.

### Model Catalog

The UI must read provider/model choices from the backend. Do not hardcode enabled model IDs as the source of truth.

```ts
const catalog = await trpc.ai.modelCatalog.query();
```

Response:

```ts
{
  providers: [
    {
      provider: "gemini" | "openai" | "claude" | "codex",
      label: string,
      configured: boolean,
      enabled: boolean,
      disabledReason?: string,
      models: [
        {
          id: string,
          label: string,
          enabled: boolean,
          configured: boolean,
          disabledReason?: string,
          quotaWarning?: string,
        }
      ],
    }
  ],
}
```

Current backend allowlist:

| Provider | Model IDs |
| --- | --- |
| Gemini | `gemini-2.5-pro`, `gemini-2.0-flash`, `gemini-1.5-pro`, `gemini-1.5-flash` |
| OpenAI / GPT | `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o`, `gpt-4o-mini` |
| Claude | `claude-sonnet-4`, `claude-3-7-sonnet`, `claude-3-5-sonnet` |
| Codex CLI / GPT | `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o`, `gpt-4o-mini` |

Selected-subgraph proposal generation supports local Codex CLI/GPT when `codex` is visible to the Next server PATH. `ORCH_AI_PATCH_MOCK=1` is test-only and should not be used for the real browser demo. When Codex is unavailable, models are visible but disabled/not configured and the UI should block proposal generation. The catalog never returns API keys, tokens, or secret values.

### Auto Model Router

The frontend may submit `provider: "auto"` and `model: "auto"` for tasks where the user chooses **Auto-select best model**. The backend selects from the same allowlisted/configured catalog and rejects arbitrary model IDs.

Routing intent:

| Task Type | Preferred Route |
| --- | --- |
| `planning` | Strongest configured planner model. |
| `graph_patch` | Local Codex CLI/GPT when available. |
| `code_editing` | Codex when explicitly configured for routing; otherwise a safe configured fallback. |
| `code_review` | Strong reasoning model. |
| `docs`, `summary`, `quick_fix` | Fast/cheap configured model. |

The routed response includes `modelSelection`:

```ts
{
  provider: "gemini" | "openai" | "claude" | "codex" | "cloud" | "local";
  model: string;
  automatic: boolean;
  reason: string;
}
```

Manual override remains supported, but `provider` and `model` must match the backend allowlist and current configured/enabled state. The UI is never the source of truth for enabled model IDs.

### Propose A Subgraph Patch

```ts
const proposal = await trpc.ai.proposeSubgraphPatch.mutate({
  graphId,
  selectedNodeIds: ["node_frontend", "node_tests"],
  prompt: "split this into parallel agents and add tests",
  provider: "gemini",
  model: "gemini-2.5-pro",
  mode: "improve", // "fix" | "improve" | "expand" | "refactor"
});
```

Auto route example:

```ts
const proposal = await trpc.ai.proposeSubgraphPatch.mutate({
  graphId,
  selectedNodeIds: ["node_frontend", "node_tests"],
  prompt: "make this workflow more robust",
  provider: "auto",
  model: "auto",
  mode: "improve",
});
```

Validation:

- The authenticated/dev user must own the graph.
- `selectedNodeIds` must exist in the graph and cannot be empty.
- `prompt` must be non-empty.
- `provider` must be `auto` or exist in the backend allowlist.
- Manual `model` values must belong to that provider and be enabled/configured.
- Arbitrary model IDs are rejected.
- Proposal generation does not mutate the graph.

Response:

```ts
{
  proposalId: string,
  graphId: string,
  provider: "gemini" | "openai" | "claude" | "codex",
  model: string,
  modelSelection?: {
    taskType: "graph_patch",
    provider: "gemini" | "openai" | "claude" | "codex",
    model: string,
    automatic: boolean,
    reason: string,
  },
  patch: {
    graphId: string,
    selectedNodeIds: string[],
    summary: string,
    rationale?: string,
    operations: [
      | { type: "updateNode", nodeId: string, patch: Partial<NodeSpec> }
      | { type: "addNode", node: NodeSpec }
      | { type: "deleteNode", nodeId: string, reason?: string }
      | { type: "addEdge", edge: EdgeSpec }
      | { type: "deleteEdge", edgeId: string, reason?: string }
      | { type: "updateEdge", edgeId: string, patch: Partial<EdgeSpec> }
    ],
    warnings: string[],
    requiresConfirmation?: boolean,
  },
}
```

### Apply A Subgraph Patch

Apply is explicit and confirm-gated. The proposal is revalidated before graph mutation.

```ts
const updatedGraph = await trpc.ai.applySubgraphPatch.mutate({
  graphId,
  proposalId,
  confirm: true,
});
```

Apply behavior:

- Verifies the authenticated/dev user owns the graph.
- Verifies the proposal belongs to that user and graph.
- Requires `confirm: true`.
- Rejects missing node/edge references.
- Rejects duplicate node/edge IDs.
- Rejects flow-edge cycles.
- Mutates the graph only after validation passes.

### MVP Undo Strategy

The graph model does not currently provide true revision/history. For MVP undo, the UI should keep a local `{ nodes, edges }` snapshot before Apply. If the user clicks Undo, restore that exact snapshot through the existing graph save/update path. The UI should animate changed nodes/edges forward on Apply and reverse the same changed IDs on Undo.

## Minimal Plan Node Shape

Plan nodes are executable runtime nodes now, but they are proposal-first and do
not mutate the graph automatically.

```ts
type PlanNodeForRuntime = {
  id: string;
  kind: "plan";
  label: string;
  position: { x: number; y: number };
  status: "pending";
  data: {
    objective?: string;
    prompt?: string;
    provider?: "cloud" | "local";
    model?: string;
    allowDownstreamAfterProposal?: boolean;
  };
};
```

Runtime behavior:

- Emits/persists `node.plan.started` when planning starts.
- Calls the server-internal planner service, not the public tRPC procedure.
- If the planner returns `ContextRequest`, persists `outputs.plan.status = "context_required"`, emits `node.plan.context_required`, and marks the node `blocked`.
- If the planner returns `GraphSpec`, maps it through `planToGraphSpec()` into proposed canvas nodes/edges, persists `outputs.plan.status = "proposal_ready"`, emits `node.plan.proposal_ready`, and marks the node `blocked` by default.
- The graph is never mutated during runtime. The user must explicitly apply the proposal later.
- `data.allowDownstreamAfterProposal === true` is an advanced opt-in that marks a proposal-ready Plan node `success` so downstream flow successors can run. Leave this unset for normal preview-first behavior.
- `data.provider` may be `"auto"` in the UI/runtime contract. Auto uses the backend model router to pick
  the strongest available planning route (`cloud` when configured, otherwise the local planner path).
- `data.model` may be `"auto"` or a backend-allowlisted manual model. Manual model values are validated
  before provider invocation. A provider may still use its configured/default model if that provider does
  not support exact model routing, and the Plan output includes a warning/reason.

Persisted Plan output is stored under `nodeRuns.<nodeId>.outputs.plan` and includes:

```ts
{
  kind: "plan";
  status: "proposal_ready" | "context_required" | "failed";
  provider: "cloud" | "local";
  model?: string;
  objective: string;
  prompt: string;
  resultType?: "context_request" | "graph_spec";
  contextRequest?: unknown;
  graphProposal?: {
    featureName?: string;
    sprintNumber?: number;
    missingContext?: string[];
    proposedNodes: INodeSpec[];
    proposedEdges: IEdgeSpec[];
    rawGraphSpecPreview: unknown;
  };
  warnings: string[];
  generatedAt: string;
}
```

### Apply A Plan Node Proposal

Runtime never auto-applies Plan node proposals. The run snapshot remains immutable;
applying a Plan proposal updates the current graph draft/canvas for the next run.
It does not resume or mutate the already-running scheduler.

```ts
const updatedGraph = await trpc.graphs.applyPlanNodeProposal.mutate({
  graphId,
  runId,
  nodeId: "plan_1",
  confirm: true,
  mode: "append", // current supported mode
});
```

Validation and behavior:

- The authenticated/dev user must own both the graph and run.
- The run must belong to the same graph.
- `nodeRuns.<nodeId>.outputs.plan.kind` must be `"plan"`.
- `outputs.plan.status` must be `"proposal_ready"`.
- `outputs.plan.graphProposal.proposedNodes` and `proposedEdges` are revalidated.
- Apply is additive in MVP: proposed nodes/edges are appended to the current graph.
- Duplicate node IDs, duplicate edge IDs, missing edge endpoints, duplicate connections, and flow cycles are rejected.
- Existing graph content is not deleted by this procedure.
- The procedure emits/persists `node.plan.apply.started`, then `node.plan.applied` or `node.plan.apply.failed`.
- It marks `outputs.plan.applied = true`, `appliedAt`, and `appliedGraphId` on the run node output when successful.

MVP undo remains client-local: before calling Apply, store the exact `{ nodes,
edges }` snapshot. If the user clicks Undo, restore that snapshot through
`graphs.update`. This is not collaborative revision history.

### Plan Node Demo UI Checklist

For a demo-ready Plan node surface, the dashboard should show:

1. Inspector fields for Objective, Prompt, planner Provider, optional model name,
   and the advanced `allowDownstreamAfterProposal` toggle.
2. Helper copy: “Plan nodes generate proposals during a run. They do not
   auto-mutate the graph. Applying a proposal updates the graph for the next run.”
3. Canvas states for Plan nodes:
   - `planning` while `node.plan.started` is live.
   - `context required` after `node.plan.context_required`.
   - `proposal ready` after `node.plan.proposal_ready`.
   - `applied` after `node.plan.applied`.
   - `failed` after `node.plan.failed` or `node.plan.apply.failed`.
4. Run viewer Plan tab:
   - ContextRequest confidence, questions, and missing context.
   - Proposal provider/model, proposed node/edge counts, proposed node/edge
     previews, and warnings.
   - Distinct states for `proposal_ready` but unapplied, `applied`,
     `context_required`, and `failed`.
   - `Apply proposal to canvas` button when `outputs.plan.graphProposal` exists.
5. Apply flow:
   - Capture local `{ nodes, edges }` before apply.
   - Call `graphs.applyPlanNodeProposal({ graphId, runId, nodeId, confirm: true, mode: "append" })`.
   - Replace the current canvas with the returned graph.
   - Show “Plan proposal applied.”
6. Undo flow:
   - Restore the local pre-apply snapshot.
   - Persist through `graphs.update`.
   - Show “Canvas restored to previous state.”

The existing AI Plan panel remains separate but related: it generates plan output
directly for the canvas flow, while runtime Plan nodes generate proposals during
a run and require explicit apply afterward.

## Minimal Execute Node Shape

The persisted graph node uses `kind`, not `type`.

```ts
type ExecuteNodeForRuntime = {
  id: string;
  kind: "execute";
  label: string;
  position: { x: number; y: number };
  status: "pending";
  data: {
    cli: "fake" | "codex" | "kiro" | "gemini" | "claude";
    prompt: string;
    baseRef?: string;
    allowedPaths?: string[];
    timeoutMs?: number;
    secretId?: string;
    secretRefs?: Record<string, string>;
  };
};
```

Runtime fields used now:

- `id`: becomes `nodeId`.
- `kind`: must be `"execute"` to run.
- `label`: fallback prompt when `data.prompt` is empty.
- `data.cli`: current stable paths are `fake` and `codex`; unsupported CLIs fail cleanly.
- `data.prompt`: primary node prompt.
- `data.baseRef`: optional per-node base ref; otherwise graph `baseBranch` is used.
- `data.secretRefs`: optional adapter secret references for server-side lookup.
- `data.allowedPaths`: optional repo-relative path prefixes enforced after diff capture.
- `data.pathPolicyMode`: optional `"warn"` or `"fail"` policy mode for `allowedPaths`; defaults to `"warn"` so existing demos keep running while surfacing violations.
- `data.timeoutMs`: optional per-node runtime timeout. The server clamps this to safe min/max bounds before spawning the subprocess.

Fields accepted for future UI compatibility but not fully enforced yet:

- `data.secretId`

`allowedPaths` behavior:

- Empty or missing `allowedPaths` allows all changed files for the MVP.
- Values are treated as repo-relative path prefixes, for example `["services/orchestrator/src", "docs"]`.
- Path traversal entries such as `../secret` are ignored and surfaced as policy warnings.
- In `"warn"` mode, files outside the allowlist emit `node.rule.warning` but the node may still complete.
- In `"fail"` mode, files outside the allowlist emit `node.rule.warning` and then `node.failed` with reason `path_policy_violation`.
- The CLI prompt includes the allowlist as a hint, but enforcement happens after git diff capture and does not depend on prompt compliance.

Runtime circuit breaker defaults:

| Limit | Default |
| --- | --- |
| Max node runtime | 10 minutes |
| Min accepted `data.timeoutMs` | 1 second |
| Max accepted `data.timeoutMs` | 60 minutes |
| SIGTERM to SIGKILL grace | 10 seconds |
| Max accumulated stdout | 2 MiB |
| Max accumulated stderr | 512 KiB |
| Max combined accumulated output | 3 MiB |
| Patch preview | 8 KiB |
| SSE/Mongo event payload | 16 KiB |

Circuit breaker behavior:

- Timeout emits `node.timeout`, terminates the subprocess with SIGTERM then SIGKILL after the grace period, preserves the worktree, and ends with `node.failed` reason `timeout`.
- Output limit violations emit `node.rule.warning` with rule `outputLimit`.
- Output is capped in memory; stdout/stderr text is not accumulated without bounds.
- Hard output-limit mode marks the node failed with reason `output_limit_exceeded`.
- Patch events preserve `patchLength` but only include a bounded `patchPreview`.
- Large event payloads are truncated and include `truncated: true`.

Stephen-owned runtime enforcement status:

- Redaction is applied before SSE publishing and before Mongo event persistence.
- Subprocesses receive only the safe base environment plus explicit runtime/env-builder values.
- Worktree, merge-worktree, and MCP temp config paths are bounded under `.orchestrator/`.
- Runtime storage cleanup is guarded and only removes derived `.orchestrator` artifacts after confirmation.
- `allowedPaths`, timeout, stdout/stderr caps, patch preview caps, event payload caps, and dependency skip events are covered by focused fake-only tests.

## Supported Edge Shape

Save flow edges with this shape:

```ts
type FlowEdgeForRuntime = {
  id: string;
  source: string;
  target: string;
  kind: "flow";
};
```

Current monolith runtime note: `runs.start` walks all node kinds through the runtime scheduler. `execute`, `plan`, `gate`, `review`, `doc`, and `loop` have special runtime behavior; bare `context` nodes are skipped unless consumed by attached execute nodes. Nodes with no incoming flow edges can start immediately, and downstream nodes start only after all incoming flow-edge predecessors complete successfully. If an upstream node fails or is blocked/skipped, dependent nodes emit `node.skipped` and are persisted as skipped. Max concurrency remains 4.

## Runtime Node Kind Status

| Kind | Current Runtime Status |
| --- | --- |
| `execute` | CLI/worktree runtime node. Runs a configured CLI in an isolated `.orchestrator/worktrees/<runId>/<nodeId>` worktree, captures stdout/stderr, patch metadata, and structured output. |
| `plan` | Executable proposal node. Calls the internal planner service, returns either `ContextRequest` or a `GraphSpec` proposal, persists `outputs.plan`, and never auto-mutates the graph. Explicit apply updates the current graph for the next run. Downstream is blocked by default unless `data.allowDownstreamAfterProposal === true`. `data.provider`/`data.model` support `auto`; manual model overrides are backend-allowlisted and validated, but exact routing is still limited by provider support. |
| `gate` | Deterministic fan-in control node. It does not run a CLI and does not create a worktree. Runtime reads fan-in mode from incoming flow edges: default `all-of`, or `any-of` when an incoming flow edge has `fanInMode: "any-of"`. A gate with no incoming flow predecessors is blocked with a clear reason. |
| `loop` | Child-graph runtime loop MVP. Re-runs a linked child graph until the child succeeds, a child cancellation/failure is reported, or `maxIterations` is reached. `maxIterations` defaults to 3 and is hard-capped at 10. `breakCondition` is a planning hint only and is persisted with `breakConditionEvaluated:false`; it is not semantically evaluated yet. |
| `review` | Runtime-executed read-only audit node, persona-locked to `integration_reviewer`/`orch-reviewer`; it is not a merge candidate. |
| `doc` | Runtime-executed doc-scoped write node, persona-locked to `knowledge_manager`/`orch-doc`; post-run scope guard fails writes outside `.claude/**` / `*.md`. |
| `context` | No standalone runner. Consumed by attached execute nodes for prompt/MCP context; bare context nodes are skipped. |

## Start A Run

Current start flow is two tRPC calls:

```ts
const run = await trpc.runs.create.mutate({ graphId });

const start = await trpc.runs.start.mutate({
  runId: run._id,
});

const eventsUrl = `/api/runs/${run._id}/events`;
```

Actual responses:

```ts
// trpc.runs.create
{
  _id: string;
  graphId: string;
  ownerId: string;
  graphSnapshot: Record<string, unknown>;
  status: string;
  startedAt?: string;
  nodeRuns: Record<string, unknown> | Map<string, unknown>;
}

// trpc.runs.start
{
  started: true;
  runId: string;
}
```

Recommended UI-normalized shape:

```ts
{
  runId: run._id,
  eventsUrl: `/api/runs/${run._id}/events`
}
```

## Start A Spawned Child Graph Run

After `trpc.graphs.spawnChild` returns a child graph, LA can either open the
child graph and use the normal `runs.create` → `runs.start` flow, or use the
Phase 7.2 convenience helper:

```ts
const childRun = await trpc.runs.createAndStartChild.mutate({
  childGraphId,
  parentRunId, // optional, when the child was spawned while a parent run exists
  parentNodeIds: ["node_parent"], // optional; defaults to childGraph.parentNodeId
});

const es = new EventSource(childRun.eventsUrl);
```

Response:

```ts
{
  started: true;
  runId: string;
  eventsUrl: `/api/runs/${string}/events`;
  parentGraphId: string;
  parentRunId?: string;
  parentNodeIds: string[];
  childGraphId: string;
  childRunId: string;
}
```

The helper reuses the same runtime path as regular graph runs:

- It snapshots the owned child graph into `RunModel`.
- It persists child metadata on the run: `parentGraphId`, optional
  `parentRunId`, `parentNodeIds`, `childGraphId`, and `childRunId`.
- It starts the existing `executeRun` runtime entry point.
- It streams over the same SSE endpoint: `/api/runs/:runId/events`.

UI guidance:

- Display the child run under the parent graph/node context using
  `parentGraphId`, `parentNodeIds`, and `childRunId`.
- Subscribe to `eventsUrl` exactly like a normal run.
- Keep child execution status separate from merge/promotion status.
- Promotion is still explicit and manual through `runtime.mergePreview` and
  `runtime.mergeApply`; this helper does not batch merge or auto-promote.

## SSE Endpoint

Subscribe with same-origin cookies:

```ts
const es = new EventSource(`/api/runs/${runId}/events`);
es.onmessage = (event) => {
  const data = JSON.parse(event.data);
};
```

Endpoint:

```http
GET /api/runs/:runId/events
```

The route verifies ownership with `{ _id: runId, ownerId }` before subscribing.

## Event Shape

Runtime execution events use:

```ts
type RuntimeEvent = {
  type: string;
  runId: string;
  nodeId?: string;
  timestamp: string;
  payload: Record<string, unknown>;
};
```

Merge events emitted by `trpc.runtime.merge*` currently use the monolith persisted event envelope on SSE:

```ts
type PersistedNodeEvent = {
  ts: string;
  level: "info" | "warn" | "error" | "tool" | "stdout" | "stderr";
  nodeId?: string;
  payload: Record<string, unknown> & { type: string };
};
```

The run viewer should tolerate both shapes by reading `event.type ?? event.payload?.type`.

## Event Examples

### `run.started`

```json
{
  "type": "run.started",
  "runId": "run_123",
  "timestamp": "2026-06-03T12:00:00.000Z",
  "payload": { "nodeCount": 4 }
}
```

### `node.queued`

Emitted when an upstream flow-edge dependency fails and the scheduler blocks a downstream execute node.

```json
{
  "type": "node.queued",
  "runId": "run_123",
  "nodeId": "node_frontend",
  "timestamp": "2026-06-03T12:00:00.000Z",
  "payload": { "cli": "fake", "promptLength": 18 }
}
```

### `node.starting`

```json
{
  "type": "node.starting",
  "runId": "run_123",
  "nodeId": "node_frontend",
  "timestamp": "2026-06-03T12:00:01.000Z",
  "payload": { "cli": "fake", "baseRef": "stephen-develop" }
}
```

### `node.worktree.created`

```json
{
  "type": "node.worktree.created",
  "runId": "run_123",
  "nodeId": "node_frontend",
  "timestamp": "2026-06-03T12:00:02.000Z",
  "payload": {
    "worktreePath": "/Users/macbook/Hack/ai-workflow-template/.orchestrator/worktrees/run_123/node_frontend",
    "branchName": "agent/run_123/node_frontend",
    "baseRef": "stephen-develop"
  }
}
```

### `node.stdout`

```json
{
  "type": "node.stdout",
  "runId": "run_123",
  "nodeId": "node_frontend",
  "timestamp": "2026-06-03T12:00:03.000Z",
  "payload": { "line": "[fake-agent] starting node node_frontend" }
}
```

### `node.stderr`

```json
{
  "type": "node.stderr",
  "runId": "run_123",
  "nodeId": "node_frontend",
  "timestamp": "2026-06-03T12:00:03.100Z",
  "payload": { "line": "[fake-agent] node node_frontend warning: using deterministic fake implementation" }
}
```

### `node.timeout`

```json
{
  "type": "node.timeout",
  "runId": "run_123",
  "nodeId": "node_frontend",
  "timestamp": "2026-06-03T12:00:03.500Z",
  "payload": { "timeoutMs": 600000 }
}
```

### `node.patch`

```json
{
  "type": "node.patch",
  "runId": "run_123",
  "nodeId": "node_frontend",
  "timestamp": "2026-06-03T12:00:04.000Z",
  "payload": {
    "patchLength": 255,
    "patchPreview": "diff --git a/ORCH_FAKE_AGENT_EDIT.md b/ORCH_FAKE_AGENT_EDIT.md\n..."
  }
}
```

### `node.output`

```json
{
  "type": "node.output",
  "runId": "run_123",
  "nodeId": "node_frontend",
  "timestamp": "2026-06-03T12:00:04.100Z",
  "payload": {
    "output": {
      "summary": "Fake agent node_frontend completed successfully",
      "filesChanged": ["ORCH_FAKE_AGENT_EDIT.md"],
      "status": "ready_for_review"
    }
  }
}
```

### `node.rule.warning`

```json
{
  "type": "node.rule.warning",
  "runId": "run_123",
  "nodeId": "node_frontend",
  "timestamp": "2026-06-03T12:00:04.200Z",
  "payload": {
    "rule": "allowedPaths",
    "mode": "warn",
    "allowedPaths": ["services/orchestrator/src"],
    "violatingFiles": ["ORCH_FAKE_AGENT_EDIT.md"],
    "warnings": []
  }
}
```

Output circuit breaker warning example:

```json
{
  "type": "node.rule.warning",
  "runId": "run_123",
  "nodeId": "node_frontend",
  "timestamp": "2026-06-03T12:00:04.250Z",
  "payload": {
    "rule": "outputLimit",
    "stream": "stdout",
    "reason": "stdout_limit_exceeded",
    "stdoutBytes": 2097152,
    "stderrBytes": 0,
    "combinedOutputBytes": 2097152
  }
}
```

### `node.completed`

```json
{
  "type": "node.completed",
  "runId": "run_123",
  "nodeId": "node_frontend",
  "timestamp": "2026-06-03T12:00:05.000Z",
  "payload": { "cli": "fake", "exitCode": 0 }
}
```

### `node.failed`

```json
{
  "type": "node.failed",
  "runId": "run_123",
  "nodeId": "node_frontend",
  "timestamp": "2026-06-03T12:00:05.000Z",
  "payload": {
    "cli": "codex",
    "exitCode": 1,
    "stderrPreview": "Codex CLI not found"
  }
}
```

Path policy failure example:

```json
{
  "type": "node.failed",
  "runId": "run_123",
  "nodeId": "node_frontend",
  "timestamp": "2026-06-03T12:00:05.000Z",
  "payload": {
    "cli": "codex",
    "exitCode": 0,
    "reason": "path_policy_violation",
    "message": "Node changed files outside allowedPaths and path policy mode is fail",
    "allowedPaths": ["services/orchestrator/src"]
  }
}
```

Timeout failure example:

```json
{
  "type": "node.failed",
  "runId": "run_123",
  "nodeId": "node_frontend",
  "timestamp": "2026-06-03T12:00:05.000Z",
  "payload": {
    "cli": "codex",
    "exitCode": null,
    "reason": "timeout",
    "timeoutMs": 600000
  }
}
```

Output limit failure example:

```json
{
  "type": "node.failed",
  "runId": "run_123",
  "nodeId": "node_frontend",
  "timestamp": "2026-06-03T12:00:05.000Z",
  "payload": {
    "cli": "codex",
    "exitCode": null,
    "reason": "output_limit_exceeded",
    "outputLimitReason": "stdout_limit_exceeded"
  }
}
```

### `node.skipped`

Emitted when the scheduler blocks a downstream execute node because an upstream flow-edge dependency failed.

```json
{
  "type": "node.skipped",
  "runId": "run_123",
  "nodeId": "node_docs",
  "timestamp": "2026-06-03T12:00:06.000Z",
  "payload": {
    "reason": "Dependency node_tests did not complete successfully",
    "upstreamNodeId": "node_tests"
  }
}
```

For blocked gates, the compatibility `node.skipped` payload also includes
`{ "kind": "gate", "blocked": true, "fanInMode": "all-of" | "any-of" }`.
Render this as a blocked Gate, not as an app error.

### `node.gate.evaluating`

```json
{
  "type": "node.gate.evaluating",
  "runId": "run_123",
  "nodeId": "gate_quality",
  "timestamp": "2026-06-03T12:00:06.100Z",
  "payload": {
    "kind": "gate",
    "fanInMode": "all-of",
    "upstreamTotal": 3
  }
}
```

### `node.gate.passed`

```json
{
  "type": "node.gate.passed",
  "runId": "run_123",
  "nodeId": "gate_quality",
  "timestamp": "2026-06-03T12:00:06.200Z",
  "payload": {
    "kind": "gate",
    "status": "passed",
    "fanInMode": "any-of",
    "upstreamTotal": 3,
    "upstreamSucceeded": 1,
    "upstreamFailed": 2,
    "upstreamSkipped": 0,
    "upstreamBlocked": 0,
    "reason": "gate satisfied (any-of: 1/3 upstream succeeded)",
    "evaluatedAt": "2026-06-03T12:00:06.200Z"
  }
}
```

### `node.gate.blocked`

```json
{
  "type": "node.gate.blocked",
  "runId": "run_123",
  "nodeId": "gate_quality",
  "timestamp": "2026-06-03T12:00:06.200Z",
  "payload": {
    "kind": "gate",
    "status": "blocked",
    "fanInMode": "all-of",
    "upstreamTotal": 3,
    "upstreamSucceeded": 1,
    "upstreamFailed": 1,
    "upstreamSkipped": 1,
    "upstreamBlocked": 0,
    "reason": "gate blocked (all-of: 1/3 upstream succeeded)",
    "evaluatedAt": "2026-06-03T12:00:06.200Z"
  }
}
```

### `node.loop.started`

```json
{
  "type": "node.loop.started",
  "runId": "run_123",
  "nodeId": "loop_retry",
  "timestamp": "2026-06-03T12:00:07.000Z",
  "payload": {
    "kind": "loop",
    "childGraphId": "graph_child",
    "maxIterations": 3,
    "breakCondition": "Stop when tests pass",
    "breakConditionEvaluated": false
  }
}
```

### `node.loop.iteration.completed`

```json
{
  "type": "node.loop.iteration.completed",
  "runId": "run_123",
  "nodeId": "loop_retry",
  "timestamp": "2026-06-03T12:00:12.000Z",
  "payload": {
    "iteration": 1,
    "maxIterations": 3,
    "childGraphId": "graph_child",
    "childRunId": "run_child_1",
    "childRunStatus": "failed",
    "breakReason": null
  }
}
```

### `node.loop.break`

```json
{
  "type": "node.loop.break",
  "runId": "run_123",
  "nodeId": "loop_retry",
  "timestamp": "2026-06-03T12:00:20.000Z",
  "payload": {
    "kind": "loop",
    "status": "completed",
    "childGraphId": "graph_child",
    "iterations": 2,
    "maxIterations": 3,
    "breakCondition": "Stop when tests pass",
    "breakConditionEvaluated": false,
    "breakReason": "child_run_success",
    "childRunIds": ["run_child_1", "run_child_2"],
    "finishedAt": "2026-06-03T12:00:20.000Z"
  }
}
```

### `node.loop.exhausted`

```json
{
  "type": "node.loop.exhausted",
  "runId": "run_123",
  "nodeId": "loop_retry",
  "timestamp": "2026-06-03T12:00:30.000Z",
  "payload": {
    "kind": "loop",
    "status": "exhausted",
    "childGraphId": "graph_child",
    "iterations": 3,
    "maxIterations": 3,
    "breakConditionEvaluated": false,
    "breakReason": "max_iterations_exhausted",
    "childRunIds": ["run_child_1", "run_child_2", "run_child_3"],
    "finishedAt": "2026-06-03T12:00:30.000Z"
  }
}
```

### `merge.preview.ready`

Current merge SSE envelope:

```json
{
  "ts": "2026-06-03T12:01:00.000Z",
  "level": "tool",
  "nodeId": "node_frontend",
  "payload": {
    "type": "merge.preview.ready",
    "status": "preview_ready",
    "targetBranch": "stephen-develop",
    "sourceBranch": "agent/run_123/node_frontend",
    "filesChanged": ["A\tORCH_FAKE_AGENT_EDIT.md"],
    "patchLength": 255,
    "warnings": []
  }
}
```

### `merge.completed`

```json
{
  "ts": "2026-06-03T12:02:00.000Z",
  "level": "tool",
  "nodeId": "node_frontend",
  "payload": {
    "type": "merge.completed",
    "status": "merged",
    "targetBranch": "stephen-develop",
    "sourceBranch": "agent/run_123/node_frontend",
    "mergeCommit": "abc1234",
    "message": "Merge completed in an isolated merge worktree."
  }
}
```

### `merge.conflicted`

```json
{
  "ts": "2026-06-03T12:02:00.000Z",
  "level": "error",
  "nodeId": "node_frontend",
  "payload": {
    "type": "merge.conflicted",
    "status": "conflicted",
    "targetBranch": "stephen-develop",
    "sourceBranch": "agent/run_123/node_frontend",
    "conflictFiles": ["README.md"],
    "message": "Merge conflicted. Inspect the preserved merge worktree."
  }
}
```

## UI State Mapping

Map by `event.type` or `event.payload.type`:

| Event | UI state |
| --- | --- |
| `node.queued` | `queued` |
| `node.starting` | `starting` |
| `node.running` | `running` |
| `node.completed` | `success` |
| `node.failed` | `failed` |
| `node.cancelled` | `cancelled` |
| `node.skipped` | `skipped` |
| `node.gate.evaluating` | `running` |
| `node.gate.passed` | `success` |
| `node.gate.blocked` | `blocked` |
| `node.loop.started` / `node.loop.iteration.started` | `running` |
| `node.loop.break` | `success` |
| `node.loop.exhausted` / `node.loop.failed` | `failed` |

Run-level:

| Event | Run state |
| --- | --- |
| `run.started` | `running` |
| `run.completed` | `completed` |
| `run.failed` | `failed` |
| `run.cancelled` | `cancelled` |

## Terminal Rendering Guidance

- Route every node-scoped event by `nodeId`.
- Append `node.stdout.payload.line` to that node terminal.
- Append `node.stderr.payload.line` to that node terminal with warning/error styling.
- Do not assume events arrive grouped; four nodes can interleave on the run stream.
- Use `node.worktree.created.payload.worktreePath` and `branchName` for the node header.
- Use `node.patch.payload.patchPreview` and `patchLength` for the patch tab.
- Use `node.output.payload.output` for parsed JSON output.
- On reload, hydrate from `RunModel.nodeRuns.<nodeId>.events` through `trpc.runs.getById.query({ runId })` if live SSE history is missed.

## Merge UI Procedures

All merge procedures are under `trpc.runtime.*` and are owner-scoped by run ownership.

```ts
const preview = await trpc.runtime.mergePreview.mutate({
  runId,
  nodeId,
  targetBranch: "stephen-develop",
  sourceBranch: "agent/run_123/node_frontend", // optional; server derives from nodeRun.branchName
  worktreePath: "/absolute/worktree/path", // optional; server derives from nodeRun.worktreePath
});

const applied = await trpc.runtime.mergeApply.mutate({
  runId,
  nodeId,
  targetBranch: "stephen-develop",
  strategy: "squash", // or "no-ff"
  commitMessage: `Merge ${nodeId} agent changes`,
});

const aborted = await trpc.runtime.mergeAbort.mutate({
  runId,
  nodeId,
  targetBranch: "stephen-develop",
  mergeWorktreePath,
});
```

## Phase 7.2 Promote Worktree Output MVP

For the wow-path MVP, "promote worktree output" means a user explicitly chooses
one completed child run node and asks the server to apply that node's agent
branch through the existing Merge Coordinator.

Promotion does not copy files manually. It does not batch merge, resolve
conflicts automatically, push to a remote, or create a GitHub PR.

Recommended UI flow:

1. User spawns a child graph with `trpc.graphs.spawnChild`.
2. User starts it with `trpc.runs.createAndStartChild` or the normal child graph
   run viewer.
3. User selects one completed child node.
4. Button label: `Promote worktree`.
5. UI should preview first with `trpc.runtime.mergePreview`.
6. After the user confirms, call `trpc.runtime.promoteNodeWorktree`.

Required payload:

```ts
const promoted = await trpc.runtime.promoteNodeWorktree.mutate({
  runId: childRunId,
  nodeId: completedChildNodeId,
  targetBranch: "stephen-develop",
  strategy: "squash", // or "no-ff"
  confirm: true,
  commitMessage: `Promote ${completedChildNodeId} worktree output`,
});
```

Expected statuses:

| Status | Meaning |
| --- | --- |
| `merged` | Merge Coordinator applied the node branch in a temporary merge worktree. |
| `conflicted` | Git reported conflicts; conflict files and merge worktree are preserved. |
| `failed` | The merge/promotion attempt failed before a clean merge result. |

Events:

- Promotion emits the existing merge lifecycle events: `merge.started`,
  `merge.completed`, `merge.conflicted`, or `merge.failed`.
- Promotion events include `payload.promotion: true`.
- The result is persisted under `RunModel.nodeRuns.<nodeId>.outputs.promotion`.

Fake-only wow-path smoke:

- Use `cli: "fake"` for the parent and child Execute nodes.
- Run parent graph, spawn child graph, start child run, preview one completed
  child node, then call `promoteNodeWorktree`.
- Confirm the main checkout is not directly modified with `git status --short`.
- Full manual checklist:
  `.claude/docs/test-guide/phase5-frontend-canvas.md#13-fake-only-wow-path-smoke-phase-72`.

Merge safety:

- Merge preview/apply/abort verifies `{ _id: runId, ownerId }`.
- Source branch and worktree are derived from the owned node run where possible.
- Apply uses a temporary merge worktree under `.orchestrator/merge-worktrees`.
- The main checkout is not merged directly.
- Nothing is pushed.
- Worktrees are preserved unless cleanup is explicitly requested.

## Storage Cleanup Procedures

Storage procedures are under `trpc.runtime.*` and are owner-scoped by run ownership.

```ts
const storage = await trpc.runtime.storageInspect.query({
  runId,
});

const cleaned = await trpc.runtime.cleanup.mutate({
  scope: "node", // or "run"
  runId,
  nodeId, // required for scope: "node"
  confirm: true,
  discardAgentChanges: true,
  discardMergeResults: true,
});
```

Cleanup safety:

- Server derives `rootRepoPath` from the owned run snapshot.
- Cleanup rejects active subprocesses.
- Cleanup deletes only derived `.orchestrator/worktrees`, `.orchestrator/merge-worktrees`, and `.orchestrator/tmp` paths.
- Cleanup deletes only matching `agent/<runId>/<nodeId>` and `merge/<runId>/<nodeId>/*` branches.
- Dirty agent edits require `discardAgentChanges: true`.
- Isolated merge results require `discardMergeResults: true`.
- The main checkout is not modified.

## Strict Post-Merge Cleanup Procedures

Use these procedures after a node's branch has already been merged/promoted and
the user wants to remove the local agent worktree/branch. This flow is stricter
than generic artifact discard cleanup. It is not automatic by default.

Backend procedures are ready for LA:

```ts
const preview = await trpc.runtime.cleanupMergedPreview.mutate({
  runId,
  nodeId,
  targetBranch: "main",
});

const cleaned = await trpc.runtime.cleanupMergedApply.mutate({
  runId,
  nodeId,
  targetBranch: "main",
  confirm: true,
});
```

Squash cleanup may require explicit local branch deletion because a squash commit
does not make `agent/<runId>/<nodeId>` an ancestor of the target branch:

```ts
const cleaned = await trpc.runtime.cleanupMergedApply.mutate({
  runId,
  nodeId,
  targetBranch: "main",
  confirm: true,
  forceBranchDelete: true,
});
```

To also discard non-conflicted isolated merge results:

```ts
const cleaned = await trpc.runtime.cleanupMergedApply.mutate({
  runId,
  nodeId,
  targetBranch: "main",
  confirm: true,
  discardMergeResults: true,
});
```

Preview request example for no-ff cleanup:

```json
{
  "runId": "run_123",
  "nodeId": "node_frontend",
  "targetBranch": "main"
}
```

Preview request example for squash cleanup:

```json
{
  "runId": "run_123",
  "nodeId": "node_frontend",
  "targetBranch": "main"
}
```

The server derives `rootRepoPath`, `sourceBranch`, `worktreePath`, node status,
and merge metadata from the owned `RunModel`. The client must not send `ownerId`.

Response examples:

```json
{
  "status": "preview_ready",
  "checks": [{ "name": "merge proof", "passed": true }],
  "runId": "run_123",
  "nodeId": "node_frontend",
  "targetBranch": "main",
  "sourceBranch": "agent/run_123/node_frontend",
  "worktreePath": "/repo/.orchestrator/worktrees/run_123/node_frontend",
  "wouldRemoveWorktree": true,
  "wouldDeleteBranch": true,
  "wouldRemoveMergeWorktrees": false,
  "warnings": [],
  "message": "Merged cleanup preview is ready. No Git state was modified."
}
```

```json
{
  "status": "cleaned",
  "checks": [{ "name": "merge proof", "passed": true }],
  "removedWorktree": true,
  "deletedBranch": true,
  "removedMergeWorktrees": [],
  "deletedMergeBranches": [],
  "warnings": [],
  "message": "Merged runtime artifacts were cleaned. The main checkout was not modified."
}
```

```json
{
  "status": "refused",
  "checks": [{ "name": "agent worktree clean", "passed": false }],
  "removedWorktree": false,
  "deletedBranch": false,
  "warnings": [],
  "message": "Merged cleanup apply refused because preview safety checks did not pass."
}
```

```json
{
  "status": "failed",
  "checks": [{ "name": "merge proof", "passed": true }],
  "removedWorktree": true,
  "deletedBranch": false,
  "warnings": [],
  "message": "git branch -d agent/run_123/node_frontend failed ..."
}
```

Safety rules:

- Cleanup is preview-first and confirm-to-apply.
- Cleanup only removes local agent branches/worktrees after merge verification.
- Cleanup never deletes remote branches.
- Cleanup never touches the main checkout directly.
- Cleanup never deletes unmerged branches.
- Cleanup never deletes active worktrees.
- Cleanup refuses dirty agent worktrees.
- Cleanup preserves conflicted merge worktrees.
- Merge worktrees are preserved unless `discardMergeResults: true`.
- `no-ff` proof uses `git merge-base --is-ancestor <sourceBranch> <targetBranch>`.
- `squash` proof requires successful Merge Coordinator metadata because Git ancestry is not enough.
- Generic `runtime.cleanup` is separate artifact-discard cleanup and should not be presented as strict merged cleanup.

Event mapping:

- `cleanup.preview.started`
- `cleanup.preview.ready`
- `cleanup.started`
- `cleanup.completed`
- `cleanup.refused`
- `cleanup.failed`

## Known Limitations

- Runtime scheduling is gated only by `flow` edges; `data`, `attaches-to`, and `loop` edges do not gate normal DAG order.
- Current active `runs.start` path enforces flow-edge dependency ordering with max concurrency 4 across supported runtime node kinds.
- Plan proposal apply updates the current graph for the next run; it does not mutate the already-created run snapshot or resume an in-flight scheduler.
- Gate fan-in mode is currently resolved from incoming flow edges, not from a node-level field.
- Loop `breakCondition` is not semantically evaluated yet; the MVP stopping rule is child run success/cancellation/failure or max iteration cap.
- `fake` is the stable deterministic demo path.
- `codex` is the first real CLI path, but local Codex config/model/auth can still fail and should be diagnosed through `trpc.runtime.cliCapabilities` and explicit `trpc.runtime.probeCodex`.
- `kiro` and `claude` are adapter-ready but not stable demo paths unless the corresponding CLI is installed and locally verified.
- Gemini is the recommended second CLI. The verified command shape is `gemini -p <prompt>`, but dashboard UI should still rely on `trpc.runtime.cliCapabilities` for the current machine's `available` and `verified` status.
- Phase 7.3 multi-CLI preparation is documented in `multi-cli-verification.md`; it is not complete until a Codex+Gemini runtime demo is recorded.
- No automatic merge of multiple agent branches.
- No remote push or GitHub PR creation from the runtime.

## Four Fake Nodes Graph JSON

Use this as the `nodes` / `edges` payload in `trpc.graphs.update`.

```json
{
  "nodes": [
    {
      "id": "node_frontend",
      "kind": "execute",
      "label": "Frontend fake task",
      "position": { "x": 0, "y": 0 },
      "status": "pending",
      "data": {
        "cli": "fake",
        "prompt": "Fake frontend task"
      }
    },
    {
      "id": "node_backend",
      "kind": "execute",
      "label": "Backend fake task",
      "position": { "x": 320, "y": 0 },
      "status": "pending",
      "data": {
        "cli": "fake",
        "prompt": "Fake backend task"
      }
    },
    {
      "id": "node_tests",
      "kind": "execute",
      "label": "Tests fake task",
      "position": { "x": 0, "y": 220 },
      "status": "pending",
      "data": {
        "cli": "fake",
        "prompt": "Fake tests task"
      }
    },
    {
      "id": "node_docs",
      "kind": "execute",
      "label": "Docs fake task",
      "position": { "x": 320, "y": 220 },
      "status": "pending",
      "data": {
        "cli": "fake",
        "prompt": "Fake docs task"
      }
    }
  ],
  "edges": []
}
```

Full create/update/start example:

```ts
const graph = await trpc.graphs.create.mutate({
  name: "Four fake agents",
  rootRepoPath: "/Users/macbook/Hack/ai-workflow-template",
  baseBranch: "stephen-develop",
});

await trpc.graphs.update.mutate({
  id: graph._id,
  nodes: fakeNodes,
  edges: [],
});

const run = await trpc.runs.create.mutate({ graphId: graph._id });
await trpc.runs.start.mutate({ runId: run._id });
const eventsUrl = `/api/runs/${run._id}/events`;
```

## One Codex Node Graph JSON

Use this only when Codex is installed and authenticated locally. Passive capability checks do not run prompts; the explicit probe may consume quota.

```json
{
  "nodes": [
    {
      "id": "node_codex_smoke",
      "kind": "execute",
      "label": "Codex smoke task",
      "position": { "x": 0, "y": 0 },
      "status": "pending",
      "data": {
        "cli": "codex",
        "prompt": "Create CODEX_RUNTIME_TEST.md in the current isolated worktree. Add a short note confirming this Codex runtime smoke test. Do not edit other files. At the end, print a valid <!-- orch:output --> JSON block with summary, filesChanged, and status fields."
      }
    }
  ],
  "edges": []
}
```

Recommended preflight:

```ts
const capabilities = await trpc.runtime.cliCapabilities.query();
// Optional user-click action only:
const probe = await trpc.runtime.probeCodex.mutate({
  cwd: "/Users/macbook/Hack/ai-workflow-template",
});
```
