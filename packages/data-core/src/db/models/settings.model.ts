import { Schema, model, models, type Model } from "mongoose";
import { NODE_KINDS, SUPPORTED_CLIS, type NodeKind, type SupportedCli } from "./graph.model";

/**
 * Per-user workspace settings (CLI-4 + planner toggle).
 *   - `allowedTools`: the kiro `--trust-tools` set applied to EXECUTE nodes
 *     (writes opt-in). The planner is always read-only regardless (PLAN-8b).
 *   - `plannerProvider`: the Settings planner toggle ("cloud" default / "local").
 *
 * One document per owner. No secret values are ever stored here (AD-8).
 */
export const PLANNER_PROVIDERS = ["cloud", "local"] as const;
export type PlannerProvider = (typeof PLANNER_PROVIDERS)[number];

/**
 * Merge-back model for parallel tracks:
 *   - `base-fanin` (default): every successful node merges independently into the
 *     graph's base branch in topological order (Sprint 3).
 *   - `lineage`: each node's worktree forks from its parent branch(es) (convergence
 *     nodes merge multiple parents), only leaf/terminal nodes merge into base, and
 *     intermediate branches are pruned ("stacked branches").
 */
export const MERGE_STRATEGIES = ["base-fanin", "lineage"] as const;
export type MergeStrategy = (typeof MERGE_STRATEGIES)[number];

/**
 * Per-user canvas appearance config (Theme Packs). Additive + optional — absent
 * on legacy docs (canvas falls back to the Classic pack + pack defaults). These
 * are presentation-only overrides applied on top of the selected pack:
 *   - `motionEnabled`: master motion on/off (over the pack's `motion.enabled`).
 *   - `backgroundKind`: override the pack's canvas background style.
 */
export const CANVAS_BACKGROUND_KINDS = [
  "dots",
  "lines",
  "cross",
  "none",
] as const;
export type CanvasBackgroundKind = (typeof CANVAS_BACKGROUND_KINDS)[number];

/**
 * MCP-RESILIENCE: how execute nodes treat MCP-server startup.
 *   - `best-effort` (default): unreachable MCP servers are skipped and the node
 *     still runs (no `--require-mcp-startup`). This is the resilient default.
 *   - `require`: the spawned CLI must hard-fail if a configured MCP server cannot
 *     start (kiro `--require-mcp-startup`).
 */
export const MCP_STARTUP_POLICIES = ["best-effort", "require"] as const;
export type McpStartupPolicy = (typeof MCP_STARTUP_POLICIES)[number];

export interface ICanvasConfig {
  motionEnabled?: boolean;
  backgroundKind?: CanvasBackgroundKind;
}

/**
 * MODEL-1 fixer defaults — the model/CLI/persona applied to spawned fixer nodes
 * (SpawnFixerModal pre-fill + `spawn-child` seeding). All fields optional; an
 * empty config leaves fixer nodes on the graph/runtime defaults as before.
 */
export interface IFixerConfig {
  cli?: SupportedCli;
  model?: string;
  persona?: string;
}

export interface IUserSettings {
  ownerId: string;
  allowedTools: string[];
  /**
   * Per-CLI allowed-tools selections (CLI → tool names). `allowedTools` above
   * remains kiro's backward-compatible source of truth for execution
   * (`resolveAllowedTools` reads it); the kiro entry here is kept mirrored to it.
   * Non-kiro entries are persisted intent, not yet wired into execution.
   */
  allowedToolsByCli?: Record<string, string[]>;
  plannerProvider: PlannerProvider;
  mergeStrategy: MergeStrategy;
  /** Canvas Theme Pack selection (id). Absent → Classic. */
  canvasThemePackId?: string;
  /** Canvas appearance overrides applied on top of the selected pack. */
  canvasConfig?: ICanvasConfig;
  /**
   * MODEL-1: per-node-type default model id (node kind → model). Used by the
   * run-executor when a node omits `data.model`. Partial — only configured kinds
   * are present. Additive/optional (absent on legacy docs).
   */
  defaultModelByNodeType?: Partial<Record<NodeKind, string>>;
  /** MODEL-1: defaults applied to spawned fixer nodes. */
  fixerConfig?: IFixerConfig;
  /** MCP-RESILIENCE: how execute nodes treat MCP-server startup. */
  mcpStartupPolicy?: McpStartupPolicy;
  createdAt: Date;
  updatedAt: Date;
}

const UserSettingsSchema = new Schema<IUserSettings>(
  {
    ownerId: { type: String, required: true, unique: true, index: true },
    allowedTools: { type: [String], default: ["fs_read"] },
    allowedToolsByCli: { type: Schema.Types.Mixed, default: {} },
    plannerProvider: { type: String, enum: PLANNER_PROVIDERS, default: "cloud" },
    mergeStrategy: { type: String, enum: MERGE_STRATEGIES, default: "base-fanin" },
    // Canvas theming — additive/optional. No default packId (client → Classic).
    canvasThemePackId: { type: String },
    canvasConfig: { type: Schema.Types.Mixed, default: {} },
    // MODEL-1 / MCP-RESILIENCE — additive/optional. No defaults on legacy docs.
    defaultModelByNodeType: { type: Schema.Types.Mixed, default: {} },
    fixerConfig: { type: Schema.Types.Mixed, default: {} },
    mcpStartupPolicy: { type: String, enum: MCP_STARTUP_POLICIES, default: "best-effort" },
  },
  { timestamps: true },
);

export const UserSettingsModel: Model<IUserSettings> =
  (models.UserSettings as Model<IUserSettings>) ??
  model<IUserSettings>("UserSettings", UserSettingsSchema);
