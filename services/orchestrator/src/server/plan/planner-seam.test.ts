import { describe, expect, it } from "vitest";
import {
  PLANNER_AGENT_NAME,
  PLANNER_SENTINEL_OPEN,
  PLANNER_SENTINEL_CLOSE,
  buildPlannerAgentSystemPrompt,
} from "../runtime/planner-agent";
import { kiroAdapter } from "../runtime/cli-adapters/kiro";
import {
  PLAN_SENTINEL_OPEN,
  PLAN_SENTINEL_CLOSE,
  extractPlanJson,
} from "./planner-prompt";

/**
 * Integration seam (TRACK 4, `integration_reviewer`). The fix spans two layers
 * that must NOT import each other (runtime/ ⇄ plan/ would cycle), so this test
 * pins their shared contract from the OUTSIDE:
 *
 *   • The sentinel the AGENT system prompt (Track 1, runtime/) advertises must be
 *     byte-identical to the sentinel the PARSER (Track 2, plan/) extracts.
 *   • The agent NAME the provider passes must be the one the kiro adapter emits.
 *
 * If a future change drifts either literal, this test fails before the Local
 * planner silently stops parsing real kiro output.
 */
describe("planner seam: agent ⇄ parser sentinel equality", () => {
  it("runtime planner-agent sentinels equal plan planner-prompt sentinels", () => {
    expect(PLANNER_SENTINEL_OPEN).toBe(PLAN_SENTINEL_OPEN);
    expect(PLANNER_SENTINEL_CLOSE).toBe(PLAN_SENTINEL_CLOSE);
  });

  it("the agent system prompt advertises exactly the sentinel the parser extracts", () => {
    const prompt = buildPlannerAgentSystemPrompt();
    expect(prompt).toContain(PLAN_SENTINEL_OPEN);
    expect(prompt).toContain(PLAN_SENTINEL_CLOSE);

    // End-to-end: wrap a payload in the agent-advertised markers; the parser must
    // recover it unchanged.
    const payload = '{"type":"context_request"}';
    const modelOutput = `narration...\n${PLANNER_SENTINEL_OPEN}\n${payload}\n${PLANNER_SENTINEL_CLOSE}\n`;
    expect(extractPlanJson(modelOutput)).toBe(payload);
  });
});

describe("planner seam: adapter ⇄ planner agent name", () => {
  it("kiro adapter emits --agent=<PLANNER_AGENT_NAME> when the planner passes it", () => {
    const cmd = kiroAdapter.buildCommand({
      prompt: "the feature request only",
      nodeId: "architect",
      worktreePath: "/repo",
      agent: PLANNER_AGENT_NAME,
      trustTools: "fs_read",
    });
    expect(cmd.args).toContain(`--agent=${PLANNER_AGENT_NAME}`);
    // Read-only invariant holds at the seam too.
    expect(cmd.args).toContain("--trust-tools=fs_read");
    expect(cmd.args.join(" ")).not.toContain("fs_write");
  });
});
