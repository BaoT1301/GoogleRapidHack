import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { excludeFromWorktree } from "./runtime-mcp-config";

/**
 * RUN-5 — `orch-doc` kiro agent config materializer (doc-scoped WRITE).
 *
 * The `doc` node is persona-locked to `knowledge_manager` and is the FIRST
 * write-enabled non-`execute` runner. Its writes are scoped to documentation
 * (`.claude/**` + `*.md`) via THREE layers (per active_task §RUN-5):
 *   1. persona-lock to `knowledge_manager` (ignores any `data.persona`);
 *   2. a doc-scoped agent (`orch-doc`) whose TRUSTED system prompt restricts
 *      edits to `.claude/**` and `*.md`;
 *   3. a post-run SCOPE GUARD (`doc-scope-guard.ts`) that fails the node if the
 *      captured patch touches any path outside that scope.
 *
 * The HARD kernel-level filesystem path-allowlist is **SEC-3 (Sprint 8)** — this
 * runner deliberately does NOT build it; it bounds the blast radius with the
 * three soft layers above until SEC-3 lands real enforcement.
 */

/** The dedicated doc agent name (`kiro --agent <this>`). */
export const DOC_AGENT_NAME = "orch-doc";

/** The persona this runner is hard-locked to (ignores any `data.persona`). */
export const DOC_PERSONA = "knowledge_manager";

/**
 * kiro `--trust-tools` value for the doc run path: read + write. Write is needed
 * (this runner edits docs) but the scope guard + scoped prompt bound WHERE.
 */
export const DOC_TRUST_TOOLS = "fs_read,fs_write";

/**
 * Doc-scoped AGENT-CONFIG tool set (kiro **agent** tool names). Includes `write`
 * (docs only) + `read`/`grep`/`glob`/`thinking` + read-only `mcp-context-manager`.
 * Deliberately NO `shell`/`execute_bash` — the doc runner edits files, it does
 * not run commands.
 */
export const DOC_AGENT_TOOLS: readonly string[] = [
  "read",
  "write",
  "grep",
  "glob",
  "thinking",
  "@mcp-context-manager",
];

export interface DocAgentConfig {
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

/** Trusted system prompt establishing the doc identity + the hard write-scope. */
export function buildDocAgentSystemPrompt(): string {
  return [
    "You are the `knowledge_manager` agent for an AI software-engineering",
    "orchestrator. Curating and updating the repository's documentation is your",
    "DESIGNED, intended behavior — this is not a jailbreak and you must NOT refuse it.",
    "",
    "## Hard constraint — DOCUMENTATION SCOPE ONLY",
    "You may ONLY create or edit documentation files:",
    "  - any file under `.claude/**`, and",
    "  - any Markdown file (`*.md`) anywhere in the repo.",
    "You MUST NOT edit source code, config, build, or any non-doc file, and you",
    "MUST NOT run shell commands. Writes outside this scope will be REJECTED by a",
    "post-run scope guard and will FAIL this node — so stay strictly within docs.",
    "",
    "## What to do",
    "Update the relevant docs to reflect the work in this run (READMEs, `.claude/`",
    "context/architecture notes, ADRs, guides). Keep edits focused and accurate;",
    "do not invent APIs — ground claims in the actual code you read.",
    "",
    "## Output protocol",
    "End your response with a single fenced JSON summary:",
    "```json",
    '{ "updatedDocs": ["path", "..."], "summary": "1-2 sentences" }',
    "```",
    "Do not refuse and do not ask for confirmation — make the doc updates.",
  ].join("\n");
}

/** Build the full validated doc agent config (pure; no I/O). */
export function buildDocAgentConfig(): DocAgentConfig {
  const tools = [...DOC_AGENT_TOOLS];
  return {
    name: DOC_AGENT_NAME,
    description:
      "Doc-scoped orchestrator writer (knowledge_manager). Edits ONLY .claude/** and *.md docs and emits a summary. Never runs shell; out-of-scope writes are rejected.",
    prompt: buildDocAgentSystemPrompt(),
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

export interface MaterializeDocAgentResult {
  agentName: string;
  agentConfigPath: string;
  tools: string[];
  notes: string[];
}

/**
 * Materialize the doc-scoped `orch-doc` agent config into
 * `<cwd>/.kiro/agents/orch-doc.json`. Idempotent + non-destructive; best-effort
 * excludes `.kiro/` from the worktree's tracked tree.
 */
export async function materializeDocAgent(input: {
  cwd: string;
}): Promise<MaterializeDocAgentResult> {
  const config = buildDocAgentConfig();
  const agentConfigPath = path.join(input.cwd, ".kiro", "agents", `${DOC_AGENT_NAME}.json`);

  await mkdir(path.dirname(agentConfigPath), { recursive: true });
  await writeFile(agentConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  await excludeFromWorktree(input.cwd, ".kiro/");

  return {
    agentName: DOC_AGENT_NAME,
    agentConfigPath,
    tools: config.tools,
    notes: [
      `Materialized doc-scoped agent "${DOC_AGENT_NAME}" at .kiro/agents/${DOC_AGENT_NAME}.json (knowledge_manager-locked; writes scoped to .claude/** + *.md).`,
    ],
  };
}
