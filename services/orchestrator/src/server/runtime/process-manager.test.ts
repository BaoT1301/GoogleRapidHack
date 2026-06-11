import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProcessManager, buildSafeSubprocessBaseEnv } from "./process-manager";
import type { RuntimeEvent } from "./types";

describe("ProcessManager security", () => {
  it("builds a subprocess base env without server-side secrets", () => {
    const env = buildSafeSubprocessBaseEnv({
      PATH: "/bin",
      ORCH_CLI_PATH_EXTRA: "/opt/homebrew/bin:/usr/local/bin",
      HOME: "/tmp/home",
      DATABASE_URL: "mongodb://secret",
      OPENAI_API_KEY: "sk-secret-value",
      DT_TOKEN: "dt-secret",
      CLAUDECODE: "nested-session",
      ELECTRON_RUN_AS_NODE: "1",
    });

    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/local/bin:/bin");
    expect(env.HOME).toBe("/tmp/home");
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.DT_TOKEN).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
  });

  it("does not pass ambient server secrets to child processes", async () => {
    const previousSecret = process.env.ORCHESTRATOR_AUDIT_SECRET;
    process.env.ORCHESTRATOR_AUDIT_SECRET = "must-not-leak";

    try {
      const manager = new ProcessManager();
      const result = await manager.startProcess({
        runId: "run_env",
        nodeId: "node_env",
        command: "node",
        args: ["-e", "console.log(process.env.ORCHESTRATOR_AUDIT_SECRET || 'missing')"],
        cwd: process.cwd(),
        onEvent: () => undefined,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdoutText.trim()).toBe("missing");
    } finally {
      if (previousSecret === undefined) {
        delete process.env.ORCHESTRATOR_AUDIT_SECRET;
      } else {
        process.env.ORCHESTRATOR_AUDIT_SECRET = previousSecret;
      }
    }
  });

  it("passes only explicit runtime env values on top of the safe base env", async () => {
    const manager = new ProcessManager();
    const result = await manager.startProcess({
      runId: "run_explicit_env",
      nodeId: "node_explicit_env",
      command: "node",
      args: ["-e", "console.log(process.env.EXPLICIT_RUNTIME_SECRET || 'missing')"],
      cwd: process.cwd(),
      env: { EXPLICIT_RUNTIME_SECRET: "runtime-secret" },
      onEvent: () => undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdoutText.trim()).toBe("runtime-secret");
  });

  it("times out a long-running fake-agent subprocess and emits node.timeout", async () => {
    const manager = new ProcessManager();
    const events: RuntimeEvent[] = [];
    const cwd = await mkdtemp(path.join(os.tmpdir(), "fake-timeout-"));

    try {
      const result = await manager.startProcess({
        runId: "run_timeout",
        nodeId: "node_timeout",
        command: process.execPath,
        args: [path.resolve(process.cwd(), "scripts", "fake-agent.js")],
        cwd,
        env: {
          FAKE_AGENT_NODE_ID: "node_timeout",
          FAKE_AGENT_DELAY_MS: "250",
          FAKE_AGENT_STEPS: "100",
        },
        limits: {
          timeoutMs: 1_000,
          terminateGraceMs: 25,
        },
        onEvent: (event) => events.push(event),
      });

      expect(result.timedOut).toBe(true);
      expect(result.cancelled).toBe(true);
      expect(events.some((event) => event.type === "node.timeout")).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("caps stdout accumulation and emits an output-limit warning", async () => {
    const manager = new ProcessManager();
    const events: RuntimeEvent[] = [];

    const result = await manager.startProcess({
      runId: "run_stdout_cap",
      nodeId: "node_stdout_cap",
      command: "node",
      args: ["-e", "console.log('x'.repeat(20_000))"],
      cwd: process.cwd(),
      limits: {
        maxStdoutBytes: 128,
        maxStderrBytes: 1024,
        maxCombinedOutputBytes: 1024,
        outputLimitMode: "fail",
      },
      onEvent: (event) => events.push(event),
    });

    expect(Buffer.byteLength(result.stdoutText, "utf8")).toBeLessThanOrEqual(128);
    expect(result.outputLimitExceeded).toBe(true);
    expect(result.outputLimitReason).toBe("stdout_limit_exceeded");
    expect(events.some((event) =>
      event.type === "node.rule.warning" &&
      event.payload.rule === "outputLimit"
    )).toBe(true);
  });

  it("caps stderr accumulation and emits an output-limit warning", async () => {
    const manager = new ProcessManager();
    const events: RuntimeEvent[] = [];

    const result = await manager.startProcess({
      runId: "run_stderr_cap",
      nodeId: "node_stderr_cap",
      command: "node",
      args: ["-e", "console.error('e'.repeat(20_000))"],
      cwd: process.cwd(),
      limits: {
        maxStdoutBytes: 1024,
        maxStderrBytes: 128,
        maxCombinedOutputBytes: 1024,
        outputLimitMode: "fail",
      },
      onEvent: (event) => events.push(event),
    });

    expect(Buffer.byteLength(result.stderrText, "utf8")).toBeLessThanOrEqual(128);
    expect(result.outputLimitExceeded).toBe(true);
    expect(result.outputLimitReason).toBe("stderr_limit_exceeded");
    expect(events.some((event) =>
      event.type === "node.rule.warning" &&
      event.payload.rule === "outputLimit"
    )).toBe(true);
  });
});
