// SettingsGateway — persistence seam for the `settings` domain (shared data-core).
// Mongo impl + server-side normalization (per-CLI tools) live here so whoever owns
// Mongo is the authority; the orchestrator adds the BFF variant + selector.
import { connectDB } from "../db/client";
import {
  UserSettingsModel,
  MCP_STARTUP_POLICIES,
  type MergeStrategy,
  type PlannerProvider,
  type ICanvasConfig,
  type IFixerConfig,
  type McpStartupPolicy,
} from "../db/models/settings.model";
import { NODE_KINDS, SUPPORTED_CLIS, type NodeKind } from "../db/models/graph.model";
import { DEFAULT_ALLOWED_TOOLS, normalizeAllowedTools } from "../runtime/kiro-tools";
import {
  CLI_TOOL_CATALOG_ORDER,
  isCatalogCli,
  normalizeToolsForCli,
} from "../runtime/cli-tool-catalogs";

export interface SettingsValue {
  allowedTools: string[];
  /** Per-CLI selections (CLI → normalized tool names) for every catalog CLI. */
  allowedToolsByCli: Record<string, string[]>;
  plannerProvider: PlannerProvider;
  mergeStrategy: MergeStrategy;
  /** Canvas theming (themePacks): selected pack id (null → Classic) + overrides. */
  canvasThemePackId: string | null;
  canvasConfig: ICanvasConfig;
  /** MODEL-1: per-node-type default model id (node kind → model). */
  defaultModelByNodeType: Partial<Record<NodeKind, string>>;
  /** MODEL-1: defaults applied to spawned fixer nodes. */
  fixerConfig: IFixerConfig;
  /** MCP-RESILIENCE: how execute nodes treat MCP-server startup. */
  mcpStartupPolicy: McpStartupPolicy;
}

export interface SettingsUpdateInput {
  allowedTools?: string[];
  allowedToolsByCli?: Record<string, string[]>;
  plannerProvider?: PlannerProvider;
  mergeStrategy?: MergeStrategy;
  canvasThemePackId?: string;
  canvasConfig?: ICanvasConfig;
  defaultModelByNodeType?: Partial<Record<NodeKind, string>>;
  fixerConfig?: IFixerConfig;
  mcpStartupPolicy?: McpStartupPolicy;
}

const MODEL_ID_RE = /^[a-zA-Z0-9._:/-]+$/;

/** Validate a model id; blank/invalid → undefined (CLI uses its own default). */
function normalizeModelIdValue(model: string | undefined): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed || !MODEL_ID_RE.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Normalize the per-node-type default model map: unknown node kinds dropped,
 * blank/invalid model ids dropped. Never throws — junk is simply ignored.
 */
function normalizeDefaultModelByNodeType(
  raw: Partial<Record<string, string>> | undefined,
): Partial<Record<NodeKind, string>> {
  const out: Partial<Record<NodeKind, string>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const kind of NODE_KINDS) {
    const model = normalizeModelIdValue(raw[kind]);
    if (model) out[kind] = model;
  }
  return out;
}

/** Normalize the fixer config: cli must be a known CLI; model validated; persona trimmed. */
function normalizeFixerConfig(raw: IFixerConfig | undefined): IFixerConfig {
  const out: IFixerConfig = {};
  if (!raw || typeof raw !== "object") return out;
  if (raw.cli && (SUPPORTED_CLIS as readonly string[]).includes(raw.cli)) out.cli = raw.cli;
  const model = normalizeModelIdValue(raw.model);
  if (model) out.model = model;
  const persona = raw.persona?.trim();
  if (persona) out.persona = persona;
  return out;
}

function normalizeMcpStartupPolicy(raw: unknown): McpStartupPolicy {
  return (MCP_STARTUP_POLICIES as readonly string[]).includes(raw as string)
    ? (raw as McpStartupPolicy)
    : "best-effort";
}

/**
 * Build the full per-CLI map for a `get`, with kiro derived from the flat
 * `allowedTools` source of truth and every other catalog CLI normalized against
 * its own catalog. Centralized here (the Mongo authority) so both the local app
 * and the cloud BFF return an identically-shaped, normalized map.
 */
function buildAllowedToolsByCli(
  flatKiro: string[],
  stored: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const cli of CLI_TOOL_CATALOG_ORDER) {
    out[cli] = cli === "kiro" ? flatKiro : normalizeToolsForCli(cli, stored?.[cli]);
  }
  return out;
}

export interface SettingsGateway {
  get(ownerId: string): Promise<SettingsValue>;
  update(ownerId: string, input: SettingsUpdateInput): Promise<SettingsValue>;
}

