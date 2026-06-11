#!/usr/bin/env node
const { appendFile, mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

const nodeId = process.env.FAKE_AGENT_NODE_ID || "fake-node";
const delayMs = Number.parseInt(process.env.FAKE_AGENT_DELAY_MS || "250", 10);
const steps = Number.parseInt(process.env.FAKE_AGENT_STEPS || "0", 10);
// FAKE_AGENT_SHOULD_FAIL=true fails every node; FAKE_AGENT_FAIL_NODES="a,b"
// fails only the listed node ids (per-node failure for gate fan-in tests).
const failNodes = (process.env.FAKE_AGENT_FAIL_NODES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const shouldFail =
  process.env.FAKE_AGENT_SHOULD_FAIL === "true" || failNodes.includes(nodeId);
// FAKE_AGENT_PER_NODE_FILE=true writes a node-unique file (ORCH_FAKE_<nodeId>.md)
// instead of the shared ORCH_FAKE_AGENT_EDIT.md.
const perNodeFile = process.env.FAKE_AGENT_PER_NODE_FILE === "true";
// FAKE_AGENT_EDIT_FILE overrides the written file path entirely.
const editFileName =
  process.env.FAKE_AGENT_EDIT_FILE ||
  (perNodeFile ? `ORCH_FAKE_${nodeId}.md` : "ORCH_FAKE_AGENT_EDIT.md");
const editPath = path.join(process.cwd(), editFileName);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function log(message) {
  console.log(message);
  await sleep(delayMs);
}

async function main() {
  await log(`[fake-agent] starting node ${nodeId}`);
  await log(`[fake-agent] node ${nodeId} inspecting assigned worktree`);

  const promptFile = process.env.FAKE_AGENT_PROMPT_FILE;
  if (promptFile) {
    await writeFile(promptFile, process.env.FAKE_AGENT_PROMPT ?? "", "utf8");
  }

  console.error(`[fake-agent] node ${nodeId} warning: using deterministic fake implementation`);
  await sleep(delayMs);

  let attemptFail = false;
  const attemptFile = process.env.FAKE_AGENT_ATTEMPT_FILE;
  if (attemptFile) {
    let attempt = 0;
    try {
      attempt = Number.parseInt(await readFile(attemptFile, "utf8"), 10) || 0;
    } catch {
      attempt = 0;
    }
    attempt += 1;
    await writeFile(attemptFile, String(attempt), "utf8");
    const failTimes = Number.parseInt(process.env.FAKE_AGENT_FAIL_TIMES || "0", 10);
    attemptFail = attempt <= failTimes;
  }

  await mkdir(path.dirname(editPath), { recursive: true });
  const readOnly = process.env.FAKE_AGENT_READONLY === "true";
  if (!readOnly) {
    await appendFile(
      editPath,
      `\n## Fake agent edit\n\n- nodeId: ${nodeId}\n- timestamp: 2000-01-01T00:00:00.000Z\n`,
      "utf8"
    );
    await log(`[fake-agent] node ${nodeId} wrote ${editFileName}`);
  } else {
    await log(`[fake-agent] node ${nodeId} read-only - no files written`);
  }

  for (let step = 1; step <= steps; step += 1) {
    await log(`[fake-agent] node ${nodeId} long-running step ${step}/${steps}`);
  }

  if (shouldFail || attemptFail) {
    console.error(`[fake-agent] node ${nodeId} error: induced failure (shouldFail=${shouldFail} attemptFail=${attemptFail})`);
    process.exit(1);
  }

  await log(`[fake-agent] node ${nodeId} preparing structured output`);

  console.log(`<!-- orch:output -->
{
  "summary": "Fake agent ${nodeId} completed successfully",
  "filesChanged": ["${editFileName}"],
  "status": "ready_for_review"
}`);

  await log(`[fake-agent] node ${nodeId} completed successfully`);
}

main().catch((error) => {
  console.error("[fake-agent] unexpected error", error);
  process.exit(1);
});
