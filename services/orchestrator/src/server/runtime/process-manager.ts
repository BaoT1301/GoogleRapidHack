import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { RuntimeEvent, RuntimeEventType, SupportedCli } from "./types";
import { resolveRuntimeLimits, type RuntimeLimitOptions } from "./runtime-limits";

interface ProcessState {
  child: ChildProcessByStdio<null, Readable, Readable>;
  cancelRequested: boolean;
  timedOut: boolean;
  done: Promise<void>;
}

interface LineBuffer {
  append(chunk: Buffer | string): string[];
  flush(): string | null;
}

export class ProcessManager {
  private readonly processes = new Map<string, ProcessState>();

  async startProcess(input: {
    runId: string;
    nodeId: string;
    command: string;
    args: string[];
    cwd: string;
    env?: Record<string, string | undefined>;
    cli?: SupportedCli;
    limits?: RuntimeLimitOptions;
    onEvent: (event: RuntimeEvent) => void;
  }): Promise<{
    exitCode: number | null;
    stdoutText: string;
    stderrText: string;
    cancelled: boolean;
    timedOut: boolean;
    outputLimitExceeded: boolean;
    outputLimitReason?: string;
  }> {
    const key = processKey(input.runId, input.nodeId);

    if (this.processes.has(key)) {
      throw new Error(`Process already running for ${key}`);
    }

    const limits = resolveRuntimeLimits(input.limits);
    let stdoutText = "";
    let stderrText = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let combinedOutputBytes = 0;
    let outputLimitExceeded = false;
    let outputLimitReason: string | undefined;
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    input.onEvent(createEvent("node.running", input.runId, input.nodeId, {
      cli: input.cli,
      command: input.command,
      args: input.args,
      cwd: input.cwd
    }));

    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: compactEnv({ ...buildSafeSubprocessBaseEnv(), ...input.env }),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const state: ProcessState = {
      child,
      cancelRequested: false,
      timedOut: false,
      done
    };

    this.processes.set(key, state);

    const stdoutBuffer = createLineBuffer();
    const stderrBuffer = createLineBuffer();

    child.stdout.on("data", (chunk: Buffer) => {
      const accepted = acceptOutputChunk(chunk, "stdout");
      if (!accepted) return;

      const text = accepted.toString("utf8");
      stdoutText += text;

      for (const line of stdoutBuffer.append(text)) {
        input.onEvent(createEvent("node.stdout", input.runId, input.nodeId, { line }));
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const accepted = acceptOutputChunk(chunk, "stderr");
      if (!accepted) return;

      const text = accepted.toString("utf8");
      stderrText += text;

      for (const line of stderrBuffer.append(text)) {
        input.onEvent(createEvent("node.stderr", input.runId, input.nodeId, { line }));
      }
    });

    const timeoutTimer = setTimeout(() => {
      state.timedOut = true;
      state.cancelRequested = true;
      input.onEvent(createEvent("node.timeout", input.runId, input.nodeId, {
        timeoutMs: limits.timeoutMs,
      }));
      state.child.kill("SIGTERM");

      setTimeout(() => {
        if (this.processes.has(key)) {
          state.child.kill("SIGKILL");
        }
      }, limits.terminateGraceMs).unref();
    }, limits.timeoutMs);
    timeoutTimer.unref();

    return await new Promise((resolve, reject) => {
      let settled = false;

      child.once("error", (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutTimer);
        this.processes.delete(key);
        resolveDone();

        reject(error);
      });

      child.once("close", (exitCode, signal) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutTimer);
        emitRemainingLine(stdoutBuffer, "node.stdout", input);
        emitRemainingLine(stderrBuffer, "node.stderr", input);

        this.processes.delete(key);
        resolveDone();

        resolve({
          exitCode,
          stdoutText,
          stderrText,
          cancelled: state.cancelRequested,
          timedOut: state.timedOut,
          outputLimitExceeded,
          outputLimitReason
        });
      });
    });

    function acceptOutputChunk(chunk: Buffer, stream: "stdout" | "stderr"): Buffer | undefined {
      if (outputLimitExceeded) return undefined;

      const streamBytes = stream === "stdout" ? stdoutBytes : stderrBytes;
      const streamLimit = stream === "stdout" ? limits.maxStdoutBytes : limits.maxStderrBytes;
      const remainingStream = streamLimit - streamBytes;
      const remainingCombined = limits.maxCombinedOutputBytes - combinedOutputBytes;
      const allowedBytes = Math.min(chunk.byteLength, remainingStream, remainingCombined);

      if (allowedBytes <= 0) {
        markOutputLimitExceeded(stream);
        return undefined;
      }

      const accepted = allowedBytes === chunk.byteLength ? chunk : chunk.subarray(0, allowedBytes);
      if (stream === "stdout") {
        stdoutBytes += accepted.byteLength;
      } else {
        stderrBytes += accepted.byteLength;
      }
      combinedOutputBytes += accepted.byteLength;

      if (accepted.byteLength < chunk.byteLength) {
        markOutputLimitExceeded(stream);
      }

      return accepted;
    }

    function markOutputLimitExceeded(stream: "stdout" | "stderr"): void {
      if (outputLimitExceeded) return;
      outputLimitExceeded = true;
      outputLimitReason =
        combinedOutputBytes >= limits.maxCombinedOutputBytes
          ? "combined_output_limit_exceeded"
          : `${stream}_limit_exceeded`;
      input.onEvent(createEvent("node.rule.warning", input.runId, input.nodeId, {
        rule: "outputLimit",
        stream,
        reason: outputLimitReason,
        stdoutBytes,
        stderrBytes,
        combinedOutputBytes,
        limits: {
          maxStdoutBytes: limits.maxStdoutBytes,
          maxStderrBytes: limits.maxStderrBytes,
          maxCombinedOutputBytes: limits.maxCombinedOutputBytes,
        },
      }));

      if (limits.outputLimitMode === "fail") {
        state.cancelRequested = true;
        state.child.kill("SIGTERM");
      }
    }
  }

  async cancelProcess(runId: string, nodeId: string): Promise<boolean> {
    const key = processKey(runId, nodeId);
    const state = this.processes.get(key);

    if (!state) {
      return false;
    }

    state.cancelRequested = true;
    state.child.kill("SIGTERM");

    const killTimer = setTimeout(() => {
      if (this.processes.has(key)) {
        state.child.kill("SIGKILL");
      }
    }, 10_000);

    try {
      await state.done;
    } finally {
      clearTimeout(killTimer);
    }

    return true;
  }

  getProcessState(runId: string, nodeId: string): "not_found" | "running" {
    return this.processes.has(processKey(runId, nodeId)) ? "running" : "not_found";
  }

  /** Cancel every in-flight process for a run. Returns how many were killed. */
  async cancelRun(runId: string): Promise<number> {
    const prefix = `${runId}:`;
    const nodeIds = [...this.processes.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
    await Promise.all(nodeIds.map((nodeId) => this.cancelProcess(runId, nodeId)));
    return nodeIds.length;
  }
}

