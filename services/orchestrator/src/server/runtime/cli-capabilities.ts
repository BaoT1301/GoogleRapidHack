import { execFile, execFileSync } from "node:child_process";
import { constants, accessSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SupportedCli } from "./types";

const execFileAsync = promisify(execFile);
const CHECK_TIMEOUT_MS = 5_000;
export const SUPPORTED_CLI_ORDER: SupportedCli[] = [
  "fake",
  "codex",
  "kiro",
  "gemini",
  "claude"
];

export interface CliCapability {
  available: boolean;
  command: string;
  version?: string;
  experimental?: boolean;
  verified?: boolean;
  requiresApiKey?: boolean;
  authMode?: KiroAuthMode;
  note?: string;
  suggestedFix?: string;
  executablePath?: string;
  configuredModel?: string;
  sandboxMode?: "read-only" | "workspace-write";
  useCd?: boolean;
  warnings?: string[];
}

/**
 * Resolved authentication state for the Kiro adapter (owner choice C: prefer the
 * user's host login, treat `KIRO_API_KEY` as an optional fallback). Consumed by
 * the UI (RUN-8) to show "signed in / using fallback key / not signed in".
 */
export type KiroAuthMode = "host-login" | "api-key" | "unauthenticated";

export type CliCapabilities = Record<SupportedCli, CliCapability>;

export async function checkCliCapability(cli: SupportedCli): Promise<CliCapability> {
  switch (cli) {
    case "fake":
      return checkFakeCapability();
    case "codex":
      return checkCodexCapability();
    case "kiro":
      return checkKiroCapability();
    case "gemini":
      return checkGeminiCapability();
    case "claude":
      return checkClaudeCapability();
  }
}

async function checkGeminiCapability(): Promise<CliCapability> {
  const geminiCli = await checkCommandCapability("gemini", ["--version"], {
    missingNote: "Gemini CLI not found",
    verified: false,
  });

  if (!geminiCli.available) {
    return {
      ...geminiCli,
      experimental: true,
      verified: false,
      note: "Gemini CLI not found. Install and authenticate Gemini CLI before using it as the second real CLI demo path.",
      suggestedFix: "Install Gemini CLI, verify `gemini --version` and non-interactive prompt mode, or switch this node to fake",
    };
  }

  return {
    ...geminiCli,
    verified: true,
    requiresApiKey: true,
    note: "Gemini CLI is installed. Verified command shape: `gemini -p <prompt>` for non-interactive/headless execution. If API-key auth is required, pass a vault secret ref so the runtime injects GEMINI_API_KEY server-side.",
  };
}

async function checkCodexCapability(): Promise<CliCapability> {
  const capability = await checkCommandCapability("codex", ["--version"], {
    missingNote: "Codex CLI not found",
    suggestedFix: "Install Codex CLI or switch this node to fake",
    verified: true
  });
  const executablePath = await resolveExecutablePath("codex");
  const configuredModel = await readCodexConfiguredModel();
  const sandboxMode = process.env.ORCH_CODEX_SANDBOX === "read-only"
    ? "read-only"
    : "workspace-write";
  const useCd = process.env.ORCH_CODEX_USE_CD !== "false";
  const warnings: string[] = [];

  if (capability.available && configuredModel) {
    warnings.push(`Model compatibility is not proven passively for ${configuredModel}. Use the opt-in Codex probe before running agents.`);
  }
  if (sandboxMode === "read-only") {
    warnings.push("ORCH_CODEX_SANDBOX is read-only; Codex agent nodes cannot edit worktree files.");
  }

  return {
    ...capability,
    executablePath,
    configuredModel,
    sandboxMode,
    useCd,
    warnings
  };
}

export async function getAllCliCapabilities(): Promise<CliCapabilities> {
  const [fake, codex, kiro, gemini, claude] = await Promise.all(
    SUPPORTED_CLI_ORDER.map((cli) => checkCliCapability(cli))
  );

  return {
    fake,
    codex,
    kiro,
    gemini,
    claude
  };
}

export const getCliCapabilities = getAllCliCapabilities;

async function checkFakeCapability(): Promise<CliCapability> {
  // fake-agent.js is staged under service-root scripts/ for local dev and
  // standalone builds. FAKE_AGENT_PATH remains available for tests.
  const fakeAgentPath =
    process.env.FAKE_AGENT_PATH ??
    path.resolve(process.cwd(), "scripts", "fake-agent.js");

  try {
    await access(fakeAgentPath);
  } catch {
    return {
      available: false,
      command: process.execPath,
      version: process.version,
      note: `Fake agent script not found at ${fakeAgentPath}`,
      suggestedFix: "Run from services/orchestrator or set FAKE_AGENT_PATH"
    };
  }

  return {
    available: true,
    command: process.execPath,
    version: process.version,
    verified: true,
    note: "Deterministic local fake agent is available"
  };
}

