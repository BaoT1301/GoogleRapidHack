import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkCliCapability } from "./cli-capabilities";
import { runCodexProbe } from "./codex-probe";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
let originalPath: string | undefined;

beforeEach(() => {
  originalPath = process.env.PATH;
});

afterEach(async () => {
  process.env.PATH = originalPath;
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

// These tests fake a `codex` binary via a POSIX shell stub + PATH manipulation,
// which doesn't work on Windows (no executable shell stubs). Skip there; they run
// on macOS/Linux/CI where Stephen authored them.
const describeCodex = process.platform === "win32" ? describe.skip : describe;

describeCodex("Codex diagnostics", () => {
  it("keeps passive capability checks limited to codex --version", async () => {
    const binDir = await createBinDir();
    const logPath = path.join(binDir, "calls.log");
    await writeCodexStub(binDir, `printf '%s\\n' "$*" >> "${logPath}"\necho "codex-cli test-version"`);
    process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;

    const capability = await checkCliCapability("codex");

    expect(capability.available).toBe(true);
    expect(capability.version).toBe("codex-cli test-version");
    expect(await readFile(logPath, "utf8")).toBe("--version\n");
  });

  it("classifies authenticated and upgrade-required opt-in probes", async () => {
    const repo = await createTempRepo();
    const binDir = await createBinDir();
    process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;

    await writeCodexStub(binDir, 'echo "AGENT_LOOM_CODEX_PROBE_OK"');
    await expect(runCodexProbe(repo)).resolves.toMatchObject({
      ok: true,
      classification: "authenticated"
    });

    await writeCodexStub(binDir, 'echo "The configured model requires a newer version. Please upgrade." >&2\nexit 1');
    await expect(runCodexProbe(repo)).resolves.toMatchObject({
      ok: false,
      classification: "upgrade_required"
    });
  });
});

describe("Gemini diagnostics", () => {
  it("reports Gemini unavailable and unverified when the CLI is missing", async () => {
    const binDir = await createBinDir();
    process.env.PATH = binDir;

    const capability = await checkCliCapability("gemini");

    expect(capability).toMatchObject({
      available: false,
      command: "gemini",
      experimental: true,
      verified: false,
      note: expect.stringContaining("Install and authenticate Gemini CLI"),
      suggestedFix: expect.stringContaining("non-interactive prompt mode"),
    });
  });

  it("reports Gemini available and verified when the CLI version command works", async () => {
    const binDir = await createBinDir();
    await writeGeminiStub(binDir, 'echo "0.45.1"');
    process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;

    const capability = await checkCliCapability("gemini");

    expect(capability).toMatchObject({
      available: true,
      command: "gemini",
      version: "0.45.1",
      verified: true,
      requiresApiKey: true,
      note: expect.stringContaining("gemini -p <prompt>"),
    });
  });
});

async function createBinDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-loom-bin-"));
  tempDirs.push(directory);
  return directory;
}

async function writeCodexStub(binDir: string, body: string): Promise<void> {
  const stubPath = path.join(binDir, "codex");
  await writeFile(stubPath, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, "utf8");
  await chmod(stubPath, 0o755);
}

async function writeGeminiStub(binDir: string, body: string): Promise<void> {
  const stubPath = path.join(binDir, "gemini");
  await writeFile(stubPath, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, "utf8");
  await chmod(stubPath, 0o755);
}

async function createTempRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(os.tmpdir(), "agent-loom-codex-probe-"));
  tempDirs.push(repo);
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repo });
  return repo;
}
