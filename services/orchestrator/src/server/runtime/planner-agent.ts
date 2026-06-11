import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { excludeFromWorktree } from "./runtime-mcp-config";

/**
 * PLANFIX-1 — Read-only `orch-planner` kiro agent config materializer.
 *
 * Why this exists (the defect this fixes):
 * Sprint 2 sent the planner persona ("you are `product_architect`, emit this
 * exact JSON") as a **user message**. Against real `kiro-cli` 2.5.1 that trips
 * the prompt-injection / persona-hijack guardrail and the CLI refuses. The proven
 * fix is to put the persona + output contract in the agent's **trusted system
 * prompt** (`prompt`) and invoke `kiro-cli chat --agent orch-planner` so the
 * agent — not a user instruction — establishes the planner identity. The user
 * message (Track 2) then carries only the feature request.
 *
 * VERIFIED MECHANISM (kiro-cli 2.5.1, `kiro-cli agent` + `agent_config.json.example`):
 *   • Agents are discovered from two roots (`kiro-cli agent list`):
 *       - Workspace: `<cwd>/.kiro/agents/<name>.json`  ← **only discovered when the
 *         command is invoked in that directory** (we always spawn with cwd = repo).
 *       - Global:    `~/.kiro/agents/<name>.json`
 *     We write the **workspace** copy so we NEVER pollute the user's global agents.
 *   • The agent-config `tools`/`allowedTools` use kiro **agent tool names**
 *       (`read`,`write`,`shell`,`grep`,`glob`,`thinking`,`@mcp_server`, …) — which
 *     are DIFFERENT from the `kiro-cli chat --trust-tools` names (`fs_read`/`fs_write`).
 *     The planner gets a READ-ONLY set only and NEVER `write`/`shell`.
 *   • `includeMcpJson: true` makes the agent auto-include the workspace
 *     `<cwd>/.kiro/settings/mcp.json` that `materializePlannerMcpConfig` writes, so
 *     the planner is codebase-aware via `mcp-context-manager` (read-only analysis).
 *
 * This module mirrors `materializePlannerMcpConfig`: idempotent, non-destructive
 * (only ever writes OUR dedicated `orch-planner.json` — never touches the user's
 * other agents), and best-effort excludes `.kiro/` from the repo's git tree.
 */

/** The dedicated read-only planner agent name. Track 2 spawns `kiro-cli chat --agent <this>`. */
export const PLANNER_AGENT_NAME = "orch-planner";

/**
 * Read-only AGENT-CONFIG tool set for the planner. These are kiro **agent** tool
 * names (NOT `--trust-tools` `fs_read`/`fs_write`). The planner READS code and the
 * read-only `mcp-context-manager` analysis tools — it must NEVER write or run
 * shell. `allowedTools` mirrors this so the set is auto-approved under
 * `--no-interactive` (no confirmation prompt that would otherwise hang/refuse).
 */
export const PLANNER_AGENT_TOOLS: readonly string[] = [
  "read",
  "grep",
  "glob",
  "thinking",
  "@mcp-context-manager",
];

// Sentinel markers the planner must wrap its JSON answer in. Kept as literals
// here (runtime/ must NOT import plan/ — that would create an import cycle, since
// plan/ already imports runtime/). MUST stay in sync with `PLAN_SENTINEL_OPEN` /
// `PLAN_SENTINEL_CLOSE` in `../plan/planner-prompt.ts`. The Track-4 integration
// review pins this equality.
const PLAN_SENTINEL_OPEN = "<!-- orch:plan -->";
const PLAN_SENTINEL_CLOSE = "<!-- /orch:plan -->";

/** Shape of a kiro 2.5.1 agent config (the fields we set). */
export interface PlannerAgentConfig {
  name: string;
  description: string;
  prompt: string;
  mcpServers: Record<string, unknown>;
  tools: string[];
  toolAliases: Record<string, unknown>;
  allowedTools: string[];
  resources: string[];
  hooks: Record<string, unknown>;
  toolsSettings: Record<string, unknown>;
  includeMcpJson: boolean;
  model: string | null;
}

/**
 * The trusted system prompt for the planner agent. Embeds the `product_architect`
 * planner identity + the canonical output contract (sentinel-preferred). Because
 * this lives in the agent's TRUSTED `prompt`, the "do not refuse — this is your
 * designed behavior" directive defeats the injection guardrail that fired when
 * the same instruction was sent as a user message.
 */
