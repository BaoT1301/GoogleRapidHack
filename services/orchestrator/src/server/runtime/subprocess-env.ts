import { getSecretValue } from "../secrets/vault";
import type { SupportedCli } from "./types";

export type CliSecretRefs = Partial<Record<string, string>>;

export interface BuildSubprocessEnvInput {
  ownerId: string;
  runId: string;
  nodeId: string;
  graphId?: string;
  cli: SupportedCli;
  secretRefs?: CliSecretRefs;
}

export interface BuiltSubprocessEnv {
  env: Record<string, string>;
  redactionValues: string[];
}

const SECRET_ENV_BY_CLI: Partial<Record<SupportedCli, {
  envName: string;
  refKeys: string[];
}>> = {
  kiro: {
    envName: "KIRO_API_KEY",
    refKeys: ["kiro", "kiroApiKey", "KIRO_API_KEY"],
  },
  gemini: {
    envName: "GEMINI_API_KEY",
    refKeys: ["gemini", "geminiApiKey", "GEMINI_API_KEY"],
  },
  claude: {
    envName: "ANTHROPIC_API_KEY",
    refKeys: ["claude", "anthropic", "anthropicApiKey", "ANTHROPIC_API_KEY"],
  },
};

export async function buildSubprocessEnv(
  input: BuildSubprocessEnvInput,
): Promise<BuiltSubprocessEnv> {
  const env: Record<string, string> = {};
  const redactionValues: string[] = [];

  // Codex normally uses local CLI auth/config, so no API key is injected by default.
  const secretMapping = SECRET_ENV_BY_CLI[input.cli];
  const secretId = secretMapping ? findSecretRef(input.secretRefs, secretMapping.refKeys) : undefined;
  if (secretMapping && secretId) {
    const secretValue = await getSecretValue(input.ownerId, secretId);
    if (secretValue) {
      env[secretMapping.envName] = secretValue;
      redactionValues.push(secretValue);
    }
  }

  if (process.env.ENABLE_DYNATRACE === "1") {
    const dtEnvironment = trimTrailingSlash(process.env.DT_ENVIRONMENT ?? "");
    const dtToken = process.env.DT_TOKEN ?? "";

    if (dtEnvironment) {
      env.OTEL_EXPORTER_OTLP_ENDPOINT = `${dtEnvironment}/api/v2/otlp`;
    }
    if (dtToken) {
      env.OTEL_EXPORTER_OTLP_HEADERS = `Authorization=Api-Token ${dtToken}`;
      redactionValues.push(dtToken, env.OTEL_EXPORTER_OTLP_HEADERS);
    }
    env.OTEL_SERVICE_NAME = "agent-loom-cli";
    env.OTEL_RESOURCE_ATTRIBUTES = buildOtelResourceAttributes(input);
  }

  return { env, redactionValues };
}

function findSecretRef(
  secretRefs: CliSecretRefs | undefined,
  keys: string[],
): string | undefined {
  if (!secretRefs) return undefined;
  for (const key of keys) {
    const value = secretRefs[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function buildOtelResourceAttributes(input: BuildSubprocessEnvInput): string {
  const attributes: Record<string, string | undefined> = {
    "owner.id": input.ownerId,
    "run.id": input.runId,
    "node.id": input.nodeId,
    "graph.id": input.graphId,
    "cli.name": input.cli,
  };

  return Object.entries(attributes)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .map(([key, value]) => `${key}=${sanitizeOtelAttributeValue(value)}`)
    .join(",");
}

function sanitizeOtelAttributeValue(value: string): string {
  return value.replace(/[,\n\r]/g, "_");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}
