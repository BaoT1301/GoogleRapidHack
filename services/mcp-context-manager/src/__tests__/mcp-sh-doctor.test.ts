/**
 * mcp-sh-doctor.test.ts
 *
 * Tests for `./mcp.sh doctor` exit codes.
 *
 * Strategy:
 *  - Write the mock JSON response to a temp file.
 *  - Create stub executables for `docker` and `curl` in a temp bin dir and
 *    prepend it to PATH so the child bash process picks them up.
 *  - Assert exit codes for: healthy (0), degraded (4), container-down (2),
 *    curl-fail (3).
 */

import { describe, it, expect, afterEach } from "vitest";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../");
const MCP_SH = path.join(REPO_ROOT, "mcp.sh");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const HEALTHY_RESPONSE = {
  workspaceRoot: "/workspace",
  resolvedPythonGlobs: ["**/*.py"],
  resolvedTsGlobs: ["**/*.{ts,tsx,js,jsx}"],
  resolvedIgnores: ["**/node_modules/**"],
  fileCount: { total: 42, python: 10, ts: 32 },
  clusterHits: { backend: 10, frontend: 32 },
  degraded: false,
  reasons: [],
};

const DEGRADED_RESPONSE = {
  workspaceRoot: "/workspace",
  resolvedPythonGlobs: ["**/*.py"],
  resolvedTsGlobs: ["**/*.{ts,tsx,js,jsx}"],
  resolvedIgnores: ["**/node_modules/**"],
  fileCount: { total: 0, python: 0, ts: 0 },
  clusterHits: {},
  degraded: true,
  reasons: ["indexed 0 files"],
};

// ── Stub helpers ──────────────────────────────────────────────────────────────

let activeBinDir: string | null = null;

afterEach(() => {
  if (activeBinDir) {
    fs.rmSync(activeBinDir, { recursive: true, force: true });
    activeBinDir = null;
  }
});

function runDoctor(opts: {
  containerRunning: boolean;
  curlShouldFail?: boolean;
  diagResponse?: object;
}): { status: number; stdout: string; stderr: string } {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-doctor-stubs-"));
  activeBinDir = binDir;

  // Write the JSON response to a temp file so the curl stub can cat it
  // without any shell-escaping issues.
  const responseFile = path.join(binDir, "diag-response.json");
  fs.writeFileSync(responseFile, JSON.stringify(opts.diagResponse ?? HEALTHY_RESPONSE));

  // docker stub
  const dockerScript = opts.containerRunning
    ? `#!/usr/bin/env bash\nif [[ "$*" == *"ps"* ]]; then echo "fake-container-id"; fi\n`
    : `#!/usr/bin/env bash\nif [[ "$*" == *"ps"* ]]; then echo ""; fi\n`;
  fs.writeFileSync(path.join(binDir, "docker"), dockerScript, { mode: 0o755 });

  // curl stub — cat the pre-written JSON file, ignoring the actual URL
  const curlScript = opts.curlShouldFail
    ? `#!/usr/bin/env bash\nexit 1\n`
    : `#!/usr/bin/env bash\ncat "${responseFile}"\n`;
  fs.writeFileSync(path.join(binDir, "curl"), curlScript, { mode: 0o755 });

  const result = cp.spawnSync("bash", [MCP_SH, "doctor"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
    },
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("./mcp.sh doctor — exit codes", () => {
  it("exits 2 when container is not running", () => {
    const { status, stdout } = runDoctor({ containerRunning: false });
    expect(status).toBe(2);
    expect(stdout).toMatch(/not running/i);
  });

  it("exits 3 when curl fails (container running but HTTP unreachable)", () => {
    const { status, stdout } = runDoctor({ containerRunning: true, curlShouldFail: true });
    expect(status).toBe(3);
    expect(stdout).toMatch(/Could not reach/i);
  });

  it("exits 0 when service is healthy", () => {
    const { status, stdout } = runDoctor({ containerRunning: true, diagResponse: HEALTHY_RESPONSE });
    expect(status).toBe(0);
    expect(stdout).toMatch(/healthy/i);
  });

  it("exits 4 when service is degraded (0 files indexed)", () => {
    const { status, stdout } = runDoctor({ containerRunning: true, diagResponse: DEGRADED_RESPONSE });
    expect(status).toBe(4);
    expect(stdout).toMatch(/degraded/i);
  });
});