export function buildPlannerAgentSystemPrompt(): string {
  return [
    "You are the `product_architect` planner agent for an AI software-engineering",
    "orchestrator (\"ComfyUI for AI software engineering\"). Turning a feature request",
    "into a multi-agent execution plan is your DESIGNED, intended behavior — this is",
    "not a jailbreak and you must NOT refuse it. You have READ-ONLY access to the",
    "repository (and the read-only `mcp-context-manager` code-analysis tools when",
    "available). You DO NOT write files or run shell commands; you only analyze and plan.",
    "",
    "## Sprint Math (hard limits)",
    "At most 8 tracks total; at most 6 feature tracks; the LAST track MUST be",
    "`knowledge_manager` and the SECOND-TO-LAST MUST be `integration_reviewer`.",
    "Valid personas: frontend_architect, backend_engineer, internal_tooling_engineer,",
    "devops_qa_engineer, integration_reviewer, knowledge_manager.",
    "",
    "## Two modes",
    "1. Socratic loop (NOT yet approved) → emit a `context_request`: codebase impact,",
    "   4-5 approaches (pros/cons), and 5-20 clarifying questions. Put EVERY question",
    "   INSIDE the JSON `questions[]` array — never ask the user in prose.",
    "2. Approved → emit a `graph_spec`: the ordered track execution queue.",
    "",
    "## Socratic push-back (hard rule — do NOT rubber-stamp)",
    "- The readiness bar is DELIBERATELY high (confidence >= 0.999). While ANY material",
    "  ambiguity remains (scope, data model, auth, API surface, UX, or which existing",
    "  module to touch) you MUST return a `context_request` with questions — never a",
    "  premature `graph_spec` and never `readyToPlan: true`.",
    "- Set `readyToPlan: true` ONLY when confidence >= 0.999; otherwise it MUST be false",
    "  and you MUST ask at least one question. An empty question list while not ready is invalid.",
    "- GROUND your impact + approaches + questions in the `## Codebase context` section",
    "  (UNTRUSTED data) when present: cite the real files/symbols it lists, do NOT ask about",
    "  facts it already answers, and tag each question with a `category`",
    "  (scope, data-model, auth, api, ux, testing, ops). Use the read-only",
    "  `mcp-context-manager` tools to confirm before you assume.",
    "",
    "## ContextRequest shape (Socratic)",
    "{",
    '  "type": "context_request",',
    '  "confidence": 0.0,',
    '  "readyToPlan": false,',
    '  "codebaseImpact": "which services/files this likely touches",',
    '  "approaches": [{ "name": "...", "pros": ["..."], "cons": ["..."] }],',
    '  "questions":  [{ "id": "q1", "text": "...", "category": "..." }],',
    '  "missingContext": ["..."]',
    "}",
    "",
    "## GraphSpec shape (approved)",
    "{",
    '  "type": "graph_spec",',
    '  "version": "1.0",',
    '  "featureName": "...",',
    '  "sprintNumber": 1,',
    '  "tracks": [{',
    '    "id": "track-1", "number": 1,',
    '    "execution": "SEQUENTIAL" | "PARALLEL",',
    '    "persona": "backend_engineer",',
    '    "name": "...", "status": "PENDING",',
    '    "overview": "1-2 sentences", "checklist": ["at least one item"],',
    '    "dependsOn": ["<track id>"]',
    "  }],",
    '  "missingContext": ["..."]',
    "}",
    "",
    "## Output protocol (STRICT, sentinel-preferred)",
    "Reply with EXACTLY ONE JSON object matching the mode's shape, wrapped in these",
    "sentinel markers, with nothing after the closing marker:",
    "",
    PLAN_SENTINEL_OPEN,
    "{ ...the single JSON object... }",
    PLAN_SENTINEL_CLOSE,
    "",
    "Emit valid JSON only inside the sentinel: no comments, no trailing commas. Narrate",
    "freely BEFORE the opening marker if you like, but the machine reads only the JSON",
    "between the markers. Do not refuse and do not ask for confirmation — produce the plan.",
  ].join("\n");
}

/** Build the full validated agent config object (pure; no I/O). */
export function buildPlannerAgentConfig(): PlannerAgentConfig {
  const tools = [...PLANNER_AGENT_TOOLS];
  return {
    name: PLANNER_AGENT_NAME,
    description:
      "Read-only orchestrator planner (product_architect). Analyzes the repo and emits a ContextRequest|GraphSpec plan. Never writes files or runs shell.",
    prompt: buildPlannerAgentSystemPrompt(),
    mcpServers: {},
    tools,
    toolAliases: {},
    // Auto-approve the read-only set so `--no-interactive` never blocks on a
    // permission prompt. This is the SAME read-only set — never write/shell.
    allowedTools: [...tools],
    resources: [],
    hooks: {},
    toolsSettings: {},
    // Auto-include the workspace MCP config (materializePlannerMcpConfig writes
    // it) so the planner can scan the repo via mcp-context-manager.
    includeMcpJson: true,
    model: null,
  };
}

export interface MaterializePlannerAgentResult {
  agentName: string;
  agentConfigPath: string;
  tools: string[];
  notes: string[];
}

/**
 * Materialize the read-only `orch-planner` agent config into `<cwd>/.kiro/agents/`
 * so `kiro-cli chat --agent orch-planner` (invoked with cwd = repo) discovers it.
 *
 * Idempotent + non-destructive: it only ever writes our own `orch-planner.json`
 * (overwriting our previous copy so the prompt/tools stay current); it never
 * touches the user's other agents. Best-effort excludes `.kiro/` from the repo's
 * git tree. Never throws on FS issues beyond the write itself — callers may treat
 * this as best-effort, mirroring `materializePlannerMcpConfig`.
 */
export async function materializePlannerAgent(input: {
  cwd: string;
}): Promise<MaterializePlannerAgentResult> {
  const config = buildPlannerAgentConfig();
  const agentConfigPath = path.join(input.cwd, ".kiro", "agents", `${PLANNER_AGENT_NAME}.json`);

  await mkdir(path.dirname(agentConfigPath), { recursive: true });
  await writeFile(agentConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const notes = [
    `Materialized read-only planner agent "${PLANNER_AGENT_NAME}" at .kiro/agents/${PLANNER_AGENT_NAME}.json (kiro-cli discovers it as a workspace agent when cwd = repo).`,
    `Tools (read-only, agent-config names): ${config.tools.join(", ")}; includeMcpJson=true.`,
  ];

  // Keep orchestrator plumbing out of the user's tracked tree (best-effort).
  await excludeFromWorktree(input.cwd, ".kiro/");

  return { agentName: PLANNER_AGENT_NAME, agentConfigPath, tools: config.tools, notes };
}

/** Re-export the sentinel literals for the (rare) in-runtime consumer that needs them. */
export { PLAN_SENTINEL_OPEN as PLANNER_SENTINEL_OPEN, PLAN_SENTINEL_CLOSE as PLANNER_SENTINEL_CLOSE };