// kiro-cli + headless `chat` flow + per-run MCP (workspace auto-discovery) +
// host-login/api-key auth were verified locally (kiro-cli 2.5.1) during CLI-1.
const KIRO_ADAPTER_VERIFIED = true;

/**
 * Pure auth-state resolver (owner choice C). Prefers host login; `KIRO_API_KEY`
 * is an optional fallback only. Exported for deterministic testing of all cases.
 */
export function resolveKiroAuthMode(input: {
  installed: boolean;
  hostLoggedIn: boolean;
  apiKeyPresent: boolean;
}): Pick<CliCapability, "available" | "authMode" | "requiresApiKey" | "note" | "suggestedFix"> {
  if (!input.installed) {
    return {
      available: false,
      authMode: "unauthenticated",
      requiresApiKey: false,
      note: "Kiro CLI not found.",
      suggestedFix: "Install kiro-cli, run `kiro-cli login` (or set KIRO_API_KEY), or switch this node to fake"
    };
  }
  if (input.hostLoggedIn) {
    return {
      available: true,
      authMode: "host-login",
      requiresApiKey: false,
      note: "Signed in via host login (kiro-cli login). KIRO_API_KEY is an optional fallback."
    };
  }
  if (input.apiKeyPresent) {
    return {
      available: true,
      authMode: "api-key",
      requiresApiKey: false,
      note: "Using KIRO_API_KEY (fallback). The recommended path is `kiro-cli login`."
    };
  }
  return {
    available: false,
    authMode: "unauthenticated",
    requiresApiKey: false,
    note: "kiro-cli is installed but not signed in.",
    suggestedFix: "Run `kiro-cli login`, set KIRO_API_KEY, or switch this node to fake"
  };
}

/** Detect an inherited host login: `kiro-cli whoami` exits 0 when signed in. */
async function detectKiroHostLogin(): Promise<boolean> {
  try {
    await execFileAsync("kiro-cli", ["whoami"], {
      encoding: "utf8",
      timeout: CHECK_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      shell: process.platform === "win32"
    });
    return true;
  } catch {
    return false;
  }
}

async function checkKiroCapability(): Promise<CliCapability> {
  if (process.env.ORCH_TEST_KIRO_AVAILABLE === "1") {
    return {
      available: true,
      command: "kiro-cli",
      version: "kiro-cli 2.5.1-mock",
      experimental: true,
      verified: true,
      authMode: "host-login",
      note: "Signed in via host login (kiro-cli login). KIRO_API_KEY is an optional fallback."
    };
  }
  if (process.env.ORCH_TEST_KIRO_AVAILABLE === "0") {
    return {
      available: false,
      command: "kiro-cli",
      experimental: true,
      verified: false,
      authMode: "unauthenticated",
      note: "Kiro CLI not found.",
      suggestedFix: "Install kiro-cli, run `kiro-cli login` (or set KIRO_API_KEY), or switch this node to fake"
    };
  }

  const kiroCli = await checkCommandCapability("kiro-cli", ["--version"], {
    experimental: true,
    missingNote: "Kiro CLI not found",
    verified: false
  });

  const hostLoggedIn = kiroCli.available ? await detectKiroHostLogin() : false;
  const auth = resolveKiroAuthMode({
    installed: kiroCli.available,
    hostLoggedIn,
    apiKeyPresent: Boolean(process.env.KIRO_API_KEY)
  });

  return {
    ...kiroCli,
    ...auth,
    experimental: true,
    verified: auth.available ? KIRO_ADAPTER_VERIFIED : false
  };
}

async function checkCommandCapability(
  command: string,
  args: string[],
  options: {
    experimental?: boolean;
    missingNote?: string;
    note?: string;
    suggestedFix?: string;
    verified?: boolean;
  } = {}
): Promise<CliCapability> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      encoding: "utf8",
      timeout: CHECK_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: effectiveCliLookupEnv(),
      // Windows CLIs are usually .cmd/.ps1 shims (e.g. npm-installed `claude`),
      // which execFile can't run without a shell. Only shell-out for bare CLI
      // names (not `node`/absolute paths). POSIX keeps shell off.
      shell:
        process.platform === "win32" &&
        command !== "node" &&
        !command.includes("/") &&
        !command.includes("\\")
    });
    const version = firstNonEmptyLine(`${stdout}\n${stderr}`);

    return {
      available: true,
      command,
      version,
      experimental: options.experimental,
      verified: options.verified,
      note: options.note
    };
  } catch (error) {
    return {
      available: false,
      command,
      experimental: options.experimental,
      verified: options.verified,
      note: buildMissingCommandNote(command, error, options.missingNote),
      suggestedFix:
        options.suggestedFix ?? `Install ${command} or switch this node to fake`
    };
  }
}

async function resolveExecutablePath(command: string): Promise<string | undefined> {
  for (const directory of effectiveCliPath().split(path.delimiter)) {
    if (!directory) {
      continue;
    }

    const candidate = path.join(directory, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep checking PATH entries.
    }
  }

  return undefined;
}

