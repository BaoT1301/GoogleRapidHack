import { getSettingsGateway } from "@/server/data/settings-gateway";
import {
  MCP_STARTUP_POLICIES,
  type McpStartupPolicy,
} from "@/db/models/settings.model";
import type { NodeKind } from "@/db/models/graph.model";

export interface NodeModelDefaults {
  /** Per-node-type default model id (node kind → model). */
  defaultModelByNodeType: Partial<Record<NodeKind, string>>;
  /** Owner's default MCP startup policy for execute nodes. */
  mcpStartupPolicy: McpStartupPolicy;
}

const DEFAULT_MCP_STARTUP_POLICY: McpStartupPolicy = "best-effort";

function isMcpStartupPolicy(value: unknown): value is McpStartupPolicy {
  return typeof value === "string" && (MCP_STARTUP_POLICIES as readonly string[]).includes(value);
}

/**
 * MODEL-1 / MCP-RESILIENCE — resolve the owner's per-node-type default models and
 * default MCP startup policy for a run. Read once per run through the
 * SettingsGateway (BFF mode resolves from the cloud, where the Settings UI
 * persists). Never throws — a settings lookup must not break a run; on any
 * failure we fall back to no defaults + best-effort MCP startup.
 *
 * `ORCH_MCP_STARTUP_POLICY` env wins for the policy (safety/test override).
 */
export async function resolveNodeModelDefaults(
  ownerId: string,
  ctx?: { token?: string | null },
): Promise<NodeModelDefaults> {
  const envPolicy = process.env.ORCH_MCP_STARTUP_POLICY;
  try {
    const settings = await getSettingsGateway(ctx ?? {}).get(ownerId);
    return {
      defaultModelByNodeType: settings.defaultModelByNodeType ?? {},
      mcpStartupPolicy: isMcpStartupPolicy(envPolicy)
        ? envPolicy
        : isMcpStartupPolicy(settings.mcpStartupPolicy)
          ? settings.mcpStartupPolicy
          : DEFAULT_MCP_STARTUP_POLICY,
    };
  } catch {
    return {
      defaultModelByNodeType: {},
      mcpStartupPolicy: isMcpStartupPolicy(envPolicy) ? envPolicy : DEFAULT_MCP_STARTUP_POLICY,
    };
  }
}

/**
 * MODEL-1: resolve a node's model — node `data.model` (highest precedence) →
 * owner's per-node-type default for the node's kind → undefined (CLI default).
 */
export function resolveNodeModelId(
  node: { kind?: string; data?: Record<string, unknown> },
  defaults: NodeModelDefaults,
): string | undefined {
  const raw = typeof node.data?.model === "string" ? (node.data.model as string).trim() : "";
  if (raw) return raw;
  return node.kind ? defaults.defaultModelByNodeType[node.kind as NodeKind] : undefined;
}

/**
 * MCP-RESILIENCE: resolve a node's MCP startup policy — node
 * `data.mcpStartupPolicy` → owner's default policy.
 */
export function resolveNodeMcpStartupPolicy(
  node: { data?: Record<string, unknown> },
  defaults: NodeModelDefaults,
): McpStartupPolicy {
  const raw = node.data?.mcpStartupPolicy;
  if (raw === "require" || raw === "best-effort") return raw;
  return defaults.mcpStartupPolicy;
}
