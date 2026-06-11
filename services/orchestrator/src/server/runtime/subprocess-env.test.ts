import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSubprocessEnv } from "./subprocess-env";
import { redactText } from "./redaction";

vi.mock("../secrets/vault", () => ({
  getSecretValue: vi.fn(async (_ownerId: string, secretId: string) => {
    if (secretId === "secret_claude") return "anthropic-secret-value";
    if (secretId === "secret_gemini") return "gemini-secret-value";
    if (secretId === "secret_kiro") return "kiro-secret-value";
    return null;
  }),
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.ENABLE_DYNATRACE;
  delete process.env.DT_ENVIRONMENT;
  delete process.env.DT_TOKEN;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("buildSubprocessEnv", () => {
  it("does not add OTel env when Dynatrace is disabled", async () => {
    const result = await buildSubprocessEnv({
      ownerId: "owner_1",
      runId: "run_1",
      nodeId: "node_1",
      cli: "fake",
    });

    expect(result.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(result.env.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined();
    expect(result.redactionValues).toEqual([]);
  });

  it("builds Dynatrace OTel env and redacts the token", async () => {
    process.env.ENABLE_DYNATRACE = "1";
    process.env.DT_ENVIRONMENT = "https://abc.live.dynatrace.com/";
    process.env.DT_TOKEN = "dt-secret-token";

    const result = await buildSubprocessEnv({
      ownerId: "owner,1",
      runId: "run_1",
      nodeId: "node_1",
      graphId: "graph_1",
      cli: "codex",
    });

    expect(result.env).toMatchObject({
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://abc.live.dynatrace.com/api/v2/otlp",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Api-Token dt-secret-token",
      OTEL_SERVICE_NAME: "agent-loom-cli",
    });
    expect(result.env.OTEL_RESOURCE_ATTRIBUTES).toContain("owner.id=owner_1");
    expect(result.env.OTEL_RESOURCE_ATTRIBUTES).toContain("run.id=run_1");
    expect(result.env.OTEL_RESOURCE_ATTRIBUTES).toContain("node.id=node_1");
    expect(result.env.OTEL_RESOURCE_ATTRIBUTES).toContain("graph.id=graph_1");
    expect(result.env.OTEL_RESOURCE_ATTRIBUTES).toContain("cli.name=codex");
    expect(result.redactionValues).toContain("dt-secret-token");
    expect(redactText(result.env.OTEL_EXPORTER_OTLP_HEADERS, result.redactionValues)).not.toContain(
      "dt-secret-token",
    );
  });

  it("maps adapter secrets and returns redaction values", async () => {
    const result = await buildSubprocessEnv({
      ownerId: "owner_1",
      runId: "run_1",
      nodeId: "node_1",
      cli: "claude",
      secretRefs: { claude: "secret_claude" },
    });

    expect(result.env.ANTHROPIC_API_KEY).toBe("anthropic-secret-value");
    expect(result.redactionValues).toContain("anthropic-secret-value");
    expect(redactText(`stderr ${result.env.ANTHROPIC_API_KEY}`, result.redactionValues)).toBe(
      "stderr [REDACTED]",
    );
  });

  it("does not inject a Codex key by default", async () => {
    const result = await buildSubprocessEnv({
      ownerId: "owner_1",
      runId: "run_1",
      nodeId: "node_1",
      cli: "codex",
      secretRefs: { codex: "secret_codex" },
    });

    expect(result.env).toEqual({});
    expect(result.redactionValues).toEqual([]);
  });
});
