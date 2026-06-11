import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { checkCliCapability } from "./cli-capabilities";
import { ExecuteRunner } from "./execute-runner";
import { InMemoryRunRepository } from "./run-repository";

const execFileAsync = promisify(execFile);
const SMOKE_TIMEOUT_MS = 180_000;
const SMOKE_SECRET_VALUE = "sk-smokeSecretShouldNotLeak123456789";

describe("Codex monolith runtime smoke", () => {
  it(
    "runs Codex inside an isolated worktree or reports an actionable local setup failure",
    async () => {
      const codex = await checkCliCapability("codex");
      if (!codex.available) {
        console.warn(`[codex-smoke] skipped: ${codex.note ?? "Codex CLI not available"}`);
        console.warn(`[codex-smoke] suggested fix: ${codex.suggestedFix ?? "Install Codex CLI"}`);
        return;
      }

      const rootRepoPath = await createTempGitRepo();
      const repository = new InMemoryRunRepository();
      const runner = new ExecuteRunner(undefined, undefined, repository);
      const runId = `run_codex_smoke_${Date.now()}`;
      const nodeId = "node_codex_smoke";

      repository.createRun({
        runId,
        source: "graph",
        nodeIds: [nodeId],
        metadata: {
          ownerId: "codex_smoke_owner",
          graphId: "graph_codex_smoke",
          graphSnapshot: { rootRepoPath },
        },
      });

      try {
        const summary = await runner.run({
          ownerId: "codex_smoke_owner",
          graphId: "graph_codex_smoke",
          runId,
          nodeId,
          rootRepoPath,
          baseRef: "HEAD",
          cli: "codex",
          prompt: [
            "Create CODEX_RUNTIME_TEST.md in the current isolated worktree.",
            "Write one short sentence confirming the monolith Codex runtime smoke test.",
            "Do not edit other files.",
            "At the end, print a valid <!-- orch:output --> JSON block with summary, filesChanged, and status fields.",
          ].join(" "),
        });

        const storedRun = repository.getRun(runId);
        const eventsText = JSON.stringify(storedRun?.events ?? []);
        expect(eventsText).not.toContain(SMOKE_SECRET_VALUE);

        if (summary.status !== "success") {
          const diagnostic = classifyCodexFailure(eventsText);
          if (diagnostic) {
            console.warn(`[codex-smoke] Codex exited cleanly through runtime failure path: ${diagnostic}`);
            console.warn("[codex-smoke] This usually means local Codex auth/model/config needs attention.");
            expect(storedRun?.events.some((event) => event.type === "node.failed")).toBe(true);
            return;
          }

          throw new Error(`Codex smoke failed without an actionable setup diagnostic: ${eventsText}`);
        }

        expect(summary.worktreePath).toContain(path.join(".orchestrator", "worktrees", runId, nodeId));
        await expectPathExists(summary.worktreePath);
        await expectPathExists(path.join(summary.worktreePath, "CODEX_RUNTIME_TEST.md"));
        await expectPathMissing(path.join(rootRepoPath, "CODEX_RUNTIME_TEST.md"));
        expect(summary.patchLength).toBeGreaterThan(0);
        expect(storedRun?.nodeRuns[nodeId]?.patchLength).toBeGreaterThan(0);
        expect(storedRun?.nodeRuns[nodeId]?.output).toBeTruthy();
        await expectMainRepoClean(rootRepoPath);
      } finally {
        await removeRuntimeWorktrees(rootRepoPath);
        await rm(rootRepoPath, { recursive: true, force: true });
      }
    },
    SMOKE_TIMEOUT_MS,
  );
});

function classifyCodexFailure(eventsText: string): string | undefined {
  const lower = eventsText.toLowerCase();
  if (lower.includes("codex cli not found")) return "missing Codex CLI";
  if (lower.includes("requires a newer version") || lower.includes("upgrade")) return "Codex CLI upgrade required";
  if (lower.includes("model") && (lower.includes("unsupported") || lower.includes("not found"))) {
    return "configured Codex model is unsupported";
  }
  if (lower.includes("auth") || lower.includes("login") || lower.includes("api key")) {
    return "Codex authentication issue";
  }
  if (lower.includes("read-only") || lower.includes("writing is blocked")) {
    return "Codex sandbox is read-only";
  }
  if (lower.includes("refusing to create worktree") && lower.includes("gib free")) {
    return "local disk is below the runtime worktree safety threshold";
  }
  if (lower.includes("free at least") && lower.includes("or remove old .orchestrator/worktrees")) {
    return "local disk is below the runtime worktree safety threshold";
  }
  return undefined;
}

async function createTempGitRepo(): Promise<string> {
  const rootRepoPath = await mkdtemp(path.join(os.tmpdir(), "orchestrator-codex-smoke-"));
  await runGit(rootRepoPath, ["init", "-b", "main"]);
  await runGit(rootRepoPath, ["config", "user.email", "codex-smoke@example.com"]);
  await runGit(rootRepoPath, ["config", "user.name", "Codex Smoke"]);
  await writeFile(path.join(rootRepoPath, "README.md"), "# Codex Smoke\n", "utf8");
  await writeFile(path.join(rootRepoPath, ".gitignore"), ".orchestrator/\n", "utf8");
  await runGit(rootRepoPath, ["add", "README.md", ".gitignore"]);
  await runGit(rootRepoPath, ["commit", "-m", "Initial commit"]);
  return rootRepoPath;
}

async function removeRuntimeWorktrees(rootRepoPath: string): Promise<void> {
  const { stdout } = await runGit(rootRepoPath, ["worktree", "list", "--porcelain"]);
  const worktrees = stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((worktreePath) => worktreePath.includes(`${path.sep}.orchestrator${path.sep}`));

  for (const worktreePath of worktrees) {
    await runGit(rootRepoPath, ["worktree", "remove", "--force", worktreePath]);
  }
  await runGit(rootRepoPath, ["worktree", "prune"]);
}

async function expectPathExists(targetPath: string): Promise<void> {
  await expect(access(targetPath)).resolves.toBeUndefined();
}

async function expectPathMissing(targetPath: string): Promise<void> {
  await expect(access(targetPath)).rejects.toThrow();
}

async function expectMainRepoClean(rootRepoPath: string): Promise<void> {
  const { stdout } = await runGit(rootRepoPath, ["status", "--short"]);
  expect(stdout.trim()).toBe("");
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}
