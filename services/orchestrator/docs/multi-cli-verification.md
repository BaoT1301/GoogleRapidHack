# Multi-CLI Verification Plan

This document prepares the Phase 7.3 multi-CLI demo path for the monolith runtime in `services/orchestrator`.

Current local status:

| CLI | Status | Notes |
| --- | --- | --- |
| fake | Stable | Deterministic local adapter for runtime smoke tests. |
| codex | Stable local demo path | Installed locally and supported through `codex exec --sandbox workspace-write`. |
| gemini | Verified local second CLI path | Installed locally as Gemini CLI `0.45.1`; verified command shape is `gemini -p <prompt>` for non-interactive/headless execution. |
| kiro-cli | Optional, currently missing locally | Keep experimental unless installed, authenticated, and locally verified. |
| claude | Optional, currently missing locally | Keep unverified unless installed and locally verified. |

## Recommended Second CLI

Use Gemini as the second real CLI for the multi-CLI demo after Codex.

Reasoning:

- The runtime already has a passive capability check for `gemini --version`.
- The Gemini adapter is present and uses the locally verified non-interactive command shape.
- Gemini gives the demo a second independent CLI without changing fake or Codex behavior.

Do not install Gemini automatically from the runtime or tests. Installation and authentication should be a manual developer setup step.

Phase 7.3 remains in progress until the team records a full Codex + Gemini runtime demo. The Gemini CLI command path is now locally verified, but CI and normal tests must still avoid real Gemini prompts.

## Manual Install And Auth Checklist

Use the team-approved Gemini CLI installation method, then verify from the same shell used to start `services/orchestrator`:

```bash
which gemini
gemini --version
gemini --help
```

Authentication checklist:

- Confirm the team-approved Gemini auth method.
- Do not place API keys in graph JSON.
- Do not commit `.env`, `.env.orchestrator`, shell history, or generated credential files.
- If Gemini needs an API key, store it through the monolith vault and reference it by secret ID only.
- Confirm `trpc.runtime.cliCapabilities.query()` reports Gemini accurately before running a graph.

Vault checklist if `GEMINI_API_KEY` is required:

1. Add the key through the app's Secrets/Vault UI or the existing `trpc.secrets.create` flow.
2. Name/label it clearly, for example `Gemini API key`.
3. Use only the returned secret ID in graph node data, for example `data.secretRefs.gemini = "<secret_id>"`.
4. Never paste the raw key into graph JSON, prompts, docs, terminal commands, or screenshots.
5. The runtime maps Gemini secret refs to `GEMINI_API_KEY` server-side and redacts injected values before SSE/Mongo persistence.

## Verify Non-Interactive Prompt Mode

First test prompt-only mode in a temporary git repo. This should not edit files.

```bash
TMP_REPO="$(mktemp -d /tmp/agent-loom-gemini-check.XXXXXX)"
cd "$TMP_REPO"
git init
printf '# Gemini check\n' > README.md
git add README.md
git commit -m "init"

gemini -p 'Reply with exactly AGENT_LOOM_GEMINI_OK and do not edit files.'
```

The locally verified command shape from `gemini --help` is:

```bash
gemini -p '<prompt>'
```

Do not add broad permission flags such as `--yolo`, `--skip-trust`, `--approval-mode yolo`, `--approval-mode auto_edit`, or broad `--allowed-tools`.

Then test an edit in the temp repo only:

```bash
gemini -p 'Create GEMINI_RUNTIME_TEST.md with one sentence confirming the Gemini runtime test. Do not edit other files.'
git status --short
git diff -- GEMINI_RUNTIME_TEST.md
```

Expected result:

- Gemini exits with code `0`.
- The process does not wait for interactive input.
- The only changed file is `GEMINI_RUNTIME_TEST.md`.
- No broad permission or trust-all flags were used.

## Gemini Verified Status

Local command verification has passed:

- `which gemini` resolved to the user npm global install.
- `gemini --version` returned `0.45.1`.
- `gemini --help` documents `-p, --prompt` as non-interactive/headless mode.
- The adapter uses `gemini -p <prompt>` and always runs with `cwd` set to the isolated worktree.
- Tests inspect command construction only and do not require real Gemini.

Remaining before calling Phase 7.3 complete: record the actual multi-CLI runtime demo with Codex and Gemini nodes completing in separate worktrees.

## Capabilities Check

The dashboard should call:

```ts
const capabilities = await trpc.runtime.cliCapabilities.query();
```

For Gemini, display:

```ts
capabilities.gemini.available
capabilities.gemini.version
capabilities.gemini.experimental
capabilities.gemini.verified
capabilities.gemini.note
capabilities.gemini.suggestedFix
```

Passive capability checks must not invoke Gemini prompts or consume model quota.

Expected missing-Gemini capability shape on machines without the CLI:

```json
{
  "available": false,
  "command": "gemini",
  "experimental": true,
  "verified": false,
  "note": "Gemini CLI not found. Install and authenticate Gemini CLI before using it as the second real CLI demo path.",
  "suggestedFix": "Install Gemini CLI, verify `gemini --version` and non-interactive prompt mode, or switch this node to fake"
}
```

Expected installed-Gemini capability shape after local verification:

```json
{
  "available": true,
  "command": "gemini",
  "version": "0.45.1",
  "verified": true,
  "requiresApiKey": true,
  "note": "Gemini CLI is installed. Verified command shape: `gemini -p <prompt>` for non-interactive/headless execution. If API-key auth is required, pass a vault secret ref so the runtime injects GEMINI_API_KEY server-side."
}
```