export function checkCliAvailableSync(command: string): boolean {
  for (const directory of effectiveCliPath().split(path.delimiter)) {
    if (!directory) {
      continue;
    }

    const candidate = path.join(directory, command);
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      // Keep checking PATH entries.
    }
  }

  return false;
}

function effectiveCliLookupEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: effectiveCliPath()
  };
}

function effectiveCliPath(): string {
  const basePath = process.env.PATH ?? "";
  const extraPath = process.env.ORCH_CLI_PATH_EXTRA;
  if (typeof extraPath !== "string" || extraPath.trim().length === 0) {
    return basePath;
  }
  return [extraPath, basePath].filter(Boolean).join(path.delimiter);
}

async function readCodexConfiguredModel(): Promise<string | undefined> {
  try {
    const config = await readFile(path.join(os.homedir(), ".codex", "config.toml"), "utf8");
    const match = config.match(/^model\s*=\s*"([^"]+)"/m);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function firstNonEmptyLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

function buildMissingCommandNote(
  command: string,
  error: unknown,
  fallbackNote?: string
): string {
  if (isTimeoutError(error)) {
    return `${command} --version timed out after ${CHECK_TIMEOUT_MS}ms`;
  }

  if (isMissingExecutableError(error)) {
    return fallbackNote ?? `${command} command not found`;
  }

  const message = error instanceof Error ? error.message : String(error);
  return `${command} check failed: ${message}`;
}

function isMissingExecutableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "killed" in error &&
    (error as { killed?: boolean }).killed === true
  );
}

export function checkClaudeAvailableSync(): boolean {
  if (process.env.ORCH_TEST_CLAUDE_AVAILABLE === "1") return true;
  if (process.env.ORCH_TEST_CLAUDE_AVAILABLE === "0") return false;

  if (!checkCliAvailableSync("claude")) return false;
  if (process.env.ANTHROPIC_API_KEY) return true;
  try {
    execFileSync("claude", ["auth", "status"], {
      stdio: "ignore",
      timeout: 1000,
      shell: process.platform === "win32"
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveClaudeAuthMode(input: {
  installed: boolean;
  hostLoggedIn: boolean;
  apiKeyPresent: boolean;
}): Pick<CliCapability, "available" | "authMode" | "requiresApiKey" | "note" | "suggestedFix"> {
  if (!input.installed) {
    return {
      available: false,
      authMode: "unauthenticated",
      requiresApiKey: false,
      note: "Claude CLI not found.",
      suggestedFix: "Install Claude CLI, run `claude auth login` (or set ANTHROPIC_API_KEY), or switch this node to fake"
    };
  }
  if (input.hostLoggedIn) {
    return {
      available: true,
      authMode: "host-login",
      requiresApiKey: false,
      note: "Signed in via host login (claude auth login). ANTHROPIC_API_KEY is an optional fallback."
    };
  }
  if (input.apiKeyPresent) {
    return {
      available: true,
      authMode: "api-key",
      requiresApiKey: false,
      note: "Using ANTHROPIC_API_KEY (fallback). The recommended path is `claude auth login`."
    };
  }
  return {
    available: false,
    authMode: "unauthenticated",
    requiresApiKey: false,
    note: "claude is installed but not signed in.",
    suggestedFix: "Run `claude auth login`, set ANTHROPIC_API_KEY, or switch this node to fake"
  };
}

async function detectClaudeHostLogin(): Promise<boolean> {
  try {
    await execFileAsync("claude", ["auth", "status"], {
      encoding: "utf8",
      timeout: CHECK_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      shell: process.platform === "win32"
    });
    return true;
  } catch {
    return false;
  }
}

async function checkClaudeCapability(): Promise<CliCapability> {
  if (process.env.ORCH_TEST_CLAUDE_AVAILABLE === "1") {
    return {
      available: true,
      command: "claude",
      version: "claude 0.1.0-mock",
      experimental: true,
      verified: true,
      authMode: "host-login",
      note: "Signed in via host login (claude auth login). ANTHROPIC_API_KEY is an optional fallback."
    };
  }
  if (process.env.ORCH_TEST_CLAUDE_AVAILABLE === "0") {
    return {
      available: false,
      command: "claude",
      experimental: true,
      verified: false,
      authMode: "unauthenticated",
      note: "Claude CLI not found.",
      suggestedFix: "Install Claude CLI, run `claude auth login` (or set ANTHROPIC_API_KEY), or switch this node to fake"
    };
  }

  const claudeCli = await checkCommandCapability("claude", ["--version"], {
    experimental: true,
    missingNote: "Claude CLI not found",
    verified: false
  });

  const hostLoggedIn = claudeCli.available ? await detectClaudeHostLogin() : false;
  const auth = resolveClaudeAuthMode({
    installed: claudeCli.available,
    hostLoggedIn,
    apiKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY)
  });

  return {
    ...claudeCli,
    ...auth,
    experimental: true,
    verified: auth.available
  };
}
