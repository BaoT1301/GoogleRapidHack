import type { CliAdapter } from "./types";
import { normalizeModelId } from "./types";

export const claudeAdapter: CliAdapter = {
  name: "claude",
  buildCommand(input) {
    if (!input.worktreePath || typeof input.worktreePath !== "string") {
      throw new Error("worktreePath is required and must be a string");
    }
    if (typeof input.prompt !== "string" || !input.prompt.trim()) {
      throw new Error("prompt is required and must be a non-empty string");
    }

    // Claude Code supports print-style execution in common local installs.
    // Capability preflight marks this unavailable when `claude --version` fails.
    // MODEL-1: pin the resolved model before the prompt when provided.
    const model = normalizeModelId(input.model);
    return {
      command: "claude",
      args: [
        "--print",
        ...(model ? ["--model", model] : []),
        input.prompt,
      ],
      cwd: input.worktreePath
    };
  }
};