/** Direct-Mongo implementation — the shipped behavior (normalization included). */
export class MongoSettingsGateway implements SettingsGateway {
  async get(ownerId: string): Promise<SettingsValue> {
    await connectDB();
    const doc = await UserSettingsModel.findOne({ ownerId }).lean();
    const allowedTools = normalizeAllowedTools(doc?.allowedTools);
    return {
      allowedTools,
      allowedToolsByCli: buildAllowedToolsByCli(allowedTools, doc?.allowedToolsByCli),
      plannerProvider: doc?.plannerProvider ?? "cloud",
      mergeStrategy: doc?.mergeStrategy ?? "base-fanin",
      canvasThemePackId: doc?.canvasThemePackId ?? null,
      canvasConfig: doc?.canvasConfig ?? {},
      defaultModelByNodeType: normalizeDefaultModelByNodeType(doc?.defaultModelByNodeType),
      fixerConfig: normalizeFixerConfig(doc?.fixerConfig),
      mcpStartupPolicy: normalizeMcpStartupPolicy(doc?.mcpStartupPolicy),
    };
  }

  async update(ownerId: string, input: SettingsUpdateInput): Promise<SettingsValue> {
    await connectDB();
    const set: Record<string, unknown> = {};

    // Per-CLI selections. Normalize each against its catalog; mirror kiro into the
    // flat `allowedTools` source of truth. Dotted $set paths so other CLIs' stored
    // selections are preserved. Clients can never enable an unknown/trust-all tool.
    if (input.allowedToolsByCli) {
      for (const [cli, tools] of Object.entries(input.allowedToolsByCli)) {
        if (!isCatalogCli(cli)) continue; // ignore unknown CLIs
        const norm = normalizeToolsForCli(cli, tools);
        set[`allowedToolsByCli.${cli}`] = norm;
        if (cli === "kiro") set.allowedTools = norm;
      }
    }

    // Legacy flat path — treated as the kiro set; mirrored both ways. Applied after
    // the map so an explicit `allowedTools` wins for kiro.
    if (input.allowedTools !== undefined) {
      const norm = normalizeAllowedTools(input.allowedTools);
      set.allowedTools = norm;
      set["allowedToolsByCli.kiro"] = norm;
    }

    if (input.plannerProvider !== undefined) set.plannerProvider = input.plannerProvider;
    if (input.mergeStrategy !== undefined) set.mergeStrategy = input.mergeStrategy;

    // MODEL-1 / MCP-RESILIENCE — normalized server-side (the Mongo authority).
    if (input.defaultModelByNodeType !== undefined) {
      set.defaultModelByNodeType = normalizeDefaultModelByNodeType(input.defaultModelByNodeType);
    }
    if (input.fixerConfig !== undefined) {
      set.fixerConfig = normalizeFixerConfig(input.fixerConfig);
    }
    if (input.mcpStartupPolicy !== undefined) {
      set.mcpStartupPolicy = normalizeMcpStartupPolicy(input.mcpStartupPolicy);
    }

    // Canvas theming (themePacks). canvasConfig fields use dotted paths so a partial
    // update preserves the other field.
    if (input.canvasThemePackId !== undefined) set.canvasThemePackId = input.canvasThemePackId;
    if (input.canvasConfig) {
      if (input.canvasConfig.motionEnabled !== undefined) {
        set["canvasConfig.motionEnabled"] = input.canvasConfig.motionEnabled;
      }
      if (input.canvasConfig.backgroundKind !== undefined) {
        set["canvasConfig.backgroundKind"] = input.canvasConfig.backgroundKind;
      }
    }

    const doc = await UserSettingsModel.findOneAndUpdate(
      { ownerId },
      { $set: set, $setOnInsert: { ownerId } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    const allowedTools = normalizeAllowedTools(doc?.allowedTools ?? [...DEFAULT_ALLOWED_TOOLS]);
    return {
      allowedTools,
      allowedToolsByCli: buildAllowedToolsByCli(allowedTools, doc?.allowedToolsByCli),
      plannerProvider: doc?.plannerProvider ?? "cloud",
      mergeStrategy: doc?.mergeStrategy ?? "base-fanin",
      canvasThemePackId: doc?.canvasThemePackId ?? null,
      canvasConfig: doc?.canvasConfig ?? {},
      defaultModelByNodeType: normalizeDefaultModelByNodeType(doc?.defaultModelByNodeType),
      fixerConfig: normalizeFixerConfig(doc?.fixerConfig),
      mcpStartupPolicy: normalizeMcpStartupPolicy(doc?.mcpStartupPolicy),
    };
  }
}

export const mongoSettingsGateway = new MongoSettingsGateway();
