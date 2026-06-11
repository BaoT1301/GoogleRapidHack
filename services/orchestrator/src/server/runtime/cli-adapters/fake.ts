import path from "node:path";
import type { CliAdapter } from "./types";

// fake-agent.js is staged under service-root scripts/ for local dev and
// standalone builds. FAKE_AGENT_PATH remains available for tests.
const fakeAgentPath =
  process.env.FAKE_AGENT_PATH ??
  path.resolve(process.cwd(), "scripts", "fake-agent.js");
const nodeLikeExecutable = process.execPath;

// Deterministic test adapter. This is the safe path for runtime tests before
// invoking real AI CLIs that may need auth, network access, or user config.
export const fakeAdapter: CliAdapter = {
  name: "fake",
  buildCommand(input) {
    return {
      command: nodeLikeExecutable,
      args: [fakeAgentPath],
      cwd: input.worktreePath,
      env: {
        FAKE_AGENT_NODE_ID: input.nodeId,
        FAKE_AGENT_DELAY_MS: process.env.FAKE_AGENT_DELAY_MS,
        FAKE_AGENT_STEPS: process.env.FAKE_AGENT_STEPS,
        FAKE_AGENT_SHOULD_FAIL: process.env.FAKE_AGENT_SHOULD_FAIL,
        FAKE_AGENT_FAIL_NODES: process.env.FAKE_AGENT_FAIL_NODES,
        FAKE_AGENT_PER_NODE_FILE: process.env.FAKE_AGENT_PER_NODE_FILE,
        // Test plumbing: override the file the fake agent writes (RUN-5 doc-scope
        // guard tests use a non-doc path to prove out-of-scope writes are rejected).
        FAKE_AGENT_EDIT_FILE: process.env.FAKE_AGENT_EDIT_FILE,
        // Test plumbing (SEC-3): FAKE_AGENT_READONLY=true models a read-only agent
        // (writes nothing → empty patch) so the review read-only assertion passes.
        FAKE_AGENT_READONLY: process.env.FAKE_AGENT_READONLY,
        // Test plumbing (RUN-6 loop): a shared attempt counter file + fail-N-times
        // so a child sub-graph can fail the first N iterations then pass.
        FAKE_AGENT_ATTEMPT_FILE: process.env.FAKE_AGENT_ATTEMPT_FILE,
        FAKE_AGENT_FAIL_TIMES: process.env.FAKE_AGENT_FAIL_TIMES,
        // Test plumbing: forward the resolved prompt so the fake agent can echo it
        // when FAKE_AGENT_PROMPT_FILE is set (RUN-7 prompt-materialization tests).
        // No effect on default behavior.
        FAKE_AGENT_PROMPT_FILE: process.env.FAKE_AGENT_PROMPT_FILE,
        // MODEL-1: forward the resolved model so tests can assert per-node model
        // routing without invoking a real CLI. No effect on default behavior.
        FAKE_AGENT_MODEL: input.model,
        FAKE_AGENT_PROMPT: input.prompt
      }
    };
  }
};
