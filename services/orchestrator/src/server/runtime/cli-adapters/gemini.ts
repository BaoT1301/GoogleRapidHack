import type { CliAdapter } from "./types";
import { normalizeModelId } from "./types";

export const geminiAdapter: CliAdapter = {
  name: "gemini",
  buildCommand(input) {
    // Verified locally with Gemini CLI 0.45.1 help output:
    // `gemini -p <prompt>` runs non-interactively/headlessly.
    // Do not add --yolo, trust-all, or broad auto-approval flags here.
    // MODEL-1: pin the resolved model via `-m` when provided.
    const model = normalizeModelId(input.model);
    return {
      command: "gemini",
      args: [
        ...(model ? ["-m", model] : []),
        "-p",
        input.prompt,
      ],
      cwd: input.worktreePath
    };
  }
};