function emitRemainingLine(
  buffer: LineBuffer,
  type: "node.stdout" | "node.stderr",
  input: {
    runId: string;
    nodeId: string;
    onEvent: (event: RuntimeEvent) => void;
  }
): void {
  const line = buffer.flush();

  if (line !== null) {
    input.onEvent(createEvent(type, input.runId, input.nodeId, { line }));
  }
}

function createLineBuffer(): LineBuffer {
  let pending = "";

  return {
    append(chunk) {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      return lines;
    },
    flush() {
      if (pending.length === 0) {
        return null;
      }

      const line = pending;
      pending = "";
      return line;
    }
  };
}

function createEvent(
  type: RuntimeEventType,
  runId: string,
  nodeId: string,
  payload: Record<string, unknown> = {}
): RuntimeEvent {
  return {
    type,
    runId,
    nodeId,
    timestamp: new Date().toISOString(),
    payload
  };
}

function processKey(runId: string, nodeId: string): string {
  return `${runId}:${nodeId}`;
}

export function buildSafeSubprocessBaseEnv(
  sourceEnv: Record<string, string | undefined> = process.env
): Record<string, string> {
  const allowedKeys = [
    "PATH",
    "NODE_ENV",
    "ELECTRON_RUN_AS_NODE",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "TERM",
    "SHELL",
    "SystemRoot",
    "WINDIR",
    "PATHEXT",
    "COMSPEC"
  ];
  const env: Record<string, string> = {};

  for (const key of allowedKeys) {
    const value = sourceEnv[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  const extraPath = sourceEnv.ORCH_CLI_PATH_EXTRA;
  if (typeof extraPath === "string" && extraPath.trim().length > 0) {
    env.PATH = [extraPath, env.PATH].filter(Boolean).join(pathDelimiter());
  }

  return env;
}

function compactEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  ) as NodeJS.ProcessEnv;
}

function pathDelimiter(): string {
  return process.platform === "win32" ? ";" : ":";
}