## Demo Graph: `multi_cli_codex_gemini`

The monolith includes a dev-only seed graph:

```ts
await trpc.runtime.seedDemoGraph.mutate({
  demoGraphId: "multi_cli_codex_gemini",
  rootRepoPath: "/Users/macbook/Hack/ai-workflow-template",
  baseBranch: "stephen-develop",
});
```

Nodes:

| Node | CLI | File written | Notes |
| --- | --- | --- | --- |
| `node_codex` | `codex` | `CODEX_MULTI_CLI_RUNTIME_TEST.md` | Real Codex lane. |
| `node_gemini` | `gemini` | `GEMINI_MULTI_CLI_RUNTIME_TEST.md` | Real Gemini lane. |
| `node_fake_fallback` | `fake` | `ORCH_FAKE_AGENT_EDIT.md` | Deterministic fallback lane. |

The graph has no flow edges, so all nodes are independent and can start in parallel up to the runtime max concurrency of 4.

Each real CLI prompt asks for a valid `<!-- orch:output -->` JSON block with `summary`, `filesChanged`, and `status`.

The two real CLI lanes write different filenames to avoid overlapping file conflicts. Each node also runs in its own isolated worktree under `.orchestrator/worktrees/<runId>/<nodeId>`.

## Phase 7.3 Checklist

This is the intended Phase 7.3 graph definition. Only run the Gemini node when `capabilities.gemini.available === true` and `capabilities.gemini.verified === true`.

- Confirm Codex capability is available: `capabilities.codex.available === true`.
- Confirm Gemini capability is available and verified: `capabilities.gemini.available === true && capabilities.gemini.verified === true`.
- Seed or load `multi_cli_codex_gemini`.
- Start the run from the saved graph.
- Confirm `node_codex` and `node_gemini` both transition through queued/starting/running without a flow dependency blocking either node.
- Confirm unique worktrees are created for `node_codex`, `node_gemini`, and `node_fake_fallback`.
- Confirm terminal logs interleave over SSE by `nodeId`.
- Confirm `node.patch` is captured for both real CLI nodes.
- Confirm `node.output` parses the `<!-- orch:output -->` JSON for both real CLI nodes.
- Confirm the main checkout remains clean after the run.
- Record the runId/screenshots/logs before marking 7.3 complete.

Status rule: 7.3 is complete only after Codex and Gemini actually run successfully in parallel and produce separate worktree patches. Until then, keep it partial with the blocker noted.

Docs-only fallback placeholder for machines where Gemini is missing:

```json
{
  "name": "Multi-CLI placeholder",
  "description": "Codex and fake can run now. Gemini is the planned second real CLI but should only run on machines where capabilities report it available and verified.",
  "nodes": [
    { "id": "node_codex_check", "kind": "execute", "label": "Codex check", "data": { "cli": "codex", "prompt": "Create CODEX_RUNTIME_TEST.md and emit orch output." } },
    { "id": "node_fake_fallback", "kind": "execute", "label": "Fake fallback", "data": { "cli": "fake", "prompt": "Run the deterministic fake fallback." } },
    { "id": "node_gemini_planned", "kind": "execute", "label": "Gemini planned", "data": { "cli": "gemini", "prompt": "Run only after Gemini capability is available and verified." } }
  ],
  "edges": []
}
```

The placeholder is for LA/team planning only. Do not start the Gemini node on machines where capabilities do not report verified support.

## Optional Gemini Smoke

This is manual only. Do not add it to CI.

```bash
TMP_REPO="$(mktemp -d /tmp/agent-loom-gemini-smoke.XXXXXX)"
cd "$TMP_REPO"
git init
git config user.email "test@example.com"
git config user.name "Agent Loom Test"
printf '# Gemini smoke\n' > README.md
git add README.md
git commit -m "init"

gemini -p 'Create GEMINI_RUNTIME_TEST.md with one sentence confirming the Gemini runtime test. Do not edit other files. End with a valid <!-- orch:output --> JSON block with summary, filesChanged, and status.'

git status --short
git diff -- GEMINI_RUNTIME_TEST.md
```

Expected: only `GEMINI_RUNTIME_TEST.md` is changed in the temp repo.

Expected runtime behavior:

- Three subprocesses run in separate worktrees under `.orchestrator/worktrees/<runId>/<nodeId>`.
- Terminal events are keyed by `nodeId` and may interleave.
- Codex and Gemini outputs should include parsed `<!-- orch:output -->` JSON if the CLIs follow the prompt.
- The main checkout should remain unchanged.

## Safety Rules

- Do not use broad permission flags such as trust-all, yolo, danger-full-access, or sandbox bypass.
- Do not store secrets in graph JSON.
- Use vault secret references if a CLI needs an API key.
- Do not expose secret values through SSE, persisted events, UI cards, or docs.
- Do not make CI or normal tests depend on Gemini, Kiro, Claude, or authenticated AI CLIs.
- Keep Kiro and Claude optional until installed and locally verified.

## Troubleshooting

- `gemini: command not found`: install the Gemini CLI manually, then restart the monolith process.
- Capability still says missing: verify `which gemini` from the same shell that runs `npm run dev`.
- Prompt hangs: the selected Gemini command is interactive; inspect `gemini --help` and find the documented non-interactive flag.
- File edits do not happen: verify the CLI has write permission in the temp repo and no read-only/sandbox mode is blocking writes.
- Secrets needed: use vault-backed secret references instead of graph JSON or committed env files.
