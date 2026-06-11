import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 30_000;
const MARKER = "AGENT_LOOM_CODEX_PROBE_OK";

export type CodexProbeClassification =
  | "authenticated"
  | "model_unsupported"
  | "upgrade_required"
  | "command_unavailable"
  | "timed_out"
  | "unknown_failure";

export interface CodexProbeResult {
  ok: boolean;
  classification: CodexProbeClassification;
  marker: string;
  stdoutPreview: string;
  stderrPreview: string;
  suggestedFix?: string;
}

export async function runCodexProbe(cwd: string): Promise<CodexProbeResult> {
  if (!path.isAbsolute(cwd)) {
    throw new Error("cwd must be an absolute path");
  }

  await assertGitRepo(cwd);

  try {
    const { stdout, stderr } = await execFileAsync(
      "codex",
      [
        "exec",
        "--sandbox",
        "read-only",
        "--cd",
        cwd,
        `Reply with exactly ${MARKER}. Do not inspect or edit files.`
      ],
      {
        cwd,
        encoding: "utf8",
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: 1024 * 1024
      }
    );
    const output = `${stdout}\n${stderr}`;
    return {
      ok: output.includes(MARKER),
      classification: output.includes(MARKER) ? "authenticated" : "unknown_failure",
      marker: MARKER,
      stdoutPreview: preview(stdout),
      stderrPreview: preview(stderr)
    };
  } catch (error) {
    const message = errorText(error);
    const classification = classifyFailure(error, message);
    return {
      ok: false,
      classification,
      marker: MARKER,
      stdoutPreview: preview("stdout" in asRecord(error) ? String(asRecord(error).stdout ?? "") : ""),
      stderrPreview: preview(message),
      suggestedFix: suggestedFix(classification)
    };
  }
}

async function assertGitRepo(cwd: string): Promise<void> {
  try {
    await execFileAsync("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      timeout: 5_000
    });
  } catch {
    throw new Error(`cwd is not a git repository: ${cwd}`);
  }
}

function classifyFailure(error: unknown, message: string): CodexProbeClassification {
  const lower = message.toLowerCase();
  if (isNodeError(error) && error.code === "ENOENT") return "command_unavailable";
  if ("killed" in asRecord(error) && asRecord(error).killed === true) return "timed_out";
  if (lower.includes("requires a newer version") || lower.includes("upgrade")) return "upgrade_required";
  if (lower.includes("model") && (lower.includes("not found") || lower.includes("unsupported"))) return "model_unsupported";
  return "unknown_failure";
}

function suggestedFix(classification: CodexProbeClassification): string | undefined {
  switch (classification) {
    case "command_unavailable": return "Install Codex CLI or switch this node to fake";
    case "timed_out": return "Retry the probe after checking Codex authentication and network access";
    case "upgrade_required": return "Upgrade Codex CLI, then restart services/orchestrator";
    case "model_unsupported": return "Select a model supported by the installed Codex CLI";
    default: return undefined;
  }
}

function preview(text: string): string {
  return text.slice(0, 2_000);
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n${"stderr" in error ? String((error as Error & { stderr?: unknown }).stderr ?? "") : ""}`;
  }
  return String(error);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
