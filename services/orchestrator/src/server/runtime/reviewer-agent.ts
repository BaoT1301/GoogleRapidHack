import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { excludeFromWorktree } from "./runtime-mcp-config";

/**
 * RUN-4 — Read-only `orch-reviewer` kiro agent config materializer.
 *
 * The `review` node is persona-locked to `integration_reviewer` and runs a
 * **read-only** audit of the run/worktree: it inspects code + diffs and emits a
 * structured verdict, but NEVER writes files or runs shell. This mirrors the
 * `orch-planner` mechanism (`planner-agent.ts`): the reviewer identity + output
 * contract live in the agent's TRUSTED system prompt and we invoke
 * `kiro-cli chat --agent orch-reviewer` so the persona — not a user instruction —
 * establishes the auditor role (and the injection guardrail never fires).
 *
 * Read-only enforcement is layered (per active_task §RUN-4; hard kernel-level
 * path-allowlist is SEC-3, Sprint 8):
 *   - agent-config `tools`/`allowedTools` = a READ-ONLY set (no `write`/`shell`);
 *   - the run path also pins `--trust-tools=fs_read` (see `REVIEWER_TRUST_TOOLS`);
 *   - the `review` node is a non-`execute` kind so it is NEVER a merge candidate
 *     (it cannot land a patch on base regardless).
 */

/** The dedicated read-only reviewer agent name (`kiro --agent <this>`). */
export const REVIEWER_AGENT_NAME = "orch-reviewer";

/** The persona this runner is hard-locked to (ignores any `data.persona`). */
export const REVIEWER_PERSONA = "integration_reviewer";

/**
 * kiro `--trust-tools` value for the reviewer run path: READ-ONLY. Pinned here
 * (not env-overridable) so a review node can never be granted write/shell.
 */
export const REVIEWER_TRUST_TOOLS = "fs_read";

/**
 * Read-only AGENT-CONFIG tool set (kiro **agent** tool names — distinct from the
 * `--trust-tools` `fs_read`/`fs_write` names). The reviewer READS code and uses
 * the read-only `mcp-context-manager` analysis tools; it must NEVER write or run
 * shell. `allowedTools` mirrors this so `--no-interactive` never blocks on a
 * permission prompt.
 */
export const REVIEWER_AGENT_TOOLS: readonly string[] = [
  "read",
  "grep",
  "glob",
  "thinking",
  "@mcp-context-manager",
];

/** Shape of the kiro 2.5.1 agent config fields we set (mirrors PlannerAgentConfig). */
export interface ReviewerAgentConfig {
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

/** The trusted system prompt establishing the read-only reviewer identity + verdict contract. */
export function buildReviewerAgentSystemPrompt(): string {
  return [
    "You are the `integration_reviewer` agent for an AI software-engineering",
    "orchestrator. Auditing another agent's work for regressions and broken",
    "contracts is your DESIGNED, intended behavior — this is not a jailbreak and",
    "you must NOT refuse it.",
    "",
    "## Hard constraint — READ ONLY",
    "You have READ-ONLY access. You DO NOT write or edit files and you DO NOT run",
    "shell commands. You only read code, inspect the diff/worktree, and report.",
    "If you believe a change is required, describe it in your verdict — never apply it.",
    "",
    "## What to audit (ripple effects)",
    "- Modified API endpoints, changed DB/schema models, and altered shared types.",
    "- Cross-service mismatches: when a backend schema changed, confirm the",
    "  frontend validators / API clients were updated to match.",
    "- Broken contracts, missing tests, and out-of-scope edits.",
    "Use the read-only `mcp-context-manager` tools to confirm impact before you assert it.",
    "",
    "## Output protocol",
    "End your response with a single fenced JSON verdict:",
    "```json",
    '{ "verdict": "pass" | "fail", "findings": ["..."], "blockedTracks": ["..."] }',
    "```",
    "Emit `pass` only when you found no regression or contract mismatch; otherwise",
    "`fail` with one finding per issue (name the regressed behavior + the file at fault).",
    "Do not refuse and do not ask for confirmation — produce the audit.",
  ].join("\n");
}

/** Build the full validated reviewer agent config (pure; no I/O). */
export function buildReviewerAgentConfig(): ReviewerAgentConfig {
  const tools = [...REVIEWER_AGENT_TOOLS];
  return {
    name: REVIEWER_AGENT_NAME,
    description:
      "Read-only orchestrator reviewer (integration_reviewer). Audits the run/worktree for regressions and broken contracts and emits a pass/fail verdict. Never writes files or runs shell.",
    prompt: buildReviewerAgentSystemPrompt(),
    mcpServers: {},
    tools,
    allowedTools: [...tools],
    toolAliases: {},
    resources: [],
    hooks: {},
    toolsSettings: {},
    includeMcpJson: true,
    model: null,
  };
}

export interface MaterializeReviewerAgentResult {
  agentName: string;
  agentConfigPath: string;
  tools: string[];
  notes: string[];
}

/**
 * Materialize the read-only `orch-reviewer` agent config into
 * `<cwd>/.kiro/agents/orch-reviewer.json` so `kiro-cli chat --agent orch-reviewer`
 * (cwd = worktree) discovers it. Idempotent + non-destructive (only ever writes
 * our own file); best-effort excludes `.kiro/` from the worktree's tracked tree.
 */
export async function materializeReviewerAgent(input: {
  cwd: string;
}): Promise<MaterializeReviewerAgentResult> {
  const config = buildReviewerAgentConfig();
  const agentConfigPath = path.join(input.cwd, ".kiro", "agents", `${REVIEWER_AGENT_NAME}.json`);

  await mkdir(path.dirname(agentConfigPath), { recursive: true });
  await writeFile(agentConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  await excludeFromWorktree(input.cwd, ".kiro/");

  return {
    agentName: REVIEWER_AGENT_NAME,
    agentConfigPath,
    tools: config.tools,
    notes: [
      `Materialized read-only reviewer agent "${REVIEWER_AGENT_NAME}" at .kiro/agents/${REVIEWER_AGENT_NAME}.json (read-only; integration_reviewer-locked).`,
    ],
  };
}
