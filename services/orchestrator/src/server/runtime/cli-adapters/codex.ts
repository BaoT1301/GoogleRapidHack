import type { CliAdapter } from "./types";
import { normalizeModelId } from "./types";

// First real adapter target. Codex is expected to run from the local user's
// installed CLI and existing auth/config; no API keys are injected here.
export const codexAdapter: CliAdapter = {
  name: "codex",
  buildCommand(input) {
    const prompt = buildCodexPrompt(
      input.prompt,
      input.nodeId,
      input.allowedPaths,
      input.pathPolicyMode,
    );

    const model = normalizeModelId(input.model);
    const args = [
      "exec",
      "--sandbox",
      "workspace-write",
      "--cd",
      input.worktreePath,
      // MODEL-1: pin the resolved model after the fixed prefix and before the
      // prompt; omitted → codex uses its own configured default.
      ...(model ? ["-m", model] : []),
      prompt,
    ];

    return {
      command: "codex",
      args,
      cwd: input.worktreePath
    };
  }
};

function buildCodexPrompt(
  userPrompt: string,
  nodeId: string,
  allowedPaths: string[] | undefined,
  pathPolicyMode: "warn" | "fail" | undefined,
): string {
  const allowedPathInstruction = allowedPaths && allowedPaths.length > 0
    ? `\nAllowed path policy:\n- Only change files under these repo-relative path prefixes: ${allowedPaths.join(", ")}.\n- Policy mode: ${pathPolicyMode ?? "warn"}.\n- The runtime will inspect changed files after you exit; this prompt is only a hint, not the enforcement mechanism.\n`
    : "\nAllowed path policy:\n- No runtime path allowlist was provided for this node.\n";

  return `You are running inside an isolated git worktree managed by the CLI Sub-Agent Runtime.

Runtime safety rules:
- Only modify files necessary for this task.
- Do not modify files outside the current working directory.
- The runtime starts Codex with a workspace-write sandbox scoped to this isolated worktree.
- Do not run destructive commands.
- Do not bypass approvals, sandboxing, or local safety controls.
- Keep changes scoped and easy to review.
- Runtime node id: ${nodeId}.
- Parallel agents may merge back into the same target branch. Unless the user explicitly names a shared file, avoid editing broad/shared files that other nodes are likely to touch; prefer node-specific output paths such as agent-output/${nodeId}/... for temporary demo artifacts.
- At the end, print a valid structured output block exactly in this form:
${allowedPathInstruction}

<!-- orch:output -->
{
  "summary": "Brief summary of what you changed",
  "filesChanged": ["relative/path.ext"],
  "status": "ready_for_review"
}

User/node prompt:
${userPrompt}`;
}
